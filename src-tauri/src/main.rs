mod clipboard;
mod database;
mod models;
mod paste;

use database::Database;
use clipboard::ClipboardMonitor;
use models::HistoryItem;

use std::sync::Arc;
use tauri::{
    AppHandle, CustomMenuItem, GlobalShortcutManager, Manager,
    SystemTray, SystemTrayEvent, SystemTrayMenu,
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
            // Use GTK present() BEFORE show — this tells the WM we want focus
            if let Ok(gtk_window) = window.gtk_window() {
                use gtk::prelude::*;
                gtk_window.set_keep_above(true);
                gtk_window.set_accept_focus(true);
                gtk_window.set_urgency_hint(true);
            }

            let _ = window.show();
            let _ = window.set_focus();

            if let Ok(gtk_window) = window.gtk_window() {
                use gtk::prelude::*;
                gtk_window.present();
                gtk_window.set_urgency_hint(false);
            }

            // Emit event to frontend so it can focus the search input
            let _ = window.emit("window-shown", ());
        }
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
