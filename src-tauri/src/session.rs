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
    processes: Arc<DashMap<String, tokio::task::JoinHandle<()>>>,
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

        let handle = tokio::spawn(async move {
            match ProcessHandle::spawn(&engine, args, None).await {
                Ok(mut proc) => {
                    {
                        let mut s = sessions.get_mut(&id_clone).unwrap();
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
                        let mut s = sessions.get_mut(&id_clone).unwrap();
                        let log = parse_log_line(&line);
                        update_stats_from_log(&mut s, &log);
                        push_log(&mut s, log.level, &log.source, &log.message);
                    }

                    let _ = proc.child.wait().await;
                    // Le moteur a quitté : plus rien à signaler pour cette session.
                    pids.remove(&id_clone);
                    {
                        let mut s = sessions.get_mut(&id_clone).unwrap();
                        s.status = SessionStatus::Stopped;
                        s.last_update = Local::now();
                        push_log(&mut s, LogLevel::Info, "manager", "Moteur arrêté");
                    }
                }
                Err(e) => {
                    let mut s = sessions.get_mut(&id_clone).unwrap();
                    s.status = SessionStatus::Error(e.to_string());
                    s.last_update = Local::now();
                    push_log(&mut s, LogLevel::Error, "manager", &format!("Échec du démarrage: {}", e));
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
        let pids = self.pids.clone();
        let sessions = self.sessions.clone();
        let id = id.to_string();
        tokio::spawn(async move {
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
    /// Le bouton « supprimer » n'apparaît que sur une carte arrêtée, mais la
    /// commande reste défensive : un moteur encore vivant (session en pause ou
    /// démarrage en cours) est tué sans ménagement — supprimer est une action
    /// explicite de destruction, l'arrêt propre reste le rôle du bouton Arrêter.
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
        self.sessions
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| anyhow!("session inconnue : {id}"))
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

    // Fallback temporel si la session tourne
    if state.status == SessionStatus::Running {
        if let Ok(ul_speed_kbps) = parse_speed_config(&state.config.ul_speed) {
            let elapsed_secs = elapsed as f64;
            let estimated = ul_speed_kbps * elapsed_secs / 8.0 / 1024.0;
            if total_uploaded < estimated {
                total_uploaded = estimated;
            }
            upload_speed = ul_speed_kbps;
        }
        if let Ok(dl_speed_kbps) = parse_speed_config(&state.config.dl_speed) {
            let elapsed_secs = elapsed as f64;
            let estimated = dl_speed_kbps * elapsed_secs / 8.0 / 1024.0;
            if total_downloaded < estimated {
                total_downloaded = estimated;
            }
            download_speed = dl_speed_kbps;
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

fn update_stats_from_log(state: &mut SessionState, log: &LogEntry) {
    let msg = &log.message;
    let now = Local::now();

    // Le delta est calculé AVANT de mettre à jour last_update, sinon il vaut toujours ~0
    let prev_update = state.last_update;
    state.last_update = now;
    state.elapsed_seconds = now.signed_duration_since(state.created_at).num_seconds().max(0) as u64;

    let delta_secs = now.signed_duration_since(prev_update).num_seconds().max(0) as f64;
    let msg_lower = msg.to_lowercase();

    if msg_lower.contains("upload") {
        if let Some(speed_kbps) = extract_speed(msg) {
            state.current_upload_speed = speed_kbps;
            if delta_secs > 0.0 {
                state.total_uploaded_mb += speed_kbps * delta_secs / 8.0 / 1024.0;
            }
        }
        if let Some(size_mb) = extract_size_mb(msg) {
            state.total_uploaded_mb = size_mb.max(state.total_uploaded_mb);
        }
    }

    if msg_lower.contains("download") {
        if let Some(speed_kbps) = extract_speed(msg) {
            state.current_download_speed = speed_kbps;
            if delta_secs > 0.0 {
                state.total_downloaded_mb += speed_kbps * delta_secs / 8.0 / 1024.0;
            }
        }
        if let Some(size_mb) = extract_size_mb(msg) {
            state.total_downloaded_mb = size_mb.max(state.total_downloaded_mb);
        }
    }

    if let Some(ratio) = extract_ratio(msg) {
        state.ratio = ratio;
    } else if state.total_downloaded_mb > 0.0 {
        state.ratio = (state.total_uploaded_mb / state.total_downloaded_mb).min(999.9);
    }

    if let Some(progress) = extract_progress_percent(msg) {
        state.progress_percent = progress;
    }

    if msg_lower.contains("announce") || msg_lower.contains("tracker") {
        state.last_announce = Some(now);
    }
}

fn parse_speed_config(val: &str) -> Result<f64> {
    let val = val.to_lowercase().replace(',', ".").replace(" ", "");
    if val.ends_with("mbps") {
        Ok(val.trim_end_matches("mbps").parse::<f64>()? * 1000.0)
    } else if val.ends_with("kbps") {
        Ok(val.trim_end_matches("kbps").parse::<f64>()?)
    } else if val.ends_with("gbps") {
        Ok(val.trim_end_matches("gbps").parse::<f64>()? * 1000.0 * 1000.0)
    } else if val.ends_with("mb/s") {
        Ok(val.trim_end_matches("mb/s").parse::<f64>()? * 8000.0)
    } else if val.ends_with("kb/s") {
        Ok(val.trim_end_matches("kb/s").parse::<f64>()? * 8.0)
    } else if val.ends_with("gb/s") {
        Ok(val.trim_end_matches("gb/s").parse::<f64>()? * 8000.0 * 1000.0)
    } else {
        Ok(val.parse()?)
    }
}

fn extract_speed(msg: &str) -> Option<f64> {
    let msg_lower = msg.to_lowercase();
    let patterns = [
        ("mbps", 1000.0),
        ("mb/s", 1000.0 * 8.0),
        ("kbps", 1.0),
        ("kb/s", 8.0),
        ("gbps", 1000.0 * 1000.0),
        ("gb/s", 1000.0 * 8000.0),
    ];

    for (unit, multiplier) in patterns {
        if let Some(idx) = msg_lower.find(unit) {
            let before = &msg[..idx].trim_end();
            if let Some(num_str) = extract_last_number(before) {
                if let Ok(val) = num_str.parse::<f64>() {
                    return Some(val * multiplier);
                }
            }
        }
    }
    None
}

fn extract_size_mb(msg: &str) -> Option<f64> {
    let msg_lower = msg.to_lowercase();
    let patterns = [
        ("tb", 1024.0 * 1024.0),
        ("gb", 1024.0),
        ("mb", 1.0),
        ("kb", 1.0 / 1024.0),
    ];

    for (unit, multiplier) in patterns {
        if let Some(idx) = msg_lower.find(unit) {
            let before = &msg[..idx].trim_end();
            if let Some(num_str) = extract_last_number(before) {
                if let Ok(val) = num_str.parse::<f64>() {
                    return Some(val * multiplier);
                }
            }
        }
    }
    None
}

fn extract_ratio(msg: &str) -> Option<f64> {
    let msg_lower = msg.to_lowercase();
    if let Some(idx) = msg_lower.find("ratio") {
        let after = &msg[idx + 5..];
        if let Some(num_str) = extract_first_number(after) {
            if let Ok(val) = num_str.parse::<f64>() {
                if (0.0..10000.0).contains(&val) {
                    return Some(val);
                }
            }
        }
    }
    None
}

fn extract_progress_percent(msg: &str) -> Option<f64> {
    let msg_lower = msg.to_lowercase();
    if let Some(idx) = msg_lower.find('%') {
        let before = &msg[..idx].trim_end();
        if let Some(num_str) = extract_last_number(before) {
            if let Ok(val) = num_str.parse::<f64>() {
                return Some(val.min(100.0));
            }
        }
    }
    if let Some(idx) = msg_lower.find("progress") {
        let after = &msg[idx + 8..];
        if let Some(num_str) = extract_first_number(after) {
            if let Ok(val) = num_str.parse::<f64>() {
                return Some(val.min(100.0));
            }
        }
    }
    None
}

fn extract_last_number(s: &str) -> Option<&str> {
    let chars: Vec<char> = s.chars().collect();
    let mut end = chars.len();
    while end > 0 && !chars[end - 1].is_ascii_digit() && chars[end - 1] != '.' {
        end -= 1;
    }
    if end == 0 { return None; }
    let mut start = end;
    let mut dot_count = 0;
    while start > 0 {
        let c = chars[start - 1];
        if c.is_ascii_digit() {
            start -= 1;
        } else if c == '.' && dot_count == 0 {
            dot_count += 1;
            start -= 1;
        } else if c == '-' && start > 0 {
            start -= 1;
            break;
        } else {
            break;
        }
    }
    if start < end { Some(&s[start..end]) } else { None }
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

    /// Supprimer doit retirer la session des listes : une commande qui ne fait
    /// qu'effacer le statut laisserait la carte à l'écran pour toujours.
    #[test]
    fn delete_removes_the_session_and_fails_on_unknown_id() {
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
        assert!(
            manager.delete_session("s1").is_err(),
            "supprimer une session inconnue doit échouer"
        );
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
}
