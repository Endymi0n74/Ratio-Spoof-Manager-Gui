use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// Réglages persistés sur disque.
///
/// `#[serde(default)]` est indispensable : le frontend n'envoie que les champs
/// qu'il connaît, et un champ manquant ferait échouer `serde` → la sauvegarde
/// retournait une erreur à chaque fois (« Parametres appliques (non
/// persistes) ») sans jamais rien écrire.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
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
    /// Fréquence d'interrogation du backend (secondes) ; 0 = valeur par défaut
    /// côté interface (2 s).
    pub polling_interval_sec: u16,
    /// Ratio cible déclenchant l'alerte ; 0 = 2.0 côté interface.
    pub ratio_target: f64,
    pub auto_restart: bool,
    pub theme: String,
}

impl AppSettings {
    pub fn load() -> Mutex<Self> {
        let settings = Self::load_from_disk().unwrap_or_default();
        Mutex::new(settings)
    }

    fn settings_path() -> Option<PathBuf> {
        dirs::data_dir().map(|p| p.join("RatioSpoofManager").join("settings.json"))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Régression : le frontend n'envoie que les champs qu'il connaît (port,
    /// client, polling, ratio, auto_restart, theme). Sans `#[serde(default)]`,
    /// un champ manquant faisait échouer la désérialisation entière — et
    /// `save_settings` renvoyait donc systématiquement une erreur (« Parametres
    /// appliques (non persistes) ») sans jamais rien écrire sur disque.
    #[test]
    fn partial_settings_json_from_the_frontend_deserializes() {
        let json = r#"{
            "default_port": 8999,
            "default_client": "qbit-4.0.3",
            "polling_interval_sec": 2,
            "ratio_target": 2.5,
            "auto_restart": false,
            "theme": "dark"
        }"#;

        let settings: AppSettings =
            serde_json::from_str(json).expect("un envoi partiel du frontend doit passer");

        assert_eq!(settings.default_port, 8999);
        assert_eq!(settings.default_client, "qbit-4.0.3");
        assert_eq!(settings.polling_interval_sec, 2);
        assert_eq!(settings.ratio_target, 2.5);
        assert!(!settings.auto_restart);
        assert_eq!(settings.theme, "dark");
        // Champs non pilotés par l'interface : valeur par défaut, jamais une
        // erreur de désérialisation.
        assert_eq!(settings.default_dl_speed, "");
        assert!(settings.custom_engine_path.is_none());
    }

    /// Un fichier vide ou corrompu retombe sur les réglages par défaut : le
    /// démarrage ne doit jamais échouer à cause de `settings.json`.
    #[test]
    fn unreadable_or_empty_settings_fall_back_to_defaults() {
        let settings: AppSettings =
            serde_json::from_str("").unwrap_or_default();
        assert_eq!(settings.default_port, 0);

        assert!(AppSettings::default().polling_interval_sec == 0);
    }
}
