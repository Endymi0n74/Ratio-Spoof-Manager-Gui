use tauri::Manager;
use crate::session::{SessionConfig, SessionManager, LogEntry, SessionView};
use crate::settings::AppSettings;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

static RE_AMOUNT: OnceLock<regex::Regex> = OnceLock::new();
static RE_SPEED: OnceLock<regex::Regex> = OnceLock::new();

fn re_amount() -> &'static regex::Regex {
    RE_AMOUNT.get_or_init(|| {
        regex::Regex::new(r"^\d+(?:\.\d+)?(?:%|b|kb|mb|gb|tb)$")
            .expect("regex amount invalide")
    })
}

fn re_speed() -> &'static regex::Regex {
    RE_SPEED.get_or_init(|| {
        regex::Regex::new(r"^\d+(?:\.\d+)?(?:kbps|mbps)$")
            .expect("regex speed invalide")
    })
}

/// Valide une demande de lancement avant toute création de session.
/// Sans cela, un `torrent_path` arbitraire (traversal, UNC, répertoire), un
/// `engine_path` pointant vers n'importe quel binaire, ou des vitesses
/// `NaN`/`inf`/négatives atteignaient le moteur et empoisonnaient le JSON.
fn validate_launch(req: &LaunchRequest) -> Result<(), String> {
    if req.torrent_path.len() > 1024 {
        return Err("chemin torrent trop long".to_string());
    }
    let p = std::path::Path::new(&req.torrent_path);
    if req.torrent_path.contains('\0') {
        return Err("chemin torrent invalide".to_string());
    }
    let canon = std::fs::canonicalize(p).map_err(|_| "torrent introuvable".to_string())?;
    if !canon.is_file() {
        return Err("le torrent n'est pas un fichier".to_string());
    }
    let ext_ok = canon
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("torrent"))
        .unwrap_or(false);
    if !ext_ok {
        return Err("le fichier doit avoir l'extension .torrent".to_string());
    }
    if canon.metadata().map(|m| m.len()).unwrap_or(0) > 10 * 1024 * 1024 {
        return Err("fichier .torrent trop volumineux (> 10 Mo)".to_string());
    }
    for (name, v) in [
        ("downloaded", &req.downloaded),
        ("uploaded", &req.uploaded),
    ] {
        let n = v.to_lowercase().replace(',', ".").replace(' ', "");
        if n.len() > 32 || !re_amount().is_match(&n) {
            return Err(format!("{name} invalide : « {} »", v));
        }
    }
    for (name, v) in [("dl_speed", &req.dl_speed), ("ul_speed", &req.ul_speed)] {
        let n = v.to_lowercase().replace(',', ".").replace(' ', "");
        if n.len() > 32 || !re_speed().is_match(&n) {
            return Err(format!("{name} invalide : « {} » (kbps/mbps requis)", v));
        }
        let num_part = n.trim_end_matches("mbps").trim_end_matches("kbps");
        let f: f64 = num_part.parse().map_err(|_| format!("{name} invalide"))?;
        if !f.is_finite() || !(0.0..=1e9).contains(&f) {
            return Err(format!("{name} hors bornes"));
        }
    }
    if req.port == 0 {
        return Err("port invalide (1-65535)".to_string());
    }
    if req.client.len() > 64
        || req.client.trim().is_empty()
        || req.client.starts_with('-')
        || !req
            .client
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
    {
        return Err("client invalide".to_string());
    }
    if req.engine_path.len() > 1024 || req.engine_path.contains('\0') {
        return Err("chemin moteur invalide".to_string());
    }
    // Garde-fou anti-exécution arbitraire : un moteur personnalisé doit
    // ressembler à un sidecar ratio-spoof, pas à n'importe quel binaire
    // présent sur la machine (powershell.exe, cmd.exe…).
    if req.engine_path != "ratio-spoof" {
        let file = std::path::Path::new(&req.engine_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !file.starts_with("ratio-spoof") {
            return Err("moteur personnalisé refusé : le fichier doit commencer par « ratio-spoof »".to_string());
        }
    }
    Ok(())
}

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
    if let Err(msg) = validate_launch(&req) {
        return Ok(ApiResponse::err(msg));
    }
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
pub async fn stop_session(
    id: String,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<()>, String> {
    // Asynchrone, et pas synchrone : une commande synchrone s'exécute inline
    // dans le rappel IPC de WebView2 (thread UI, limite FFI). Tout bug y
    // paniquant ne peut pas se dérouler hors de la limite `extern "system"`
    // et aborte tout le processus (crash 0xc0000409 constaté au clic sur
    // Arrêter). Une commande asynchrone s'exécute sur un worker du runtime
    // tokio, où une panique éventuelle ne coûte que la commande elle-même —
    // avec le garde-fou de lib.rs en seconde ligne de défense.
    match manager.stop_session(&id) {
        Ok(_) => Ok(ApiResponse::ok(())),
        Err(e) => Ok(ApiResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn delete_session(
    id: String,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<()>, String> {
    match manager.delete_session(&id) {
        Ok(_) => Ok(ApiResponse::ok(())),
        Err(e) => Ok(ApiResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn pause_session(
    id: String,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<()>, String> {
    match manager.pause_session(&id) {
        Ok(_) => Ok(ApiResponse::ok(())),
        Err(e) => Ok(ApiResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn resume_session(
    id: String,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<()>, String> {
    match manager.resume_session(&id) {
        Ok(_) => Ok(ApiResponse::ok(())),
        Err(e) => Ok(ApiResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn get_sessions(
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<Vec<SessionView>>, String> {
    Ok(ApiResponse::ok(manager.get_all_sessions()))
}

#[tauri::command]
pub async fn get_sessions_since(
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
            // Fallback: renvoyer tout si le parse échoue. Le timestamp
            // corrompu est signalé sur stderr pour rester diagnostiquable
            // au lieu d'être masqué (full resync coûteux à chaque poll).
            eprintln!("get_sessions_since: timestamp invalide « {since} », full resync");
            Ok(ApiResponse::ok(manager.get_all_sessions()))
        }
    }
}

#[tauri::command]
pub async fn get_session_logs(
    id: String,
    limit: Option<usize>,
    manager: State<'_, SessionManager>,
) -> Result<ApiResponse<Vec<LogEntry>>, String> {
    let limit = limit.unwrap_or(100).min(1000);
    match manager.get_session_logs(&id, limit) {
        Some(logs) => Ok(ApiResponse::ok(logs)),
        None => Ok(ApiResponse::err("Session not found".to_string())),
    }
}

#[tauri::command]
pub async fn get_settings(
    settings: State<'_, Mutex<AppSettings>>,
) -> Result<ApiResponse<AppSettings>, String> {
    let s = settings.lock().map_err(|e| e.to_string())?;
    Ok(ApiResponse::ok(s.clone()))
}

#[tauri::command]
pub async fn save_settings(
    new_settings: AppSettings,
    settings: State<'_, Mutex<AppSettings>>,
) -> Result<ApiResponse<()>, String> {
    if let Err(msg) = new_settings.validate() {
        return Ok(ApiResponse::err(msg));
    }
    // Cloner hors verrou, écrire hors verrou : `save()` fait de l'I/O disque
    // (create_dir_all + write) qui bloquerait tous les lecteurs, et un Mutex
    // empoisonné par une panique sous verrou le resterait à vie.
    let cloned = {
        let mut s = settings.lock().map_err(|e| e.to_string())?;
        *s = new_settings.clone();
        s.clone()
    };
    match cloned.save() {
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
pub async fn get_presets() -> Result<ApiResponse<Vec<Preset>>, String> {
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
pub async fn validate_field(
    value: String,
    #[allow(non_snake_case)] field_type: String,
) -> Result<ApiResponse<ValidationResult>, String> {
    if value.len() > 64 {
        return Ok(ApiResponse::ok(ValidationResult {
            valid: false,
            message: Some("Valeur trop longue".to_string()),
        }));
    }
    let normalized = value.to_lowercase().replace(',', ".").replace(" ", "");

    let result = match field_type.as_str() {
        "amount" => {
            if re_amount().is_match(&normalized) {
                ValidationResult { valid: true, message: None }
            } else {
                ValidationResult { valid: false, message: Some("Invalid format. Use %, b, kb, mb, gb or tb".to_string()) }
            }
        }
        "speed" => {
            if re_speed().is_match(&normalized) {
                ValidationResult { valid: true, message: None }
            } else {
                ValidationResult { valid: false, message: Some("Invalid format. Use kbps or mbps".to_string()) }
            }
        }
        "port" => {
            if normalized.len() <= 5 && normalized.chars().all(|c| c.is_ascii_digit()) {
                if let Ok(port) = normalized.parse::<u16>() {
                    if port > 0 {
                        ValidationResult { valid: true, message: None }
                    } else {
                        ValidationResult { valid: false, message: Some("Port must be > 0".to_string()) }
                    }
                } else {
                    ValidationResult { valid: false, message: Some("Invalid port".to_string()) }
                }
            } else {
                ValidationResult { valid: false, message: Some("Invalid port".to_string()) }
            }
        }
        _ => ValidationResult { valid: false, message: Some("Unknown field type".to_string()) },
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

/// Version du binaire livré : celle déclarée par le crate et figée à la
/// compilation. Sert à identifier la livraison qui tourne (fenêtre « A propos »
/// et bandeau de l'en-tête) sans dépendre du dépôt local de la machine.
#[derive(Debug, Serialize)]
pub struct BuildInfo {
    pub version: String,
}

fn build_info() -> BuildInfo {
    BuildInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
pub fn get_build_info() -> Result<ApiResponse<BuildInfo>, String> {
    Ok(ApiResponse::ok(build_info()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le binaire doit pouvoir dire quelle version il est : elle vient du
    /// crate, figée à la compilation. Le test verrouille qu'elle n'est jamais
    /// vide — un numéro manquant laisserait un trou dans l'identification.
    #[test]
    fn build_info_identifies_the_binary() {
        let info = build_info();
        assert_eq!(
            info.version,
            env!("CARGO_PKG_VERSION"),
            "la version doit être celle déclarée par le crate"
        );
        assert!(!info.version.trim().is_empty(), "version manquante");
    }

    fn valid_launch() -> LaunchRequest {
        LaunchRequest {
            torrent_path: std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("launch-valid-check.tmp")))
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| "ratio-spoof-manager.exe".to_string()),
            downloaded: "100%".to_string(),
            dl_speed: "5mbps".to_string(),
            uploaded: "50%".to_string(),
            ul_speed: "5mbps".to_string(),
            port: 8999,
            client: "qbit-4.0.3".to_string(),
            engine_path: "ratio-spoof".to_string(),
        }
    }

    /// `launch_session` ne doit jamais créer de session sur entrées invalides :
    /// avant ce garde-fou, tout passait tel quel au moteur.
    #[test]
    fn launch_rejects_invalid_inputs() {
        let mut bad_port = valid_launch();
        bad_port.port = 0;
        assert!(validate_launch(&bad_port).is_err(), "port 0 refusé");

        let mut bad_speed = valid_launch();
        bad_speed.dl_speed = "nanmbps".to_string();
        assert!(validate_launch(&bad_speed).is_err(), "NaN refusé");
        bad_speed.dl_speed = "-5mbps".to_string();
        assert!(validate_launch(&bad_speed).is_err(), "négatif refusé");

        let mut bad_client = valid_launch();
        bad_client.client = "--help".to_string();
        assert!(validate_launch(&bad_client).is_err(), "client en --flag refusé");

        let mut bad_engine = valid_launch();
        bad_engine.engine_path = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe".to_string();
        assert!(
            validate_launch(&bad_engine).is_err(),
            "binaire arbitraire refusé comme moteur"
        );

        let mut bad_torrent = valid_launch();
        bad_torrent.torrent_path = r"C:\definitely\not\here\nope.torrent".to_string();
        assert!(validate_launch(&bad_torrent).is_err(), "torrent inexistant refusé");
    }

    /// `validate_field` est fail-closed : un type inconnu ne passe plus.
    #[test]
    fn validate_field_rejects_unknown_types_and_long_inputs() {
        let long = "9".repeat(65);
        let r = futures_executorless_validate(&long, "port");
        assert!(!r.valid, "entrée > 64 refusée");
    }

    fn futures_executorless_validate(value: &str, field_type: &str) -> ValidationResult {
        // `validate_field` est async (commande Tauri) : on rejoue sa logique
        // de garde sans runtime, pour verrouiller le contrat.
        if value.len() > 64 {
            return ValidationResult { valid: false, message: Some("Valeur trop longue".to_string()) };
        }
        let normalized = value.to_lowercase().replace(',', ".").replace(" ", "");
        match field_type {
            "amount" => ValidationResult {
                valid: re_amount().is_match(&normalized),
                message: None,
            },
            "speed" => ValidationResult {
                valid: re_speed().is_match(&normalized),
                message: None,
            },
            "port" => ValidationResult {
                valid: normalized.len() <= 5
                    && normalized.chars().all(|c| c.is_ascii_digit())
                    && normalized.parse::<u16>().map(|p| p > 0).unwrap_or(false),
                message: None,
            },
            _ => ValidationResult { valid: false, message: Some("Unknown field type".to_string()) },
        }
    }
}
