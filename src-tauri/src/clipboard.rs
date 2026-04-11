use arboard::Clipboard as ArboardClipboard;
use sha2::{Sha256, Digest};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;

use crate::database::Database;

/// Tracks the last seen clipboard content for change detection
enum LastClipboard {
    Text(String),
    ImageHash(String),
    Empty,
}

pub struct ClipboardMonitor {
    last_content: Arc<Mutex<LastClipboard>>,
    running: Arc<Mutex<bool>>,
    suppress: Arc<AtomicBool>,
    /// Tracks the macOS pasteboard changeCount for fast change detection
    last_change_count: Arc<AtomicI64>,
    /// Dynamic poll interval in ms (updated from config)
    poll_interval_ms: Arc<AtomicU64>,
    /// Dynamic ignored apps list (updated from config)
    ignored_apps: Arc<RwLock<Vec<String>>>,
}

impl ClipboardMonitor {
    pub fn new() -> Self {
        Self {
            last_content: Arc::new(Mutex::new(LastClipboard::Empty)),
            running: Arc::new(Mutex::new(false)),
            suppress: Arc::new(AtomicBool::new(false)),
            last_change_count: Arc::new(AtomicI64::new(-1)),
            poll_interval_ms: Arc::new(AtomicU64::new(500)),
            ignored_apps: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Tell the monitor to ignore the next clipboard change (e.g. when app writes to clipboard)
    pub fn suppress_next(&self) {
        self.suppress.store(true, Ordering::SeqCst);
    }

    /// Update runtime config without restarting the monitor thread
    pub fn update_config(&self, poll_ms: u64, apps: Vec<String>) {
        self.poll_interval_ms.store(poll_ms.max(100).min(5000), Ordering::SeqCst);
        *self.ignored_apps.write().unwrap() = apps;
    }

    pub fn start<F>(&self, db: Arc<Database>, on_change: F, initial_poll_ms: u64, initial_ignored: Vec<String>)
    where
        F: Fn(Option<crate::models::HistoryItem>) + Send + Sync + 'static,
    {
        let last_content = self.last_content.clone();
        let running = self.running.clone();
        let suppress = self.suppress.clone();
        let last_change_count = self.last_change_count.clone();
        let poll_interval_ms = self.poll_interval_ms.clone();
        let ignored_apps = self.ignored_apps.clone();

        // Apply initial config
        poll_interval_ms.store(initial_poll_ms.max(100).min(5000), Ordering::SeqCst);
        *ignored_apps.write().unwrap() = initial_ignored;

        // Initialize with current clipboard content
        if let Ok(mut clipboard) = ArboardClipboard::new() {
            if let Ok(text) = clipboard.get_text() {
                if !text.is_empty() {
                    *last_content.lock().unwrap() = LastClipboard::Text(text);
                }
            }
        }

        // Initialize macOS change count
        #[cfg(target_os = "macos")]
        {
            let count = macos_change_count();
            last_change_count.store(count, Ordering::SeqCst);
        }

        *running.lock().unwrap() = true;

        thread::spawn(move || {
            loop {
                if !*running.lock().unwrap() {
                    break;
                }

                let interval = poll_interval_ms.load(Ordering::SeqCst);
                thread::sleep(Duration::from_millis(interval));

                // On macOS, use changeCount for fast "nothing changed" detection
                #[cfg(target_os = "macos")]
                {
                    let current_count = macos_change_count();
                    let prev_count = last_change_count.load(Ordering::SeqCst);
                    if current_count == prev_count && current_count >= 0 {
                        continue;
                    }
                    last_change_count.store(current_count, Ordering::SeqCst);
                }

                let mut clipboard = match ArboardClipboard::new() {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                // Check suppression flag (app just wrote to clipboard)
                if suppress.swap(false, Ordering::SeqCst) {
                    if let Ok(text) = clipboard.get_text() {
                        if !text.is_empty() {
                            *last_content.lock().unwrap() = LastClipboard::Text(text);
                        }
                    } else if let Ok(img_data) = clipboard.get_image() {
                        if img_data.width > 0 && img_data.height > 0 {
                            let hash = compute_image_hash(&img_data.bytes);
                            *last_content.lock().unwrap() = LastClipboard::ImageHash(hash);
                        }
                    }
                    continue;
                }

                // Check if frontmost app is ignored (only when there's potential content)
                // We defer source_app capture to after change detection to avoid
                // spawning subprocesses every poll cycle

                // Try text first
                if let Ok(text) = clipboard.get_text() {
                    if !text.is_empty() {
                        let mut last = last_content.lock().unwrap();
                        let is_new = match &*last {
                            LastClipboard::Text(prev) => *prev != text,
                            _ => true,
                        };
                        if is_new {
                            *last = LastClipboard::Text(text.clone());
                            drop(last);

                            // Capture source app only when we have a new item
                            let source_app = get_frontmost_app();
                            if let Some(ref app_name) = source_app {
                                let apps = ignored_apps.read().unwrap();
                                let app_lower = app_name.to_lowercase();
                                if apps.iter().any(|a| app_lower.contains(&a.to_lowercase())) {
                                    continue;
                                }
                            }

                            match db.add_item(&text, "text", source_app.as_deref()) {
                                Ok(item_id) => {
                                    let item = db.get_item_by_id(item_id).ok().flatten();
                                    on_change(item);
                                }
                                Err(e) => {
                                    log::error!("Failed to save clipboard text: {}", e);
                                }
                            }
                            continue;
                        }
                    }
                }

                // Try image
                if let Ok(img_data) = clipboard.get_image() {
                    if img_data.width > 0 && img_data.height > 0 {
                        let hash = compute_image_hash(&img_data.bytes);
                        let mut last = last_content.lock().unwrap();
                        let is_new = match &*last {
                            LastClipboard::ImageHash(prev) => *prev != hash,
                            _ => true,
                        };
                        if is_new {
                            *last = LastClipboard::ImageHash(hash.clone());
                            drop(last);

                            // Capture source app only when we have a new item
                            let source_app = get_frontmost_app();
                            if let Some(ref app_name) = source_app {
                                let apps = ignored_apps.read().unwrap();
                                let app_lower = app_name.to_lowercase();
                                if apps.iter().any(|a| app_lower.contains(&a.to_lowercase())) {
                                    continue;
                                }
                            }

                            match encode_rgba_to_png(
                                &img_data.bytes,
                                img_data.width as u32,
                                img_data.height as u32,
                            ) {
                                Ok(png_bytes) => {
                                    match db.add_image_item(
                                        &png_bytes,
                                        &hash,
                                        img_data.width as u32,
                                        img_data.height as u32,
                                        source_app.as_deref(),
                                    ) {
                                        Ok(item_id) => {
                                            let item = db.get_item_by_id(item_id).ok().flatten();
                                            on_change(item);
                                        }
                                        Err(e) => {
                                            log::error!("Failed to save clipboard image: {}", e);
                                        }
                                    }
                                }
                                Err(e) => {
                                    log::error!("Failed to encode image to PNG: {}", e);
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    pub fn stop(&self) {
        *self.running.lock().unwrap() = false;
    }
}

/// Get the name of the frontmost application
#[cfg(target_os = "macos")]
fn get_frontmost_app() -> Option<String> {
    use objc::{msg_send, sel, sel_impl, class};
    use objc::runtime::Object;
    unsafe {
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return None;
        }
        let app: *mut Object = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }
        let name: *mut Object = msg_send![app, localizedName];
        if name.is_null() {
            return None;
        }
        let utf8: *const std::os::raw::c_char = msg_send![name, UTF8String];
        if utf8.is_null() {
            return None;
        }
        Some(std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }
}

#[cfg(target_os = "linux")]
fn get_frontmost_app() -> Option<String> {
    // Try xdotool for X11
    if std::env::var("WAYLAND_DISPLAY").is_err() {
        if let Ok(output) = std::process::Command::new("xdotool")
            .args(["getactivewindow", "getwindowname"])
            .output()
        {
            if output.status.success() {
                let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !name.is_empty() {
                    return Some(name);
                }
            }
        }
    }
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn get_frontmost_app() -> Option<String> {
    None
}

/// Read macOS NSPasteboard.general.changeCount via objc FFI (no subprocess overhead)
#[cfg(target_os = "macos")]
fn macos_change_count() -> i64 {
    use objc::{msg_send, sel, sel_impl, class};
    use objc::runtime::Object;
    unsafe {
        let cls = class!(NSPasteboard);
        let pb: *mut Object = msg_send![cls, generalPasteboard];
        if pb.is_null() {
            return -1;
        }
        let count: i64 = msg_send![pb, changeCount];
        count
    }
}

fn compute_image_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn encode_rgba_to_png(
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or("Invalid RGBA dimensions")?;
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)?;
    Ok(buf)
}
