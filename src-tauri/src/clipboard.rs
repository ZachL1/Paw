use arboard::Clipboard as ArboardClipboard;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::database::Database;

pub struct ClipboardMonitor {
    last_content: Arc<Mutex<String>>,
    running: Arc<Mutex<bool>>,
}

impl ClipboardMonitor {
    pub fn new() -> Self {
        Self {
            last_content: Arc::new(Mutex::new(String::new())),
            running: Arc::new(Mutex::new(false)),
        }
    }

    pub fn start<F>(&self, db: Arc<Database>, on_change: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        let last_content = self.last_content.clone();
        let running = self.running.clone();

        // Initialize with current clipboard content
        if let Ok(mut clipboard) = ArboardClipboard::new() {
            if let Ok(text) = clipboard.get_text() {
                *last_content.lock().unwrap() = text;
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

                if let Ok(text) = clipboard.get_text() {
                    let mut last = last_content.lock().unwrap();
                    if !text.is_empty() && text != *last {
                        *last = text.clone();
                        drop(last);

                        if let Err(e) = db.add_item(&text, "text") {
                            log::error!("Failed to save clipboard item: {}", e);
                        }
                        on_change();
                    }
                }
            }
        });
    }

    pub fn stop(&self) {
        *self.running.lock().unwrap() = false;
    }
}
