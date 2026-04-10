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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    AppHandle, CustomMenuItem, GlobalShortcutManager, Manager,
    SystemTray, SystemTrayEvent, SystemTrayMenu, LogicalPosition, LogicalSize,
};

static WINDOW_VISIBLE: AtomicBool = AtomicBool::new(false);

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
    let old_hotkey = {
        let mut config = state.lock().unwrap();
        let old = config.hotkey.clone();
        *config = new_config.clone();
        config.save().map_err(|e| e.to_string())?;
        old
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

    Ok(())
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    do_hide(&app);
}

static PREVIEW_VISIBLE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn show_preview(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    let preview_window = app.get_window("preview").ok_or("Preview window not found")?;
    let main_window = app.get_window("main").ok_or("Main window not found")?;

    let _ = preview_window.emit("preview-update", &data);

    let scale_factor = main_window.scale_factor().unwrap_or(1.0);
    let pos = main_window.outer_position().map_err(|e| e.to_string())?;
    let size = main_window.outer_size().map_err(|e| e.to_string())?;
    let main_x = pos.x as f64 / scale_factor;
    let main_y = pos.y as f64 / scale_factor;
    let main_w = size.width as f64 / scale_factor;
    let main_h = size.height as f64 / scale_factor;

    let screen_max_x = if let Ok(Some(monitor)) = main_window.current_monitor() {
        let mp = monitor.position();
        let ms = monitor.size();
        (mp.x as f64 + ms.width as f64) / scale_factor
    } else {
        1920.0
    };

    // Fixed preview width (like Maccy's default 400px), height matches main window
    let preview_w: f64 = 400.0;
    let preview_h: f64 = main_h;

    // Place flush against main window: prefer right, fall back to left
    let preview_x = if main_x + main_w + preview_w <= screen_max_x {
        main_x + main_w  // Flush right
    } else {
        main_x - preview_w  // Flush left
    };

    let _ = preview_window.set_size(LogicalSize::new(preview_w, preview_h));
    let _ = preview_window.set_position(LogicalPosition::new(preview_x, main_y));

    if !PREVIEW_VISIBLE.load(Ordering::SeqCst) {
        let _ = preview_window.show();
        PREVIEW_VISIBLE.store(true, Ordering::SeqCst);
        let _ = main_window.set_focus();
    }

    Ok(())
}

#[tauri::command]
fn hide_preview(app: AppHandle) {
    PREVIEW_VISIBLE.store(false, Ordering::SeqCst);
    if let Some(preview) = app.get_window("preview") {
        let _ = preview.hide();
    }
}

fn do_hide(app: &AppHandle) {
    WINDOW_VISIBLE.store(false, Ordering::SeqCst);
    PREVIEW_VISIBLE.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_window("main") {
        let _ = window.hide();
    }
    if let Some(preview) = app.get_window("preview") {
        let _ = preview.hide();
    }
}

fn do_show(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        WINDOW_VISIBLE.store(true, Ordering::SeqCst);
        let _ = window.show();
        let _ = window.set_focus();

        #[cfg(target_os = "linux")]
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(150));
            let output = std::process::Command::new("xdotool")
                .args(["search", "--name", "Paw"])
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
                    // Emit event to show settings in the frontend
                    if let Some(window) = app.get_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
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
            show_preview,
            hide_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Paw");
}
