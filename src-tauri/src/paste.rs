use arboard::Clipboard;

/// Paste text by writing to clipboard and simulating Ctrl+V (or Cmd+V on macOS)
pub fn paste_text(content: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut clipboard = Clipboard::new()?;
    clipboard.set_text(content)?;

    std::thread::sleep(std::time::Duration::from_millis(50));
    simulate_paste()?;
    Ok(())
}

/// Simulate Cmd+V keystroke using CGEvent (fast, no subprocess)
#[cfg(target_os = "macos")]
pub fn simulate_paste() -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGEventSourceCreate(stateID: i32) -> *mut std::ffi::c_void;
            fn CGEventCreateKeyboardEvent(
                source: *mut std::ffi::c_void,
                virtual_key: u16,
                key_down: bool,
            ) -> *mut std::ffi::c_void;
            fn CGEventSetFlags(event: *mut std::ffi::c_void, flags: u64);
            fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
            fn CFRelease(cf: *mut std::ffi::c_void);
        }

        let source = CGEventSourceCreate(0); // kCGEventSourceStateCombinedSessionState
        if source.is_null() {
            return Err("Failed to create CGEventSource".into());
        }

        // Virtual key code for 'V' is 9
        let key_v: u16 = 9;
        // kCGEventFlagMaskCommand = 0x00100000
        let cmd_flag: u64 = 0x00100000;

        let key_down = CGEventCreateKeyboardEvent(source, key_v, true);
        let key_up = CGEventCreateKeyboardEvent(source, key_v, false);

        if key_down.is_null() || key_up.is_null() {
            CFRelease(source);
            return Err("Failed to create CGEvent".into());
        }

        CGEventSetFlags(key_down, cmd_flag);
        CGEventSetFlags(key_up, cmd_flag);

        // kCGHIDEventTap = 0
        CGEventPost(0, key_down);
        CGEventPost(0, key_up);

        CFRelease(key_down);
        CFRelease(key_up);
        CFRelease(source);
    }

    Ok(())
}

/// Simulate Ctrl+V keystroke (clipboard must already contain desired content)
#[cfg(target_os = "linux")]
pub fn simulate_paste() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        let result = std::process::Command::new("wtype")
            .args(["-M", "ctrl", "-P", "v", "-p", "v", "-m", "ctrl"])
            .output();

        match result {
            Ok(output) if output.status.success() => {}
            _ => {
                let output = std::process::Command::new("ydotool")
                    .args(["key", "29:1", "47:1", "47:0", "29:0"])
                    .output()?;
                if !output.status.success() {
                    return Err("Both wtype and ydotool failed to simulate paste".into());
                }
            }
        }
    } else {
        let output = std::process::Command::new("xdotool")
            .args(["key", "--clearmodifiers", "ctrl+v"])
            .output()?;
        if !output.status.success() {
            return Err(format!(
                "xdotool failed with exit code: {:?}",
                output.status.code()
            ).into());
        }
    }

    Ok(())
}
