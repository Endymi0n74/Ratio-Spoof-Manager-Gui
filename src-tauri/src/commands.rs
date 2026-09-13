use tauri::Manager;
use crate::session::{SessionConfig, SessionManager, LogEntry, SessionView};
use crate::settings::AppSettings;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self { success: true, data: Some(data), error: None }
    }
    pub fn err(msg: String) -> Self {
        Self { success: false, data: None, error: Some(msg) }
    }
}

#[derive(Debug, Deserialize)]
pub struct LaunchRequest {
    pub torrent_path: String,
    pub downloaded: String,
    pub dl_speed: String,
    pub uploaded: String,
    pub ul_speed: String,
    pub port: u16,
    pub client: String,
    pub engine_path: String,
}

#[derive(Debug, Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn launch_session(
    req: LaunchRequest,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<String>, String> {
    let config = SessionConfig {
        torrent_path: req.torrent_path,
        downloaded: req.downloaded,
        dl_speed: req.dl_speed,
        uploaded: req.uploaded,
        ul_speed: req.ul_speed,
        port: req.port,
        client: req.client,
        engine_path: req.engine_path,
    };

    match manager.create_session(config).await {
        Ok(id) => Ok(ApiResponse::ok(id)),
        Err(e) => Ok(ApiResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub fn stop_session(
    id: String,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<()>, String> {
    match manager.stop_session(&id) {
        Ok(_) => Ok(ApiResponse::ok(())),
        Err(e) => Ok(ApiResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub fn delete_session(
    id: String,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<()>, String> {
    match manager.delete_session(&id) {
        Ok(_) => Ok(ApiResponse::ok(())),
        Err(e) => Ok(ApiResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub fn pause_session(
    id: String,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<()>, String> {
    match manager.pause_session(&id) {
        Ok(_) => Ok(ApiResponse::ok(())),
        Err(e) => Ok(ApiResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub fn resume_session(
    id: String,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<()>, String> {
    match manager.resume_session(&id) {
        Ok(_) => Ok(ApiResponse::ok(())),
        Err(e) => Ok(ApiResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub fn get_sessions(
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<Vec<SessionView>>, String> {
    Ok(ApiResponse::ok(manager.get_all_sessions()))
}

#[tauri::command]
pub fn get_sessions_since(
    since: String,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<Vec<SessionView>>, String> {
    // Parse le timestamp ISO depuis le frontend
    match since.parse::<chrono::DateTime<chrono::Utc>>() {
        Ok(dt) => {
            let local = dt.with_timezone(&chrono::Local);
            Ok(ApiResponse::ok(manager.get_sessions_since(local)))
        }
        Err(_) => {
            // Fallback: renvoyer tout si le parse échoue
            Ok(ApiResponse::ok(manager.get_all_sessions()))
        }
    }
}

#[tauri::command]
pub fn get_session_logs(
    id: String,
    limit: Option<usize>,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<Vec<LogEntry>>, String> {
    let limit = limit.unwrap_or(100);
    match manager.get_session_logs(&id, limit) {
        Some(logs) => Ok(ApiResponse::ok(logs)),
        None => Ok(ApiResponse::err("Session not found".to_string())),
    }
}

#[tauri::command]
pub fn get_settings(
    settings: State<'_, Mutex<AppSettings>>,
) -> Result<ApiResponse<AppSettings>, String> {
    let s = settings.lock().map_err(|e| e.to_string())?;
    Ok(ApiResponse::ok(s.clone()))
}

#[tauri::command]
pub fn save_settings(
    new_settings: AppSettings,
    settings: State<'_, Mutex<AppSettings>>,
) -> Result<ApiResponse<()>, String> {
    let mut s = settings.lock().map_err(|e| e.to_string())?;
    *s = new_settings.clone();
    match s.save() {
        Ok(_) => Ok(ApiResponse::ok(())),
        Err(e) => Ok(ApiResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn pick_torrent(
    app: tauri::AppHandle,
) -> Result<ApiResponse<Option<String>>, String> {
    let handle = app.dialog().file().add_filter("Torrent", &["torrent"]);
    let path = tauri::async_runtime::spawn_blocking(move || {
        handle.blocking_pick_file()
    }).await.map_err(|e| e.to_string())?;

    Ok(ApiResponse::ok(path.map(|p| p.to_string())))
}

#[tauri::command]
pub async fn pick_executable(
    app: tauri::AppHandle,
) -> Result<ApiResponse<Option<String>>, String> {
    let handle = app.dialog().file();
    let path = tauri::async_runtime::spawn_blocking(move || {
        handle.blocking_pick_file()
    }).await.map_err(|e| e.to_string())?;

    Ok(ApiResponse::ok(path.map(|p| p.to_string())))
}

#[derive(Debug, Serialize)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub config: PresetConfig,
}

#[derive(Debug, Serialize)]
pub struct PresetConfig {
    pub downloaded: String,
    pub dl_speed: String,
    pub uploaded: String,
    pub ul_speed: String,
    pub port: u16,
}

#[tauri::command]
pub fn get_presets() -> Result<ApiResponse<Vec<Preset>>, String> {
    let presets = vec![
        Preset {
            id: "seed".to_string(),
            name: "Seed pur".to_string(),
            description: "Upload only, download complete".to_string(),
            config: PresetConfig {
                downloaded: "100%".to_string(),
                dl_speed: "0kbps".to_string(),
                uploaded: "0%".to_string(),
                ul_speed: "5mbps".to_string(),
                port: 8999,
            },
        },
        Preset {
            id: "leech".to_string(),
            name: "Leech".to_string(),
            description: "Fast download, no upload".to_string(),
            config: PresetConfig {
                downloaded: "0%".to_string(),
                dl_speed: "10mbps".to_string(),
                uploaded: "0%".to_string(),
                ul_speed: "0kbps".to_string(),
                port: 8999,
            },
        },
        Preset {
            id: "balanced".to_string(),
            name: "Balanced".to_string(),
            description: "Balanced download and upload".to_string(),
            config: PresetConfig {
                downloaded: "50%".to_string(),
                dl_speed: "5mbps".to_string(),
                uploaded: "25%".to_string(),
                ul_speed: "5mbps".to_string(),
                port: 8999,
            },
        },
        Preset {
            id: "ratio_boost".to_string(),
            name: "Ratio boost".to_string(),
            description: "Massive upload to boost ratio".to_string(),
            config: PresetConfig {
                downloaded: "100%".to_string(),
                dl_speed: "0kbps".to_string(),
                uploaded: "0%".to_string(),
                ul_speed: "50mbps".to_string(),
                port: 8999,
            },
        },
    ];
    Ok(ApiResponse::ok(presets))
}

#[tauri::command]
pub fn validate_field(
    value: String,
    #[allow(non_snake_case)] field_type: String,
) -> Result<ApiResponse<ValidationResult>, String> {
    let normalized = value.to_lowercase().replace(',', ".").replace(" ", "");

    let result = match field_type.as_str() {
        "amount" => {
            let re = regex::Regex::new(r"^\d+(?:\.\d+)?(?:%|b|kb|mb|gb|tb)$").unwrap();
            if re.is_match(&normalized) {
                ValidationResult { valid: true, message: None }
            } else {
                ValidationResult { valid: false, message: Some("Invalid format. Use %, b, kb, mb, gb or tb".to_string()) }
            }
        }
        "speed" => {
            let re = regex::Regex::new(r"^\d+(?:\.\d+)?(?:kbps|mbps)$").unwrap();
            if re.is_match(&normalized) {
                ValidationResult { valid: true, message: None }
            } else {
                ValidationResult { valid: false, message: Some("Invalid format. Use kbps or mbps".to_string()) }
            }
        }
        "port" => {
            if let Ok(port) = normalized.parse::<u16>() {
                if port > 0 {
                    ValidationResult { valid: true, message: None }
                } else {
                    ValidationResult { valid: false, message: Some("Port must be > 0".to_string()) }
                }
            } else {
                ValidationResult { valid: false, message: Some("Invalid port".to_string()) }
            }
        }
        _ => ValidationResult { valid: true, message: None },
    };

    Ok(ApiResponse::ok(result))
}

#[tauri::command]
pub async fn minimize_window(app: tauri::AppHandle) -> Result<ApiResponse<()>, String> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize().map_err(|e| e.to_string())?;
        Ok(ApiResponse::ok(()))
    } else {
        Ok(ApiResponse::err("Window not found".to_string()))
    }
}

#[tauri::command]
pub async fn quit_app(
    app: tauri::AppHandle,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<()>, String> {
    // Quitter ne doit pas laisser les moteurs annoncer au tracker en orphelins :
    // on les arrête proprement, puis l'application se ferme.
    let killed = manager.shutdown(crate::process::SHUTDOWN_GRACE_PERIOD).await;
    if killed > 0 {
        eprintln!("{killed} moteur(s) ont dû être tués à la fermeture");
    }
    app.exit(0);
    Ok(ApiResponse::ok(()))
}
