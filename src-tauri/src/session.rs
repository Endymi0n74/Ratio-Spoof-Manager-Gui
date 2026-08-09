use anyhow::Result;
use chrono::{DateTime, Local};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::process::ProcessHandle;

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
    pub last_announce: Option<DateTime<Local>>,
    pub total_uploaded_mb: f64,
    pub total_downloaded_mb: f64,
    pub current_upload_speed: f64,
    pub current_download_speed: f64,
    pub ratio: f64,
    pub logs: Vec<LogEntry>,
    pub progress_percent: f64,
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

pub struct SessionManager {
    sessions: Arc<DashMap<String, SessionState>>,
    processes: Arc<DashMap<String, tokio::task::JoinHandle<()>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            processes: Arc::new(DashMap::new()),
        }
    }

    pub async fn create_session(&self, config: SessionConfig) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let state = SessionState {
            id: id.clone(),
            config: config.clone(),
            status: SessionStatus::Starting,
            created_at: Local::now(),
            last_announce: None,
            total_uploaded_mb: 0.0,
            total_downloaded_mb: 0.0,
            current_upload_speed: 0.0,
            current_download_speed: 0.0,
            ratio: 0.0,
            logs: vec![LogEntry {
                timestamp: Local::now(),
                level: LogLevel::Info,
                source: "manager".to_string(),
                message: "Session initialisée".to_string(),
            }],
            progress_percent: 0.0,
        };

        self.sessions.insert(id.clone(), state);

        // Build args for ratio-spoof
        let args = vec![
            "-t".to_string(), config.torrent_path,
            "-d".to_string(), config.downloaded,
            "-ds".to_string(), config.dl_speed,
            "-u".to_string(), config.uploaded,
            "-us".to_string(), config.ul_speed,
            "-p".to_string(), config.port.to_string(),
            "-c".to_string(), config.client,
        ];

        let engine = config.engine_path.clone();
        let sessions = self.sessions.clone();
        let id_clone = id.clone();

        let handle = tokio::spawn(async move {
            match ProcessHandle::spawn(&engine, args, None).await {
                Ok(mut proc) => {
                    {
                        let mut s = sessions.get_mut(&id_clone).unwrap();
                        s.status = SessionStatus::Running;
                        s.logs.push(LogEntry {
                            timestamp: Local::now(),
                            level: LogLevel::Info,
                            source: "manager".to_string(),
                            message: "Moteur démarré".to_string(),
                        });
                    }

                    // Read stdout
                    while let Some(line) = proc.stdout_rx.recv().await {
                        let mut s = sessions.get_mut(&id_clone).unwrap();
                        let log = parse_log_line(&line);
                        s.logs.push(log.clone());
                        update_stats_from_log(&mut s, &log);
                        if s.logs.len() > 500 {
                            s.logs.remove(0);
                        }
                    }

                    let _ = proc.child.wait().await;
                    {
                        let mut s = sessions.get_mut(&id_clone).unwrap();
                        s.status = SessionStatus::Stopped;
                        s.logs.push(LogEntry {
                            timestamp: Local::now(),
                            level: LogLevel::Info,
                            source: "manager".to_string(),
                            message: "Moteur arrêté".to_string(),
                        });
                    }
                }
                Err(e) => {
                    let mut s = sessions.get_mut(&id_clone).unwrap();
                    s.status = SessionStatus::Error(e.to_string());
                    s.logs.push(LogEntry {
                        timestamp: Local::now(),
                        level: LogLevel::Error,
                        source: "manager".to_string(),
                        message: format!("Échec du démarrage: {}", e),
                    });
                }
            }
        });

        self.processes.insert(id.clone(), handle);
        Ok(id)
    }

    pub fn stop_session(&self, id: &str) -> Result<()> {
        if let Some((_, handle)) = self.processes.remove(id) {
            handle.abort();
        }
        if let Some(mut s) = self.sessions.get_mut(id) {
            s.status = SessionStatus::Stopped;
        }
        Ok(())
    }

    pub fn pause_session(&self, id: &str) -> Result<()> {
        if let Some(mut s) = self.sessions.get_mut(id) {
            s.status = SessionStatus::Paused;
        }
        Ok(())
    }

    pub fn resume_session(&self, id: &str) -> Result<()> {
        if let Some(mut s) = self.sessions.get_mut(id) {
            s.status = SessionStatus::Running;
        }
        Ok(())
    }

    pub fn get_session(&self, id: &str) -> Option<SessionState> {
        self.sessions.get(id).map(|s| s.clone())
    }

    pub fn get_all_sessions(&self) -> Vec<SessionState> {
        self.sessions.iter().map(|s| s.clone()).collect()
    }

    pub fn get_session_logs(&self, id: &str, limit: usize) -> Option<Vec<LogEntry>> {
        self.sessions.get(id).map(|s| {
            let start = s.logs.len().saturating_sub(limit);
            s.logs[start..].to_vec()
        })
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

    // Try to extract speed from log (simplified parsing)
    if msg.contains("uploaded") {
        if let Some(speed) = extract_speed(msg) {
            state.current_upload_speed = speed;
        }
    }
    if msg.contains("downloaded") {
        if let Some(speed) = extract_speed(msg) {
            state.current_download_speed = speed;
        }
    }

    // Update progress based on config
    if let Ok(dl_val) = parse_amount(&state.config.downloaded) {
        if let Ok(total) = parse_amount(&state.config.downloaded) {
            state.progress_percent = (dl_val / total * 100.0).min(100.0);
        }
    }
}

fn extract_speed(msg: &str) -> Option<f64> {
    // Simple regex-like parsing for "X kbps" or "X mbps"
    let msg = msg.to_lowercase();
    if let Some(idx) = msg.find("kbps") {
        let before = &msg[..idx].trim();
        if let Some(num) = before.split_whitespace().last() {
            return num.parse().ok();
        }
    }
    if let Some(idx) = msg.find("mbps") {
        let before = &msg[..idx].trim();
        if let Some(num) = before.split_whitespace().last() {
            return num.parse::<f64>().ok().map(|n| n * 1000.0);
        }
    }
    None
}

fn parse_amount(val: &str) -> Result<f64> {
    let val = val.to_lowercase().replace(',', ".");
    if val.ends_with('%') {
        Ok(val.trim_end_matches('%').parse()?)
    } else if val.ends_with("tb") {
        Ok(val.trim_end_matches("tb").parse::<f64>()? * 1024.0 * 1024.0)
    } else if val.ends_with("gb") {
        Ok(val.trim_end_matches("gb").parse::<f64>()? * 1024.0)
    } else if val.ends_with("mb") {
        Ok(val.trim_end_matches("mb").parse::<f64>()?)
    } else if val.ends_with("kb") {
        Ok(val.trim_end_matches("kb").parse::<f64>()? / 1024.0)
    } else if val.ends_with('b') {
        Ok(val.trim_end_matches('b').parse::<f64>()? / 1024.0 / 1024.0)
    } else {
        Ok(val.parse()?)
    }
}
