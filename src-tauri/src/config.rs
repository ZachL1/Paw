use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub hotkey: String,
    pub max_history: usize,
    pub auto_clear_days: Option<u32>,
    pub poll_interval_ms: u64,
    pub paste_on_select: bool,
    pub show_source_app: bool,
    pub show_copy_count: bool,
    #[serde(default)]
    pub launch_at_startup: bool,
    #[serde(default)]
    pub hide_tray_menu_actions: bool,
    #[serde(default = "default_show_menu_bar_icon")]
    pub show_menu_bar_icon: bool,
    #[serde(default = "default_preview_delay")]
    pub preview_delay_ms: u64,
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_show_menu_bar_icon() -> bool {
    true
}

fn default_preview_delay() -> u64 {
    1500
}

fn default_language() -> String {
    "system".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hotkey: "Alt+V".to_string(),
            max_history: 1000,
            auto_clear_days: None,
            poll_interval_ms: 500,
            paste_on_select: true,
            show_source_app: true,
            show_copy_count: true,
            launch_at_startup: false,
            hide_tray_menu_actions: false,
            show_menu_bar_icon: true,
            preview_delay_ms: 1500,
            language: "system".to_string(),
        }
    }
}

impl AppConfig {
    fn config_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let config_dir = dirs::config_dir().ok_or("Cannot find config directory")?;
        Ok(config_dir.join("paw").join("config.json"))
    }

    pub fn load() -> Self {
        Self::config_path()
            .ok()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let path = Self::config_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }
}
