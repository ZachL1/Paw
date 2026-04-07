use arboard::Clipboard as ArboardClipboard;
use sha2::{Sha256, Digest};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
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
}

impl ClipboardMonitor {
    pub fn new() -> Self {
        Self {
            last_content: Arc::new(Mutex::new(LastClipboard::Empty)),
            running: Arc::new(Mutex::new(false)),
            suppress: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Tell the monitor to ignore the next clipboard change (e.g. when app writes to clipboard)
    pub fn suppress_next(&self) {
        self.suppress.store(true, Ordering::SeqCst);
    }

    pub fn start<F>(&self, db: Arc<Database>, on_change: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        let last_content = self.last_content.clone();
        let running = self.running.clone();
        let suppress = self.suppress.clone();

        // Initialize with current clipboard content
        if let Ok(mut clipboard) = ArboardClipboard::new() {
            if let Ok(text) = clipboard.get_text() {
                if !text.is_empty() {
                    *last_content.lock().unwrap() = LastClipboard::Text(text);
                }
            }
        }

        *running.lock().unwrap() = true;

        thread::spawn(move || {
            let poll_interval = Duration::from_millis(500);

            loop {
                if !*running.lock().unwrap() {
                    break;
                }

                thread::sleep(poll_interval);

                let mut clipboard = match ArboardClipboard::new() {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                // Check suppression flag (app just wrote to clipboard)
                if suppress.swap(false, Ordering::SeqCst) {
                    // Update last_content to current clipboard so we skip this change
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

                            if let Err(e) = db.add_item(&text, "text") {
                                log::error!("Failed to save clipboard text: {}", e);
                            }
                            on_change();
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

                            match encode_rgba_to_png(
                                &img_data.bytes,
                                img_data.width as u32,
                                img_data.height as u32,
                            ) {
                                Ok(png_bytes) => {
                                    if let Err(e) = db.add_image_item(
                                        &png_bytes,
                                        &hash,
                                        img_data.width as u32,
                                        img_data.height as u32,
                                    ) {
                                        log::error!("Failed to save clipboard image: {}", e);
                                    }
                                    on_change();
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
