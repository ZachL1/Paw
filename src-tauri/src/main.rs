mod clipboard;
mod database;
mod models;
mod paste;

use database::Database;
use clipboard::ClipboardMonitor;
use models::HistoryItem;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{
    AppHandle, CustomMenuItem, GlobalShortcutManager, Manager,
    SystemTray, SystemTrayEvent, SystemTrayMenu,
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
    let content = state
        .get_content_by_id(id)
        .map_err(|e| e.to_string())?
        .ok_or("Item not found")?;

    do_hide(&app);

    std::thread::sleep(std::time::Duration::from_millis(150));
    paste::paste_content(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_pin(id: i64, state: tauri::State<'_, Arc<Database>>) -> Result<bool, String> {
    state.toggle_pin(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_item_content(id: i64, state: tauri::State<'_, Arc<Database>>) -> Result<String, String> {
    state
        .get_content_by_id(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Item not found".to_string())
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    do_hide(&app);
}

fn do_hide(app: &AppHandle) {
    WINDOW_VISIBLE.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_window("main") {
        let _ = window.hide();
    }
}

fn do_show(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        WINDOW_VISIBLE.store(true, Ordering::SeqCst);
        let _ = window.show();
        let _ = window.set_focus();

        // Use xdotool with --name search + longer delay for reliable focus
        std::thread::spawn(|| {
            // Wait for the window to be fully mapped
            std::thread::sleep(std::time::Duration::from_millis(150));
            // Try multiple strategies
            let output = std::process::Command::new("xdotool")
                .args(["search", "--name", "CopyX"])
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

    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("toggle", "Show/Hide"))
        .add_item(CustomMenuItem::new("quit", "Quit"));
    let tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .system_tray(tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                toggle_window(app);
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "toggle" => toggle_window(app),
                "quit" => std::process::exit(0),
                _ => {}
            },
            _ => {}
        })
        .setup(|app| {
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
                .register("Alt+V", move || {
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
            hide_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CopyX");
}
