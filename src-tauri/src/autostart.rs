use std::fs;
use std::path::PathBuf;

/// Enable or disable launching Paw at system startup.
/// On Linux: manages ~/.config/autostart/paw.desktop
/// On macOS: manages ~/Library/LaunchAgents/com.paw.app.plist
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_path = exe.to_string_lossy().to_string();

    #[cfg(target_os = "linux")]
    {
        set_autostart_linux(enabled, &exe_path)
    }

    #[cfg(target_os = "macos")]
    {
        set_autostart_macos(enabled, &exe_path)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = (enabled, exe_path);
        Err("Auto-start is not supported on this platform".to_string())
    }
}

#[cfg(target_os = "linux")]
fn autostart_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    Ok(home.join(".config").join("autostart").join("paw.desktop"))
}

#[cfg(target_os = "linux")]
fn escape_desktop_exec(path: &str) -> String {
    path.replace('\\', "\\\\").replace(' ', "\\ ")
}

#[cfg(target_os = "linux")]
fn set_autostart_linux(enabled: bool, exe_path: &str) -> Result<(), String> {
    let path = autostart_path()?;

    if enabled {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=Paw\n\
             Comment=Clipboard manager\n\
             Exec={}\n\
             Icon=paw\n\
             Hidden=false\n\
             NoDisplay=false\n\
             X-GNOME-Autostart-enabled=true\n",
            escape_desktop_exec(exe_path)
        );
        fs::write(&path, content).map_err(|e| e.to_string())?;
    } else if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn plist_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    Ok(home
        .join("Library")
        .join("LaunchAgents")
        .join("com.paw.app.plist"))
}

#[cfg(target_os = "macos")]
fn set_autostart_macos(enabled: bool, exe_path: &str) -> Result<(), String> {
    let path = plist_path()?;

    if enabled {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
             <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \
             \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
             <plist version=\"1.0\">\n\
             <dict>\n\
             \t<key>Label</key>\n\
             \t<string>com.paw.app</string>\n\
             \t<key>ProgramArguments</key>\n\
             \t<array>\n\
             \t\t<string>{exe_path}</string>\n\
             \t</array>\n\
             \t<key>RunAtLoad</key>\n\
             \t<true/>\n\
             \t<key>KeepAlive</key>\n\
             \t<false/>\n\
             </dict>\n\
             </plist>\n"
        );
        fs::write(&path, content).map_err(|e| e.to_string())?;
        // Load the plist immediately so it takes effect without a reboot
        let _ = std::process::Command::new("launchctl")
            .args(["load", "-w", &path.to_string_lossy()])
            .status();
    } else if path.exists() {
        let _ = std::process::Command::new("launchctl")
            .args(["unload", "-w", &path.to_string_lossy()])
            .status();
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    Ok(())
}
