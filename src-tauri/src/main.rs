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
    PhysicalPosition, Position,
    SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
};

static WINDOW_VISIBLE: AtomicBool = AtomicBool::new(false);
/// Timestamp (ms since epoch) when do_show was last called.
/// hide_window command won't hide if called within 600ms of show.
static LAST_SHOWN_MS: AtomicU64 = AtomicU64::new(0);
static TRAY_SEQUENCE: AtomicU64 = AtomicU64::new(1);

struct MenuBarTrayState {
    current_id: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Get current cursor position in physical pixels.
#[cfg(target_os = "linux")]
fn get_cursor_position() -> Option<(i32, i32)> {
    let output = std::process::Command::new("xdotool")
        .args(["getmouselocation", "--shell"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let mut x = None;
    let mut y = None;
    for line in text.lines() {
        if let Some(val) = line.strip_prefix("X=") {
            x = val.parse().ok();
        } else if let Some(val) = line.strip_prefix("Y=") {
            y = val.parse().ok();
        }
    }
    Some((x?, y?))
}

#[cfg(target_os = "macos")]
fn get_cursor_position() -> Option<(i32, i32)> {
    // On macOS, use CoreGraphics via osascript as a lightweight fallback
    let output = std::process::Command::new("osascript")
        .args([
            "-e",
            "use framework \"Foundation\"",
            "-e",
            "use framework \"AppKit\"",
            "-e",
            "set mouseLoc to current application's NSEvent's mouseLocation()",
            "-e",
            "set screenH to (current application's NSScreen's mainScreen()'s frame()'s |size|'s height) as integer",
            "-e",
            "set mx to (mouseLoc's x) as integer",
            "-e",
            "set my to (screenH - (mouseLoc's y as integer))",
            "-e",
            "return (mx as text) & \",\" & (my as text)",
        ])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = text.split(',').collect();
    if parts.len() == 2 {
        let x: i32 = parts[0].trim().parse().ok()?;
        let y: i32 = parts[1].trim().parse().ok()?;
        Some((x, y))
    } else {
        None
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn get_cursor_position() -> Option<(i32, i32)> {
    None
}

/// Position the window on the monitor containing the cursor:
/// - horizontally: centered on cursor X, clamped to monitor edges
/// - vertically: centered on the monitor
fn position_window_near_cursor(window: &tauri::Window) {
    let (cursor_x, _cursor_y) = match get_cursor_position() {
        Some(pos) => pos,
        None => return, // fallback: keep existing position
    };

    // Find the monitor that contains the cursor
    let monitors = match window.available_monitors() {
        Ok(m) => m,
        Err(_) => return,
    };

    let target_monitor = monitors.iter().find(|m| {
        let pos = m.position();
        let size = m.size();
        cursor_x >= pos.x
            && cursor_x < pos.x + size.width as i32
    });

    let monitor = match target_monitor.or_else(|| monitors.first()) {
        Some(m) => m,
        None => return,
    };

    let mon_x = monitor.position().x;
    let mon_y = monitor.position().y;
    let mon_w = monitor.size().width as i32;
    let mon_h = monitor.size().height as i32;

    let win_size = match window.inner_size() {
        Ok(s) => s,
        Err(_) => return,
    };
    let win_w = win_size.width as i32;
    let win_h = win_size.height as i32;

    // Horizontal: center on cursor, clamp to monitor
    let mut x = cursor_x - win_w / 2;
    x = x.max(mon_x).min(mon_x + mon_w - win_w);

    // Vertical: center on monitor
    let y = mon_y + (mon_h - win_h) / 2;

    let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
}

fn build_tray_menu(hide_tray_menu_actions: bool) -> SystemTrayMenu {
    let mut menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("toggle", "Show/Hide"));

    if !hide_tray_menu_actions {
        menu = menu
            .add_native_item(SystemTrayMenuItem::Separator)
            .add_item(CustomMenuItem::new("settings", "Preferences..."))
            .add_item(CustomMenuItem::new("about", "About"))
            .add_item(CustomMenuItem::new("quit", "Quit"));
    }

    menu
}

fn handle_tray_event(app: &AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick { .. } => {
            toggle_window(app);
        }
        SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
            "toggle" => toggle_window(app),
            "settings" => {
                do_show(app);
                if let Some(window) = app.get_window("main") {
                    let _ = window.emit("show-settings", ());
                }
            }
            "about" => {
                do_show(app);
                if let Some(window) = app.get_window("main") {
                    let _ = window.emit("show-about", ());
                }
            }
            "quit" => quit_app(),
            _ => {}
        },
        _ => {}
    }
}

fn build_system_tray(app: &AppHandle, hide_tray_menu_actions: bool) -> Result<String, String> {
    let tray_id = format!(
        "paw-menu-bar-{}",
        TRAY_SEQUENCE.fetch_add(1, Ordering::SeqCst)
    );
    let app_handle = app.clone();
    SystemTray::new()
        .with_id(&tray_id)
        .with_menu(build_tray_menu(hide_tray_menu_actions))
        .on_event(move |event| {
            handle_tray_event(&app_handle, event);
        })
        .build(app)
        .map(|_| tray_id)
        .map_err(|e| e.to_string())
}

fn current_tray_id(app: &AppHandle) -> Option<String> {
    app.try_state::<Mutex<MenuBarTrayState>>()
        .and_then(|state| state.lock().unwrap().current_id.clone())
}

fn set_current_tray_id(app: &AppHandle, tray_id: Option<String>) {
    if let Some(state) = app.try_state::<Mutex<MenuBarTrayState>>() {
        state.lock().unwrap().current_id = tray_id;
    }
}

fn apply_menu_bar_icon_visibility(
    app: &AppHandle,
    visible: bool,
    hide_tray_menu_actions: bool,
) -> Result<(), String> {
    let tray_id = current_tray_id(app);
    let tray_handle = tray_id.as_deref().and_then(|id| app.tray_handle_by_id(id));

    match (visible, tray_handle) {
        (true, Some(handle)) => {
            handle
                .set_menu(build_tray_menu(hide_tray_menu_actions))
                .map_err(|e| e.to_string())?;
            #[cfg(target_os = "macos")]
            handle.set_icon_as_template(true).map_err(|e| e.to_string())?;
            Ok(())
        }
        (true, None) => {
            let new_tray_id = build_system_tray(app, hide_tray_menu_actions)?;
            set_current_tray_id(app, Some(new_tray_id));
            Ok(())
        }
        (false, Some(handle)) => {
            handle.destroy().map_err(|e| e.to_string())?;
            set_current_tray_id(app, None);
            Ok(())
        }
        (false, None) => {
            set_current_tray_id(app, None);
            Ok(())
        }
    }
}

#[cfg(target_os = "macos")]
fn hide_dock_icon() {
    use objc::{class, msg_send, sel, sel_impl};
    use objc::runtime::Object;

    unsafe {
        let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        if !app.is_null() {
            let _: bool = msg_send![app, setActivationPolicy: 1usize];
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn hide_dock_icon() {}

#[cfg(target_os = "macos")]
fn schedule_hide_dock_icon(app: &AppHandle) {
    hide_dock_icon();
    let _ = app.run_on_main_thread(hide_dock_icon);

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(750));
        let _ = app.run_on_main_thread(hide_dock_icon);
    });
}

#[cfg(not(target_os = "macos"))]
fn schedule_hide_dock_icon(_app: &AppHandle) {}

#[tauri::command]
fn quit_app() {
    std::process::exit(0);
}

#[tauri::command]
fn get_history(
    state: tauri::State<'_, Arc<Database>>,
    config: tauri::State<'_, Arc<Mutex<AppConfig>>>,
) -> Result<Vec<HistoryItem>, String> {
    let max = config.lock().unwrap().max_history;
    state.get_all(max).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_history(
    query: String,
    state: tauri::State<'_, Arc<Database>>,
    config: tauri::State<'_, Arc<Mutex<AppConfig>>>,
) -> Result<Vec<HistoryItem>, String> {
    let max = config.lock().unwrap().max_history;
    state.search(&query, max).map_err(|e| e.to_string())
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
    let (old_hotkey, old_autostart, old_hide_tray_menu_actions, old_show_menu_bar_icon) = {
        let config = state.lock().unwrap();
        (
            config.hotkey.clone(),
            config.launch_at_startup,
            config.hide_tray_menu_actions,
            config.show_menu_bar_icon,
        )
    };
    let hotkey_changed = old_hotkey != new_config.hotkey;
    let app_handle = app.clone();

    // Re-register hotkey if changed — register new FIRST, then unregister old
    if hotkey_changed {
        let mut gsm = app.global_shortcut_manager();
        gsm.register(&new_config.hotkey, move || {
            toggle_window(&app_handle);
        })
        .map_err(|e| format!("Invalid hotkey: {}", e))?;
    }

    // Persist config only after hotkey is confirmed valid.
    let saved_config = new_config.clone();
    if let Err(e) = saved_config.save() {
        if hotkey_changed {
            let mut gsm = app.global_shortcut_manager();
            let _ = gsm.unregister(&new_config.hotkey);
        }
        return Err(e.to_string());
    }
    {
        let mut config = state.lock().unwrap();
        *config = saved_config;
    }

    // New hotkey registered successfully — safe to unregister old
    if hotkey_changed {
        let mut gsm = app.global_shortcut_manager();
        let _ = gsm.unregister(&old_hotkey);
    }

    // Notify clipboard monitor of config changes
    if let Some(monitor) = app.try_state::<ClipboardMonitor>() {
        monitor.update_config(new_config.poll_interval_ms);
    }

    // Update menu bar icon before autostart so a startup failure doesn't leave the menu stale.
    if old_hide_tray_menu_actions != new_config.hide_tray_menu_actions
        || old_show_menu_bar_icon != new_config.show_menu_bar_icon
    {
        apply_menu_bar_icon_visibility(
            &app,
            new_config.show_menu_bar_icon,
            new_config.hide_tray_menu_actions,
        )?;
    }

    // Apply autostart if changed
    if old_autostart != new_config.launch_at_startup {
        autostart::set_autostart(new_config.launch_at_startup)?;
    }

    Ok(())
}

#[tauri::command]
fn set_hide_tray_menu_actions(
    hide_tray_menu_actions: bool,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppConfig>>>,
) -> Result<(), String> {
    let old_hide_tray_menu_actions = {
        let config = state.lock().unwrap();
        config.hide_tray_menu_actions
    };

    if old_hide_tray_menu_actions == hide_tray_menu_actions {
        return Ok(());
    }

    {
        let mut config = state.lock().unwrap();
        config.hide_tray_menu_actions = hide_tray_menu_actions;
        if let Err(e) = config.save() {
            config.hide_tray_menu_actions = old_hide_tray_menu_actions;
            return Err(e.to_string());
        }
    }

    let show_menu_bar_icon = {
        let config = state.lock().unwrap();
        config.show_menu_bar_icon
    };
    apply_menu_bar_icon_visibility(&app, show_menu_bar_icon, hide_tray_menu_actions)?;

    Ok(())
}

#[tauri::command]
fn set_menu_bar_icon_visible(
    visible: bool,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppConfig>>>,
) -> Result<(), String> {
    let (old_visible, hide_tray_menu_actions) = {
        let config = state.lock().unwrap();
        (config.show_menu_bar_icon, config.hide_tray_menu_actions)
    };

    if old_visible == visible {
        return Ok(());
    }

    {
        let mut config = state.lock().unwrap();
        config.show_menu_bar_icon = visible;
        if let Err(e) = config.save() {
            config.show_menu_bar_icon = old_visible;
            return Err(e.to_string());
        }
    }

    if let Err(e) = apply_menu_bar_icon_visibility(&app, visible, hide_tray_menu_actions) {
        let mut config = state.lock().unwrap();
        config.show_menu_bar_icon = old_visible;
        let _ = config.save();
        return Err(e);
    }

    Ok(())
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    do_hide(&app);
}

/// Copy item to clipboard without simulating paste keystroke
#[tauri::command]
fn copy_item(
    id: i64,
    app: AppHandle,
    state: tauri::State<'_, Arc<Database>>,
) -> Result<(), String> {
    state.touch_item(id).map_err(|e| e.to_string())?;

    let content_type = state.get_content_type(id).map_err(|e| e.to_string())?;

    if let Some(monitor) = app.try_state::<ClipboardMonitor>() {
        monitor.suppress_next();
    }

    if content_type == "image" {
        let blob = state
            .get_image_blob(id)
            .map_err(|e| e.to_string())?
            .ok_or("Image data not found")?;

        use image::ImageReader;
        use std::io::Cursor;
        let img = ImageReader::new(Cursor::new(&blob))
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .decode()
            .map_err(|e| e.to_string())?;
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();

        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard
            .set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: rgba.into_raw().into(),
            })
            .map_err(|e| e.to_string())?;
    } else {
        let content = state
            .get_content_by_id(id)
            .map_err(|e| e.to_string())?
            .ok_or("Item not found")?;

        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard.set_text(content).map_err(|e| e.to_string())?;
    }

    Ok(())
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

        // Position window near cursor before showing
        position_window_near_cursor(&window);

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

    let hotkey = config.lock().unwrap().hotkey.clone();

    tauri::Builder::default()
        .setup(move |app| {
            schedule_hide_dock_icon(&app.handle());
            app.manage(config.clone());
            app.manage(Mutex::new(MenuBarTrayState { current_id: None }));

            let db = Arc::new(Database::new().expect("Failed to initialize database"));
            app.manage(db.clone());

            // Run maintenance: auto-clear expired items and trim to max_history
            {
                let cfg = config.lock().unwrap();
                if let Some(days) = cfg.auto_clear_days {
                    if let Err(e) = db.clear_expired(days) {
                        log::error!("Failed to clear expired items: {}", e);
                    }
                }
                if let Err(e) = db.trim_to_max(cfg.max_history) {
                    log::error!("Failed to trim history: {}", e);
                }
            }

            let monitor = ClipboardMonitor::new();
            let app_handle = app.handle().clone();
            let cfg = config.lock().unwrap();
            let poll_ms = cfg.poll_interval_ms;
            let hide_tray_menu_actions = cfg.hide_tray_menu_actions;
            let show_menu_bar_icon = cfg.show_menu_bar_icon;
            drop(cfg);
            monitor.start(db, move |item| {
                let _ = app_handle.emit_all("clipboard-changed", item);
            }, poll_ms);
            app.manage(monitor);

            if show_menu_bar_icon {
                let tray_id = build_system_tray(&app.handle(), hide_tray_menu_actions)
                    .expect("Failed to create menu bar icon");
                set_current_tray_id(&app.handle(), Some(tray_id));
            }

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
            search_history,
            delete_item,
            clear_history,
            paste_item,
            copy_item,
            toggle_pin,
            get_item_content,
            get_config,
            save_config,
            set_hide_tray_menu_actions,
            set_menu_bar_icon_visible,
            hide_window,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Paw");
}
