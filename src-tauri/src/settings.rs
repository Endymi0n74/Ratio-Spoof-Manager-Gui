use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::api::path::app_data_dir;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    pub default_downloaded: String,
    pub default_dl_speed: String,
    pub default_uploaded: String,
    pub default_ul_speed: String,
    pub default_port: u16,
    pub default_client: String,
    pub custom_engine_path: Option<String>,
    pub use_embedded_engine: bool,
    pub notifications_enabled: bool,
    pub minimize_to_tray: bool,
}

impl AppSettings {
    pub fn load() -> Mutex<Self> {
        let settings = Self::load_from_disk().unwrap_or_default();
        Mutex::new(settings)
    }

    fn settings_path() -> Option<PathBuf> {
        app_data_dir(&Default::default()).map(|p| p.join("settings.json"))
    }

    fn load_from_disk() -> Option<Self> {
        let path = Self::settings_path()?;
        let content = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = Self::settings_path()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine app data dir"))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }
}
