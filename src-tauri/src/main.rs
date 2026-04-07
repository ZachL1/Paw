mod clipboard;
mod database;
mod models;
mod paste;

use database::Database;
use clipboard::ClipboardMonitor;
use models::HistoryItem;

use std::sync::Arc;
use tauri::{
    AppHandle, GlobalShortcutManager, Manager, SystemTray, SystemTrayEvent,
};

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

    // Hide the window first
    if let Some(window) = app.get_window("main") {
        let _ = window.hide();
    }

    // Small delay so the previous app regains focus
    std::thread::sleep(std::time::Duration::from_millis(150));

    paste::paste_content(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.hide();
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn main() {
    env_logger::init();

    let tray = SystemTray::new();

    tauri::Builder::default()
        .system_tray(tray)
        .on_system_tray_event(|app, event| {
            if let SystemTrayEvent::LeftClick { .. } = event {
                toggle_window(app);
            }
        })
        .setup(|app| {
            let db = Arc::new(Database::new().expect("Failed to initialize database"));
            app.manage(db.clone());

            // Start clipboard monitor
            let monitor = ClipboardMonitor::new();
            let app_handle = app.handle().clone();
            monitor.start(db, move || {
                let _ = app_handle.emit_all("clipboard-changed", ());
            });
            app.manage(monitor);

            // Register global shortcut
            let app_handle = app.handle().clone();
            app.global_shortcut_manager()
                .register("CmdOrCtrl+Shift+C", move || {
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
            hide_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CopyX");
}
