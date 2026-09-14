use anyhow::{anyhow, Result};
use chrono::{DateTime, Local};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::process::{force_kill, request_graceful_stop, ProcessHandle, STOP_GRACE_PERIOD};

// Limite de logs en mémoire par session (rotation)
const MAX_LOGS_PER_SESSION: usize = 200;
// Nombre de logs renvoyés par l'API (pas besoin de tout cloner)
const API_LOG_LIMIT: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub torrent_path: String,
    pub downloaded: String,
    pub dl_speed: String,
    pub uploaded: String,
    pub ul_speed: String,
    pub port: u16,
    pub client: String,
    pub engine_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub id: String,
    pub config: SessionConfig,
    pub status: SessionStatus,
    pub created_at: DateTime<Local>,
    pub last_update: DateTime<Local>,
    pub last_announce: Option<DateTime<Local>>,
    pub total_uploaded_mb: f64,
    pub total_downloaded_mb: f64,
    pub current_upload_speed: f64,
    pub current_download_speed: f64,
    pub ratio: f64,
    pub logs: Vec<LogEntry>,
    pub progress_percent: f64,
    pub elapsed_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Starting,
    Running,
    Paused,
    Stopping,
    Stopped,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: DateTime<Local>,
    pub level: LogLevel,
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
    Tracker,
    Debug,
}

/// Vue légère d'une session pour l'API (sans tous les logs)
#[derive(Debug, Clone, Serialize)]
pub struct SessionView {
    pub id: String,
    pub config: SessionConfig,
    pub status: SessionStatus,
    pub created_at: DateTime<Local>,
    pub last_update: DateTime<Local>,
    pub last_announce: Option<DateTime<Local>>,
    pub total_uploaded_mb: f64,
    pub total_downloaded_mb: f64,
    pub current_upload_speed: f64,
    pub current_download_speed: f64,
    pub ratio: f64,
    pub logs: Vec<LogEntry>,
    pub progress_percent: f64,
    pub elapsed_seconds: u64,
}

pub struct SessionManager {
    sessions: Arc<DashMap<String, SessionState>>,
    // Handle Tauri (et non tokio) : les tâches sont créées via
    // `tauri::async_runtime::spawn` pour rester valables depuis un thread hors
    // runtime (cf. régression 0xc0000409).
    processes: Arc<DashMap<String, tauri::async_runtime::JoinHandle<()>>>,
    /// Pid du moteur par session : permet de lui adresser un signal d'arrêt
    /// depuis `stop_session`, indépendamment de la tâche qui lit sa sortie.
    pids: Arc<DashMap<String, u32>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            processes: Arc::new(DashMap::new()),
            pids: Arc::new(DashMap::new()),
        }
    }

    pub async fn create_session(&self, config: SessionConfig) -> Result<String> {
        // Résout le moteur avant de créer l'état de session : si le sidecar est
        // absent du bundle ou si le chemin personnalisé est invalide, l'erreur
        // remonte directement à l'interface au lieu de laisser une session
        // fantôme bloquée en « Starting ».
        let engine_path = crate::process::resolve_engine_path(&config.engine_path)?;
        let engine = engine_path.to_string_lossy().to_string();

        let id = Uuid::new_v4().to_string();
        let now = Local::now();
        let state = SessionState {
            id: id.clone(),
            config: config.clone(),
            status: SessionStatus::Starting,
            created_at: now,
            last_update: now,
            last_announce: None,
            total_uploaded_mb: 0.0,
            total_downloaded_mb: 0.0,
            current_upload_speed: 0.0,
            current_download_speed: 0.0,
            ratio: 0.0,
            logs: vec![LogEntry {
                timestamp: now,
                level: LogLevel::Info,
                source: "manager".to_string(),
                message: format!("Session initialisée (moteur : {})", engine_path.display()),
            }],
            progress_percent: 0.0,
            elapsed_seconds: 0,
        };

        self.sessions.insert(id.clone(), state);

        let args = vec![
            "-t".to_string(), config.torrent_path,
            "-d".to_string(), config.downloaded,
            "-ds".to_string(), config.dl_speed,
            "-u".to_string(), config.uploaded,
            "-us".to_string(), config.ul_speed,
            "-p".to_string(), config.port.to_string(),
            "-c".to_string(), config.client,
        ];

        let sessions = self.sessions.clone();
        let pids = self.pids.clone();
        let id_clone = id.clone();

        // `tauri::async_runtime::spawn` plutôt que `tokio::spawn` : la tâche
        // doit pouvoir être créée même depuis un thread hors runtime (commande
        // synchrone, tests) au lieu de paniquer.
        let handle = tauri::async_runtime::spawn(async move {
            match ProcessHandle::spawn(&engine, args, None).await {
                Ok(mut proc) => {
                    // La session peut disparaître à tout instant (bouton ✕,
                    // arrêt demandé pendant le démarrage) : chaque accès se
                    // fait donc sans `unwrap()`, une panique ici tuerait
                    // l'application entière. Si la session a été supprimée, le
                    // drop de `proc` (`kill_on_drop`) tue le moteur.
                    if let Some(mut s) = sessions.get_mut(&id_clone) {
                        s.status = SessionStatus::Running;
                        s.last_update = Local::now();
                        push_log(&mut s, LogLevel::Info, "manager", "Moteur démarré");
                    }
                    // Perte éventuelle de la garantie anti-orphelin : elle ne se
                    // voit nulle part ailleurs (l'application tourne normalement),
                    // donc elle doit apparaître dans le journal de la session.
                    log_orphan_protection(&sessions, &id_clone, proc.job_warning.as_deref());

                    if let Some(pid) = proc.pid() {
                        pids.insert(id_clone.clone(), pid);
                    }

                    while let Some(line) = proc.output_rx.recv().await {
                        if let Some(mut s) = sessions.get_mut(&id_clone) {
                            let log = parse_log_line(&line);
                            update_stats_from_log(&mut s, &log);
                            push_log(&mut s, log.level, &log.source, &log.message);
                        }
                    }

                    let _ = proc.child.wait().await;
                    // Le moteur a quitté : plus rien à signaler pour cette session.
                    pids.remove(&id_clone);
                    if let Some(mut s) = sessions.get_mut(&id_clone) {
                        s.status = SessionStatus::Stopped;
                        s.last_update = Local::now();
                        push_log(&mut s, LogLevel::Info, "manager", "Moteur arrêté");
                    }
                }
                Err(e) => {
                    if let Some(mut s) = sessions.get_mut(&id_clone) {
                        s.status = SessionStatus::Error(e.to_string());
                        s.last_update = Local::now();
                        push_log(&mut s, LogLevel::Error, "manager", &format!("Échec du démarrage: {}", e));
                    }
                }
            }
        });

        self.processes.insert(id.clone(), handle);
        Ok(id)
    }

    /// Arrête le moteur d'une session.
    ///
    /// L'ancienne version se contentait d'annuler la tâche de lecture : le
    /// `Child` était alors simplement abandonné, donc le processus continuait
    /// d'annoncer au tracker en orphelin pendant que l'interface affichait
    /// « arrêté ». Ici le moteur reçoit un vrai signal d'arrêt (équivalent de
    /// `SIGTERM`), ce qui lui permet d'envoyer son annonce finale ; à défaut, il
    /// est tué de force après le délai de grâce.
    pub fn stop_session(&self, id: &str) -> Result<()> {
        let pid = match self.pids.get(id).map(|entry| *entry.value()) {
            Some(pid) => pid,
            None => {
                // Moteur pas encore lancé (arrêt demandé pendant le démarrage) ou
                // déjà sorti : il n'y a plus de processus à signaler.
                if let Some((_, handle)) = self.processes.remove(id) {
                    handle.abort();
                }
                self.mark_stopped(id);
                return Ok(());
            }
        };

        // Session inconnue du backend (restaurée côté interface uniquement) :
        // un `ok_or_else` ici transformerait le clic en erreur 500 sans
        // information — la session n'a de toute façon rien à arrêter.
        if !self.sessions.contains_key(id) {
            return Ok(());
        }

        {
            let mut s = self
                .sessions
                .get_mut(id)
                .ok_or_else(|| anyhow!("session inconnue : {id}"))?;
            if s.status == SessionStatus::Stopped {
                return Ok(());
            }
            s.status = SessionStatus::Stopping;
            s.last_update = Local::now();
            push_log(
                &mut s,
                LogLevel::Info,
                "manager",
                "Arrêt propre demandé au moteur",
            );
        }

        // La tâche de lecture n'est plus référencée, mais elle n'est pas annulée :
        // elle doit continuer à lire la sortie du moteur pour recueillir son
        // annonce finale « stopped », puis passera elle-même la session en
        // « arrêté ».
        self.processes.remove(id);

        if let Err(e) = request_graceful_stop(pid) {
            self.log(id, LogLevel::Warn, &format!("{e} — arrêt forcé immédiat"));
            self.kill_now(id, pid);
            return Ok(());
        }

        // Filet de sécurité : un moteur coincé dans sa boucle de retry réseau peut
        // ignorer le signal. On lui laisse le délai de grâce, puis on le tue.
        //
        // `tauri::async_runtime::spawn` et non `tokio::spawn` : `stop_session`
        // est appelée depuis le dispatch IPC, qui peut ne pas être un worker
        // tokio — un `tokio::spawn` y panique (« Must be called from the context
        // of a Tokio 1.x runtime ») et, la panique remontant dans le rappel
        // WebView2 FFI, abortait le processus (crash 0xc0000409 au clic sur
        // Arrêter). Elle part donc sur le runtime global de Tauri.
        let pids = self.pids.clone();
        let sessions = self.sessions.clone();
        let id = id.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(STOP_GRACE_PERIOD).await;
            if !pids.contains_key(&id) {
                return; // déjà arrêté proprement
            }
            match force_kill(pid) {
                Ok(()) => push_log_shared(
                    &sessions,
                    &id,
                    LogLevel::Warn,
                    &format!(
                        "Moteur tué de force : il n'a pas répondu au signal d'arrêt en {} s",
                        STOP_GRACE_PERIOD.as_secs()
                    ),
                ),
                Err(e) => push_log_shared(&sessions, &id, LogLevel::Error, &e.to_string()),
            }
        });

        Ok(())
    }

    /// Supprime une session : tue son moteur s'il vit encore, puis retire
    /// l'état de la carte et des listes.
    ///
    /// Idempotente : supprimer une session déjà absente réussit. Les sessions
    /// restaurées du localStorage n'existent que côté interface (leurs moteurs
    /// sont morts avec l'application précédente) et leur ✕ doit fonctionner
    /// comme celui d'une session que le backend connaît.
    pub fn delete_session(&self, id: &str) -> Result<()> {
        // La tâche de lecture est annulée avant toute autre opération : une fois
        // l'état retiré, ses `get_mut().unwrap()` ne doivent plus jamais être
        // atteints. Son `Child` est lâché à cette occasion et `kill_on_drop`
        // tue alors le moteur s'il vivait encore.
        if let Some((_, handle)) = self.processes.remove(id) {
            handle.abort();
        }
        if let Some(pid) = self.pids.get(id).map(|entry| *entry.value()) {
            self.pids.remove(id);
            if let Err(e) = force_kill(pid) {
                // Déjà sorti tout seul entre le retrait de la tâche et ici :
                // rien à tuer, ce n'est pas un échec de la suppression.
                eprintln!("moteur déjà absent lors de la suppression (pid {pid}) : {e}");
            }
        }
        let _ = self.sessions.remove(id);
        Ok(())
    }

    /// Tue le moteur immédiatement (signal refusé par le système).
    fn kill_now(&self, id: &str, pid: u32) {
        match force_kill(pid) {
            Ok(()) => self.log(id, LogLevel::Warn, "Moteur tué sans arrêt propre"),
            Err(e) => self.log(id, LogLevel::Error, &e.to_string()),
        }
    }

    fn mark_stopped(&self, id: &str) {
        if let Some(mut s) = self.sessions.get_mut(id) {
            s.status = SessionStatus::Stopped;
            s.last_update = Local::now();
        }
    }

    fn log(&self, id: &str, level: LogLevel, message: &str) {
        push_log_shared(&self.sessions, id, level, message);
    }

    /// Arrête tous les moteurs, pour la fermeture de l'application.
    ///
    /// Sans cela, quitter la fenêtre laissait les moteurs orphelins continuer à
    /// annoncer au tracker jusqu'à la mort de la machine. Le délai de grâce
    /// borne l'attente : les moteurs qui n'ont pas répondu sont tués, et leur
    /// nombre est renvoyé pour information.
    pub async fn shutdown(&self, grace: Duration) -> usize {
        let ids: Vec<String> = self.pids.iter().map(|entry| entry.key().clone()).collect();
        for id in &ids {
            if let Err(e) = self.stop_session(id) {
                eprintln!("arrêt de la session {id} impossible : {e}");
            }
        }

        let deadline = tokio::time::Instant::now() + grace;
        while tokio::time::Instant::now() < deadline {
            if self.pids.is_empty() {
                return 0;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        let leftovers: Vec<(String, u32)> = self
            .pids
            .iter()
            .map(|entry| (entry.key().clone(), *entry.value()))
            .collect();
        let mut killed = 0;
        for (id, pid) in leftovers {
            if force_kill(pid).is_ok() {
                killed += 1;
            }
            self.pids.remove(&id);
        }
        killed
    }

    pub fn pause_session(&self, id: &str) -> Result<()> {
        if let Some(mut s) = self.sessions.get_mut(id) {
            s.status = SessionStatus::Paused;
            s.last_update = Local::now();
        }
        Ok(())
    }

    pub fn resume_session(&self, id: &str) -> Result<()> {
        if let Some(mut s) = self.sessions.get_mut(id) {
            s.status = SessionStatus::Running;
            s.last_update = Local::now();
        }
        Ok(())
    }

    /// Renvoie toutes les sessions avec seulement les N derniers logs (pas de clone massif)
    pub fn get_all_sessions(&self) -> Vec<SessionView> {
        let now = Local::now();
        self.sessions.iter().map(|entry| {
            let s = entry.value();
            to_view_limited(s, now, API_LOG_LIMIT)
        }).collect()
    }

    /// Renvoie seulement les sessions modifiées depuis un timestamp (API diff)
    pub fn get_sessions_since(&self, since: DateTime<Local>) -> Vec<SessionView> {
        let now = Local::now();
        self.sessions
            .iter()
            .filter(|entry| entry.value().last_update > since)
            .map(|entry| {
                let s = entry.value();
                to_view_limited(s, now, API_LOG_LIMIT)
            })
            .collect()
    }

    pub fn get_session_logs(&self, id: &str, limit: usize) -> Option<Vec<LogEntry>> {
        self.sessions.get(id).map(|s| {
            let start = s.logs.len().saturating_sub(limit);
            s.logs[start..].to_vec()
        })
    }
}

/// Porte au journal de la session toute perte de la garantie « aucun moteur ne
/// survit à l'application » : un `eprintln!` côté backend serait invisible dans
/// une application GUI, et l'utilisateur croirait la protection active.
fn log_orphan_protection(
    sessions: &DashMap<String, SessionState>,
    id: &str,
    warning: Option<&str>,
) {
    if let Some(warning) = warning {
        push_log_shared(sessions, id, LogLevel::Warn, warning);
    }
}

/// Ajoute un log depuis un contexte qui n'a pas déjà l'état de la session en
/// main (tâches de fond : garde-fou d'arrêt forcé).
fn push_log_shared(
    sessions: &DashMap<String, SessionState>,
    id: &str,
    level: LogLevel,
    message: &str,
) {
    if let Some(mut s) = sessions.get_mut(id) {
        s.last_update = Local::now();
        push_log(&mut s, level, "manager", message);
    }
}

/// Ajoute un log avec rotation automatique
fn push_log(state: &mut SessionState, level: LogLevel, source: &str, message: &str) {
    state.logs.push(LogEntry {
        timestamp: Local::now(),
        level,
        source: source.to_string(),
        message: message.to_string(),
    });
    if state.logs.len() > MAX_LOGS_PER_SESSION {
        // Rotation: supprime les plus anciens par batch de 50 pour éviter le shift constant
        let to_remove = state.logs.len() - MAX_LOGS_PER_SESSION + 50;
        state.logs.drain(0..to_remove.min(state.logs.len()));
    }
}

/// Convertit avec calcul des stats et slice de logs
fn to_view_limited(state: &SessionState, now: DateTime<Local>, log_limit: usize) -> SessionView {
    let elapsed = now.signed_duration_since(state.created_at).num_seconds().max(0) as u64;
    let mut total_uploaded = state.total_uploaded_mb;
    let mut total_downloaded = state.total_downloaded_mb;
    let mut upload_speed = state.current_upload_speed;
    let mut download_speed = state.current_download_speed;
    let mut ratio = state.ratio;
    let progress = state.progress_percent;

    // Fallback temporel si la session tourne : estimation par la vitesse
    // configurée (l'engine l'applique en octets/seconde, cf. input.go).
    if state.status == SessionStatus::Running {
        if let Ok(ul_bps) = parse_speed_config(&state.config.ul_speed) {
            let elapsed_secs = elapsed as f64;
            let estimated = ul_bps * elapsed_secs / (1024.0 * 1024.0);
            if total_uploaded < estimated {
                total_uploaded = estimated;
            }
            upload_speed = ul_bps / 1024.0;
        }
        if let Ok(dl_bps) = parse_speed_config(&state.config.dl_speed) {
            let elapsed_secs = elapsed as f64;
            let estimated = dl_bps * elapsed_secs / (1024.0 * 1024.0);
            if total_downloaded < estimated {
                total_downloaded = estimated;
            }
            download_speed = dl_bps / 1024.0;
        }
        if total_downloaded > 0.0 {
            ratio = (total_uploaded / total_downloaded).min(999.9);
        }
    }

    let logs_start = state.logs.len().saturating_sub(log_limit);
    let logs = state.logs[logs_start..].to_vec();

    SessionView {
        id: state.id.clone(),
        config: state.config.clone(),
        status: state.status.clone(),
        created_at: state.created_at,
        last_update: state.last_update,
        last_announce: state.last_announce,
        total_uploaded_mb: total_uploaded,
        total_downloaded_mb: total_downloaded,
        current_upload_speed: upload_speed,
        current_download_speed: download_speed,
        ratio,
        logs,
        progress_percent: progress,
        elapsed_seconds: elapsed,
    }
}

fn parse_log_line(line: &str) -> LogEntry {
    let line = line.trim();
    let timestamp = Local::now();

    if line.contains("announce") || line.contains("tracker") {
        LogEntry {
            timestamp,
            level: LogLevel::Tracker,
            source: "tracker".to_string(),
            message: line.to_string(),
        }
    } else if line.contains("error") || line.contains("Error") || line.contains("FAIL") {
        LogEntry {
            timestamp,
            level: LogLevel::Error,
            source: "engine".to_string(),
            message: line.to_string(),
        }
    } else if line.contains("warn") || line.contains("Warning") {
        LogEntry {
            timestamp,
            level: LogLevel::Warn,
            source: "engine".to_string(),
            message: line.to_string(),
        }
    } else {
        LogEntry {
            timestamp,
            level: LogLevel::Info,
            source: "engine".to_string(),
            message: line.to_string(),
        }
    }
}

/// Alimente les statistiques depuis la sortie réelle du moteur (printer.go),
/// dont les valeurs sont au format IEC sans espace : « 800.00MiB ».
///
/// Deux familles de lignes :
/// - l'annonce, toutes les ~30 s : `#1 downloaded: 800.00MiB(4.00%) | left:
///   19.20GiB | uploaded: 200.00MiB | next announce in: 4m26s` — elle porte
///   les **totaux cumulés** réels côté tracker ;
/// - le bloc rafraîchi chaque seconde : `Download Speed: 2.00MiB/s`,
///   `Upload Speed: 500.00KiB/s`, `Size: 30.00GiB`.
fn update_stats_from_log(state: &mut SessionState, log: &LogEntry) {
    let msg = &log.message;
    let now = Local::now();

    state.last_update = now;
    state.elapsed_seconds = now.signed_duration_since(state.created_at).num_seconds().max(0) as u64;

    let msg_lower = msg.to_lowercase();

    // Totaux : la ligne d'annonce fait foi, on ne garde que les valeurs
    // croissantes (chaque annonce repart de l'état cumulé du tracker).
    if msg_lower.contains("downloaded:") {
        state.last_announce = Some(now);
        if let Some(bytes) = parse_size_after(&msg_lower, "downloaded:") {
            let total_mb = bytes / (1024.0 * 1024.0);
            if total_mb > state.total_downloaded_mb {
                state.total_downloaded_mb = total_mb;
            }
        }
        if let Some(pct) = parse_percent_after(&msg_lower, "downloaded:") {
            state.progress_percent = pct;
        }
        if let Some(bytes) = parse_size_after(&msg_lower, "uploaded:") {
            let total_mb = bytes / (1024.0 * 1024.0);
            if total_mb > state.total_uploaded_mb {
                state.total_uploaded_mb = total_mb;
            }
        }
        if state.total_downloaded_mb > 0.0 {
            state.ratio = (state.total_uploaded_mb / state.total_downloaded_mb).min(999.9);
        }
    }

    // Vitesses (valeur déjà par seconde) ; l'affichage attend des kB/s
    // (binaires : le KB/s affiché est un KiB/s, comme partout dans l'interface).
    if msg_lower.contains("download speed:") {
        if let Some(bps) = parse_speed_after(&msg_lower, "download speed:") {
            state.current_download_speed = bps / 1024.0;
        }
    }
    if msg_lower.contains("upload speed:") {
        if let Some(bps) = parse_speed_after(&msg_lower, "upload speed:") {
            state.current_upload_speed = bps / 1024.0;
        }
    }
}

/// Convertit la saisie utilisateur en **octets par seconde**, la convention du
/// moteur (input.go : « 5mbps » = 5 × 1024 × 1024 o/s ; seuls « kbps » et
/// « mbps » sont acceptés, tout comme par `extractInputByteSpeed`). Une valeur
/// sans unité est refusée : le moteur la rejetterait aussi.
fn parse_speed_config(val: &str) -> Result<f64> {
    let val = val.to_lowercase().replace(',', ".").replace(' ', "");
    if let Some(num) = val.strip_suffix("mbps") {
        Ok(num.parse::<f64>()? * 1024.0 * 1024.0)
    } else if let Some(num) = val.strip_suffix("kbps") {
        Ok(num.parse::<f64>()? * 1024.0)
    } else {
        Err(anyhow!("vitesse sans unité kbps/mbps : « {} »", val))
    }
}

/// Analyse « <nombre><unité> » juste après un mot-clé — sans espace entre les
/// deux, au format `humanReadableSize` de printer.go — et renvoie la valeur
/// avec son unité (minuscules, l'appelant passe déjà une chaîne lowercasée).
fn number_and_unit_after(msg_lower: &str, keyword: &str) -> Option<(f64, String)> {
    let idx = msg_lower.find(keyword)?;
    let after = &msg_lower[idx + keyword.len()..];
    let bytes = after.as_bytes();
    let mut i = 0;
    while i < bytes.len() && !bytes[i].is_ascii_digit() && bytes[i] != b'.' {
        i += 1;
    }
    let num_start = i;
    let mut dots = 0;
    while i < bytes.len() && (bytes[i].is_ascii_digit() || (bytes[i] == b'.' && dots == 0)) {
        if bytes[i] == b'.' {
            dots += 1;
        }
        i += 1;
    }
    if num_start == i {
        return None;
    }
    let val: f64 = after[num_start..i].parse().ok()?;
    let unit: String = after[i..].chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    if unit.is_empty() {
        return None;
    }
    Some((val, unit))
}

/// Multiplicateur vers octets d'une unité IEC du moteur (B, KiB, MiB, GiB, TiB).
fn iec_multiplier(unit: &str) -> Option<f64> {
    match unit {
        "tib" => Some(1024f64.powi(4)),
        "gib" => Some(1024f64.powi(3)),
        "mib" => Some(1024f64.powi(2)),
        "kib" => Some(1024.0),
        "b" => Some(1.0),
        _ => None,
    }
}

/// Taille qui suit un mot-clé (« downloaded: 800.00MiB »), en octets.
fn parse_size_after(msg_lower: &str, keyword: &str) -> Option<f64> {
    let (val, unit) = number_and_unit_after(msg_lower, keyword)?;
    Some(val * iec_multiplier(&unit)?)
}

/// Vitesse qui suit un mot-clé (« Upload Speed: 500.00KiB/s »), en octets par
/// seconde — le « /s » du format n'a pas besoin d'être consommé.
fn parse_speed_after(msg_lower: &str, keyword: &str) -> Option<f64> {
    parse_size_after(msg_lower, keyword)
}

/// Pourcentage entre parenthèses qui suit un mot-clé : « downloaded:
/// 800.00MiB(4.00%) » → 4.0.
fn parse_percent_after(msg_lower: &str, keyword: &str) -> Option<f64> {
    let idx = msg_lower.find(keyword)?;
    let after = &msg_lower[idx + keyword.len()..];
    let open = after.find('(')?;
    let inner = &after[open + 1..];
    let end = inner.find(')')?;
    let val: f64 = extract_first_number(&inner[..end])?.parse().ok()?;
    (0.0..=100.0).contains(&val).then_some(val)
}

fn extract_first_number(s: &str) -> Option<&str> {
    let chars: Vec<char> = s.chars().collect();
    let mut start = 0;
    while start < chars.len() && !chars[start].is_ascii_digit() && chars[start] != '.' && chars[start] != '-' {
        start += 1;
    }
    if start >= chars.len() { return None; }
    let mut end = start;
    let mut dot_count = 0;
    while end < chars.len() {
        let c = chars[end];
        if c.is_ascii_digit() {
            end += 1;
        } else if c == '.' && dot_count == 0 {
            dot_count += 1;
            end += 1;
        } else {
            break;
        }
    }
    if start < end { Some(&s[start..end]) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_with_id(id: &str) -> SessionState {
        let now = Local::now();
        SessionState {
            id: id.to_string(),
            config: SessionConfig {
                torrent_path: "exemple.torrent".to_string(),
                downloaded: "100%".to_string(),
                dl_speed: "0kbps".to_string(),
                uploaded: "0%".to_string(),
                ul_speed: "5mbps".to_string(),
                port: 8999,
                client: "qBittorrent".to_string(),
                engine_path: "ratio-spoof".to_string(),
            },
            status: SessionStatus::Running,
            created_at: now,
            last_update: now,
            last_announce: None,
            total_uploaded_mb: 0.0,
            total_downloaded_mb: 0.0,
            current_upload_speed: 0.0,
            current_download_speed: 0.0,
            ratio: 0.0,
            logs: Vec::new(),
            progress_percent: 0.0,
            elapsed_seconds: 0,
        }
    }

    /// Les extracteurs doivent coller au format réel de printer.go : valeurs IEC
    /// sans espace (« 800.00MiB »). Les anciens parsers cherchaient « mb »/« gb »
    /// et « mbps » — ils ne matchaient jamais rien de la sortie du moteur.
    #[test]
    fn announce_line_feeds_totals_progress_and_ratio() {
        let mut s = session_with_id("s1");
        let line = parse_log_line(
            "#1 downloaded: 800.00MiB(4.00%) | left: 19.20GiB | uploaded: 200.00MiB | next announce in: 4m26s",
        );
        update_stats_from_log(&mut s, &line);

        assert!((s.total_downloaded_mb - 800.0).abs() < 1e-9, "{}", s.total_downloaded_mb);
        assert!((s.total_uploaded_mb - 200.0).abs() < 1e-9, "{}", s.total_uploaded_mb);
        assert!((s.progress_percent - 4.0).abs() < 1e-9, "{}", s.progress_percent);
        assert!((s.ratio - 0.25).abs() < 1e-9, "{}", s.ratio);
        assert!(s.last_announce.is_some(), "la ligne d'annonce date la dernière annonce");
    }

    /// Les totaux ne font qu'augmenter : une annonce qui repartirait derrière
    /// (redémarrage, réordonnancement) ne doit pas régresser l'affichage.
    #[test]
    fn announce_totals_never_decrease() {
        let mut s = session_with_id("s1");
        for total in ["100.00MiB", "250.00MiB", "50.00MiB"] {
            let line = parse_log_line(&format!("#2 downloaded: {total}(1.00%) | left: 0B | uploaded: 10.00MiB | announced"));
            update_stats_from_log(&mut s, &line);
        }
        assert!((s.total_downloaded_mb - 250.0).abs() < 1e-9, "{}", s.total_downloaded_mb);
    }

    #[test]
    fn iec_units_are_converted_to_bytes() {
        assert_eq!(parse_size_after("downloaded: 1.50gib", "downloaded:"), Some(1.5 * 1024.0 * 1024.0 * 1024.0));
        assert_eq!(parse_size_after("size: 500.00mib", "size:"), Some(500.0 * 1024.0 * 1024.0));
        assert_eq!(parse_size_after("x: 2.00kib", "x:"), Some(2048.0));
        assert_eq!(parse_size_after("x: 7.00b", "x:"), Some(7.0));
        assert_eq!(parse_size_after("x: 1.00zb", "x:"), None, "unité inconnue : refuser plutôt que deviner");
        assert_eq!(parse_size_after("x: aucun", "x:"), None);
    }

    /// Le bloc d'en-tête (rafraîchi chaque seconde) alimente les vitesses
    /// courantes — en kB/s côté affichage — sans toucher aux totaux.
    #[test]
    fn header_block_feeds_current_speeds_in_kbps() {
        let mut s = session_with_id("s1");
        update_stats_from_log(&mut s, &parse_log_line("Download Speed: 2.00MiB/s"));
        update_stats_from_log(&mut s, &parse_log_line("Upload Speed: 512.00KiB/s"));

        assert!((s.current_download_speed - 2048.0).abs() < 1e-6, "{}", s.current_download_speed);
        assert!((s.current_upload_speed - 512.0).abs() < 1e-6, "{}", s.current_upload_speed);
        assert_eq!(s.total_downloaded_mb, 0.0, "l'en-tête ne doit pas faire office de total");
    }

    /// L'estimateur de secours parle désormais octets/seconde, convention du
    /// moteur (input.go : 1 mbps = 1024×1024 o/s, seuls kbps/mbps existent).
    #[test]
    fn parse_speed_config_uses_engine_byte_convention() {
        assert_eq!(parse_speed_config("5mbps").unwrap(), 5.0 * 1024.0 * 1024.0);
        assert_eq!(parse_speed_config("512kbps").unwrap(), 512.0 * 1024.0);
        assert_eq!(parse_speed_config("5 MBPS").unwrap(), 5.0 * 1024.0 * 1024.0);
        assert!(parse_speed_config("5").is_err(), "le moteur refuse une vitesse sans unité");
    }

    /// Supprimer doit retirer la session des listes — et rester sûr à rejouer :
    /// une session restaurée côté interface n'existe que là, et son ✕ ne doit
    /// pas se plaindre que le backend l'ignore.
    #[test]
    fn delete_removes_the_session_and_is_idempotent() {
        let manager = SessionManager::new();
        manager
            .sessions
            .insert("s1".to_string(), session_with_id("s1"));

        manager
            .delete_session("s1")
            .expect("supprimer une session existante doit réussir");
        assert!(
            !manager.sessions.contains_key("s1"),
            "la session supprimée ne doit plus apparaître"
        );
        manager
            .delete_session("s1")
            .expect("supprimer une session absente doit réussir aussi");
        assert!(manager.sessions.get("s1").is_none());
    }

    /// La perte de la garantie anti-orphelin ne peut pas se contenter d'une
    /// sortie d'erreur : elle doit finir dans le journal de la session, là où
    /// l'utilisateur regarde.
    #[test]
    fn orphan_protection_loss_is_journaled() {
        let sessions: DashMap<String, SessionState> = DashMap::new();
        sessions.insert("s1".to_string(), session_with_id("s1"));

        log_orphan_protection(
            &sessions,
            "s1",
            Some("Protection anti-orphelin inactive : job Windows indisponible"),
        );

        let entry = sessions
            .get("s1")
            .and_then(|s| s.logs.last().cloned())
            .expect("l'avertissement doit être présent dans le journal");
        assert!(
            matches!(entry.level, LogLevel::Warn),
            "la perte de la garantie doit être signalée en avertissement"
        );
        assert!(entry.message.contains("anti-orphelin"), "{}", entry.message);

        // Et rien quand le moteur est réellement protégé : le journal ne doit pas
        // s'alarmer à chaque lancement.
        let before = sessions.get("s1").unwrap().logs.len();
        log_orphan_protection(&sessions, "s1", None);
        assert_eq!(sessions.get("s1").unwrap().logs.len(), before);
    }

    /// Régression du crash 0xc0000409 : cliquer sur « Arrêter » fermait
    /// l'application entière. `stop_session` était exécutée inline dans le
    /// rappel IPC de WebView2 (thread hors runtime tokio) et y appelait
    /// `tokio::spawn` — panique immédiate, qui ne peut pas se dérouler hors
    /// d'une limite `extern "system"` et abortait le processus.
    ///
    /// Le test reproduit les deux conditions du crash : appel depuis un simple
    /// thread (pas un worker tokio) sur une session dont le moteur a un pid.
    /// La simulation d'un vrai moteur n'étant pas triviale, le pid est
    /// volontairement inexistant : `request_graceful_stop` échoue, la branche
    /// de secours tue, la session passe « arrêté » — et surtout rien ne
    /// panique. Avec l'ancien code, ce test mourrait avant l'assertion.
    #[test]
    fn stop_session_from_a_non_runtime_thread_does_not_panic() {
        let manager = SessionManager::new();
        manager.sessions.insert("s1".to_string(), session_with_id("s1"));
        // pid fictif : la session croit avoir un moteur vivant, comme au moment
        // du crash, mais rien de réel à signaler.
        manager.pids.insert("s1".to_string(), 999_999);

        let result = manager.stop_session("s1");
        assert!(
            result.is_ok(),
            "arrêter une session dont le moteur est déjà parti doit réussir : {:?}",
            result.err()
        );
        assert_eq!(
            manager.sessions.get("s1").map(|s| s.status.clone()),
            Some(SessionStatus::Stopping),
            "sans moteur réel à observer, la session reste « arrêt en cours » : \
             c'est la tâche de lecture du vrai moteur qui prononce l'arrêt final"
        );
        let last = manager.sessions.get("s1").and_then(|s| s.logs.last().cloned());
        assert!(
            matches!(last.map(|l| l.level), Some(LogLevel::Error | LogLevel::Warn)),
            "l'échec du signal puis de la mise à mort doit être journalisé"
        );
    }

    /// Arrêter deux fois (double-clic sur le bouton) ou une session inconnue
    /// (restaurée côté interface uniquement) doit rester sans effet ni erreur :
    /// le clic ne doit jamais se transformer en échec bloquant.
    #[test]
    fn stop_session_is_idempotent_and_tolerates_unknown_ids() {
        let manager = SessionManager::new();
        manager.sessions.insert("s1".to_string(), session_with_id("s1"));
        manager
            .stop_session("s1")
            .expect("premier arrêt (sans moteur lancé) doit réussir");
        manager
            .stop_session("s1")
            .expect("second arrêt doit réussir aussi");
        manager
            .stop_session("inconnue")
            .expect("arrêter une session que le backend ignore doit réussir");
    }
}
