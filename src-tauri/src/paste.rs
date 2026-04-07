use arboard::Clipboard;
use std::process::Command;

/// Paste an item by writing to clipboard and simulating Ctrl+V
pub fn paste_content(content: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Write content to system clipboard
    let mut clipboard = Clipboard::new()?;
    clipboard.set_text(content)?;

    // Small delay to ensure clipboard is ready
    std::thread::sleep(std::time::Duration::from_millis(50));

    // Simulate Ctrl+V using xdotool (X11) or wtype (Wayland)
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        // Wayland: try wtype first, fall back to ydotool
        let result = Command::new("wtype")
            .args(["-M", "ctrl", "-P", "v", "-p", "v", "-m", "ctrl"])
            .output();

        if result.is_err() {
            Command::new("ydotool")
                .args(["key", "29:1", "47:1", "47:0", "29:0"])
                .output()?;
        }
    } else {
        // X11: use xdotool
        Command::new("xdotool")
            .args(["key", "--clearmodifiers", "ctrl+v"])
            .output()?;
    }

    Ok(())
}
