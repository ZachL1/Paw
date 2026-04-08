use arboard::Clipboard;
use std::process::Command;

/// Paste text by writing to clipboard and simulating Ctrl+V
pub fn paste_text(content: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut clipboard = Clipboard::new()?;
    clipboard.set_text(content)?;

    std::thread::sleep(std::time::Duration::from_millis(50));
    simulate_paste()?;
    Ok(())
}

/// Simulate Ctrl+V keystroke (clipboard must already contain desired content)
pub fn simulate_paste() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        let result = Command::new("wtype")
            .args(["-M", "ctrl", "-P", "v", "-p", "v", "-m", "ctrl"])
            .output();

        if result.is_err() {
            Command::new("ydotool")
                .args(["key", "29:1", "47:1", "47:0", "29:0"])
                .output()?;
        }
    } else {
        Command::new("xdotool")
            .args(["key", "--clearmodifiers", "ctrl+v"])
            .output()?;
    }

    Ok(())
}
