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

/// Force-activate a window on X11 using _NET_ACTIVE_WINDOW + XSetInputFocus.
fn x11_activate_window(gtk_window: &gtk::ApplicationWindow) {
    use gdk::prelude::*;
    use gtk::prelude::*;

    if let Some(gdk_window) = gtk_window.window() {
        #[cfg(target_os = "linux")]
        unsafe {
            use gdk::ffi::GdkWindow;
            use std::os::raw::c_ulong;

            extern "C" {
                fn gdk_x11_window_get_xid(window: *mut GdkWindow) -> c_ulong;
                fn gdk_x11_get_default_xdisplay() -> *mut x11::xlib::Display;
            }

            let gdk_win_ptr = gdk_window.as_ptr() as *mut GdkWindow;
            let xid = gdk_x11_window_get_xid(gdk_win_ptr);
            let display = gdk_x11_get_default_xdisplay();

            if !display.is_null() && xid != 0 {
                let root = x11::xlib::XDefaultRootWindow(display);

                // Ensure the window is mapped and raised
                x11::xlib::XMapRaised(display, xid);

                // Send _NET_ACTIVE_WINDOW client message
                let atom = x11::xlib::XInternAtom(
                    display,
                    b"_NET_ACTIVE_WINDOW\0".as_ptr() as *const _,
                    0,
                );

                let mut event: x11::xlib::XEvent = std::mem::zeroed();
                event.client_message.type_ = x11::xlib::ClientMessage;
                event.client_message.window = xid;
                event.client_message.message_type = atom;
                event.client_message.format = 32;
                event.client_message.data.set_long(0, 2); // source: pager/direct
                event.client_message.data.set_long(1, x11::xlib::CurrentTime as i64);
                event.client_message.data.set_long(2, 0);

                x11::xlib::XSendEvent(
                    display,
                    root,
                    0,
                    x11::xlib::SubstructureRedirectMask | x11::xlib::SubstructureNotifyMask,
                    &mut event,
                );

                // Also directly set input focus as fallback
                x11::xlib::XSetInputFocus(
                    display,
                    xid,
                    x11::xlib::RevertToParent,
                    x11::xlib::CurrentTime,
                );
                x11::xlib::XRaiseWindow(display, xid);
                x11::xlib::XFlush(display);
            }
        }
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();

            if let Ok(gtk_window) = window.gtk_window() {
                use gtk::prelude::*;
                gtk_window.set_accept_focus(true);
                gtk_window.set_keep_above(true);
            }

            // Delay X11 activation to ensure window is mapped after show()
            // Use glib timeout to stay on the main GTK thread
            let app_handle = app.clone();
            glib::timeout_add_local_once(
                std::time::Duration::from_millis(50),
                move || {
                    if let Some(w) = app_handle.get_window("main") {
                        if let Ok(gtk_window) = w.gtk_window() {
                            x11_activate_window(&gtk_window);
                        }
                    }
                },
            );

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
