mod autostart;
mod clipboard;
mod config;
mod database;
mod models;
mod paste;

use config::AppConfig;
use database::Database;
use clipboard::ClipboardMonitor;
use models::HistoryItem;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, CustomMenuItem, GlobalShortcutManager, Manager,
    SystemTray, SystemTrayEvent, SystemTrayMenu,
};

static WINDOW_VISIBLE: AtomicBool = AtomicBool::new(false);
/// Timestamp (ms since epoch) when do_show was last called.
/// hide_window command won't hide if called within 600ms of show.
static LAST_SHOWN_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn get_history(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<HistoryItem>, String> {
    state.get_all().map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_item(id: i64, state: tauri::State<'_, Arc<Database>>) -> Result<(), String> {
    state.delete_item(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_history(state: tauri::State<'_, Arc<Database>>) -> Result<(), String> {
    state.clear_all().map_err(|e| e.to_string())
}

#[tauri::command]
fn paste_item(
    id: i64,
    app: AppHandle,
    state: tauri::State<'_, Arc<Database>>,
) -> Result<(), String> {
    // Bump last_copied_at so item moves to top of history
    state.touch_item(id).map_err(|e| e.to_string())?;

    let content_type = state.get_content_type(id).map_err(|e| e.to_string())?;

    do_hide(&app);
    std::thread::sleep(std::time::Duration::from_millis(150));

    if content_type == "image" {
        // Get image blob, write to clipboard as image, then paste
        let blob = state
            .get_image_blob(id)
            .map_err(|e| e.to_string())?
            .ok_or("Image data not found")?;

        // Decode PNG to RGBA and set on clipboard
        use image::ImageReader;
        use std::io::Cursor;
        let img = ImageReader::new(Cursor::new(&blob))
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .decode()
            .map_err(|e| e.to_string())?;
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();

        // Suppress the monitor from picking this up
        if let Some(monitor) = app.try_state::<ClipboardMonitor>() {
            monitor.suppress_next();
        }

        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard
            .set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: rgba.into_raw().into(),
            })
            .map_err(|e| e.to_string())?;

        std::thread::sleep(std::time::Duration::from_millis(50));
        paste::simulate_paste().map_err(|e| e.to_string())
    } else {
        let content = state
            .get_content_by_id(id)
            .map_err(|e| e.to_string())?
            .ok_or("Item not found")?;

        // Suppress the monitor from picking this up
        if let Some(monitor) = app.try_state::<ClipboardMonitor>() {
            monitor.suppress_next();
        }

        paste::paste_text(&content).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn toggle_pin(id: i64, state: tauri::State<'_, Arc<Database>>) -> Result<bool, String> {
    state.toggle_pin(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_item_content(id: i64, state: tauri::State<'_, Arc<Database>>) -> Result<String, String> {
    let content_type = state.get_content_type(id).map_err(|e| e.to_string())?;
    if content_type == "image" {
        // Image is already stored as PNG — just base64-encode the raw blob
        let blob = state
            .get_image_blob(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Image data not found".to_string())?;

        Ok(format!("data:image/png;base64,{}", BASE64.encode(&blob)))
    } else {
        state
            .get_content_by_id(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Item not found".to_string())
    }
}

#[tauri::command]
fn get_config(state: tauri::State<'_, Arc<Mutex<AppConfig>>>) -> Result<AppConfig, String> {
    Ok(state.lock().unwrap().clone())
}

#[tauri::command]
fn save_config(
    new_config: AppConfig,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppConfig>>>,
) -> Result<(), String> {
    let (old_hotkey, old_autostart) = {
        let mut config = state.lock().unwrap();
        let old_hotkey = config.hotkey.clone();
        let old_autostart = config.launch_at_startup;
        *config = new_config.clone();
        config.save().map_err(|e| e.to_string())?;
        (old_hotkey, old_autostart)
    };

    // Re-register hotkey if changed
    if old_hotkey != new_config.hotkey {
        let mut gsm = app.global_shortcut_manager();
        let _ = gsm.unregister(&old_hotkey);
        let app_handle = app.clone();
        gsm.register(&new_config.hotkey, move || {
            toggle_window(&app_handle);
        })
        .map_err(|e| format!("Invalid hotkey: {}", e))?;
    }

    // Apply autostart if changed
    if old_autostart != new_config.launch_at_startup {
        autostart::set_autostart(new_config.launch_at_startup)?;
    }

    Ok(())
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    do_hide(&app);
}

fn do_hide(app: &AppHandle) {
    // If the window is already hidden, nothing to do.
    if !WINDOW_VISIBLE.load(Ordering::SeqCst) {
        return;
    }
    // Don't hide if the window was shown less than 600ms ago.
    // LAST_SHOWN_MS is stored *before* WINDOW_VISIBLE in do_show, so if we read
    // WINDOW_VISIBLE=true above (via SeqCst), LAST_SHOWN_MS already holds the new value.
    let elapsed = now_ms().saturating_sub(LAST_SHOWN_MS.load(Ordering::SeqCst));
    if elapsed < 600 {
        return;
    }
    WINDOW_VISIBLE.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_window("main") {
        let _ = window.hide();
    }
}

fn do_show(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        // Store LAST_SHOWN_MS *before* WINDOW_VISIBLE so that a concurrent do_hide
        // which sees WINDOW_VISIBLE=true (via SeqCst) also sees the fresh timestamp.
        LAST_SHOWN_MS.store(now_ms(), Ordering::SeqCst);
        WINDOW_VISIBLE.store(true, Ordering::SeqCst);
        let _ = window.show();
        let _ = window.set_focus();

        #[cfg(target_os = "linux")]
        {
            let pid = std::process::id().to_string();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(150));
                let output = std::process::Command::new("xdotool")
                    .args(["search", "--pid", &pid])
                    .output();
                if let Ok(out) = output {
                    let ids = String::from_utf8_lossy(&out.stdout);
                    if let Some(wid) = ids.lines().last() {
                        let wid = wid.trim();
                        if !wid.is_empty() {
                            let _ = std::process::Command::new("xdotool")
                                .args(["windowactivate", "--sync", wid])
                                .output();
                            let _ = std::process::Command::new("xdotool")
                                .args(["windowfocus", "--sync", wid])
                                .output();
                        }
                    }
                }
            });
        }

        #[cfg(target_os = "macos")]
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(150));
            let _ = std::process::Command::new("osascript")
                .args(["-e", "tell application \"Paw\" to activate"])
                .output();
        });

        let _ = window.emit("window-shown", ());
    }
}

fn toggle_window(app: &AppHandle) {
    if WINDOW_VISIBLE.load(Ordering::SeqCst) {
        do_hide(app);
    } else {
        do_show(app);
    }
}

fn main() {
    env_logger::init();

    let config = Arc::new(Mutex::new(AppConfig::load()));

    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("toggle", "Show/Hide"))
        .add_item(CustomMenuItem::new("settings", "Settings"))
        .add_item(CustomMenuItem::new("quit", "Quit"));
    let tray = SystemTray::new().with_menu(tray_menu);

    let hotkey = config.lock().unwrap().hotkey.clone();

    tauri::Builder::default()
        .system_tray(tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                toggle_window(app);
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "toggle" => toggle_window(app),
                "settings" => {
                    // Use do_show so WINDOW_VISIBLE and LAST_SHOWN_MS are properly set.
                    // Without this, do_hide sees WINDOW_VISIBLE=false and refuses to hide.
                    do_show(app);
                    if let Some(window) = app.get_window("main") {
                        let _ = window.emit("show-settings", ());
                    }
                }
                "quit" => std::process::exit(0),
                _ => {}
            },
            _ => {}
        })
        .setup(move |app| {
            app.manage(config.clone());

            let db = Arc::new(Database::new().expect("Failed to initialize database"));
            app.manage(db.clone());

            let monitor = ClipboardMonitor::new();
            let app_handle = app.handle().clone();
            monitor.start(db, move || {
                let _ = app_handle.emit_all("clipboard-changed", ());
            });
            app.manage(monitor);

            let app_handle = app.handle().clone();
            app.global_shortcut_manager()
                .register(&hotkey, move || {
                    toggle_window(&app_handle);
                })
                .expect("Failed to register global shortcut");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_history,
            delete_item,
            clear_history,
            paste_item,
            toggle_pin,
            get_item_content,
            get_config,
            save_config,
            hide_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Paw");
}
