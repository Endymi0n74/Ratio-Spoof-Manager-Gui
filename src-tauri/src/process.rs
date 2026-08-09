use anyhow::Result;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub struct ProcessHandle {
    pub child: Child,
    pub stdout_rx: mpsc::Receiver<String>,
    pub stderr_rx: mpsc::Receiver<String>,
}

impl ProcessHandle {
    pub async fn spawn(
        executable: &str,
        args: Vec<String>,
        cwd: Option<&str>,
    ) -> Result<Self> {
        let mut cmd = Command::new(executable);
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        #[cfg(windows)]
        {
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn()?;

        let (stdout_tx, stdout_rx) = mpsc::channel(100);
        let (stderr_tx, stderr_rx) = mpsc::channel(100);

        if let Some(stdout) = child.stdout.take() {
            let tx = stdout_tx;
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx.send(line).await;
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let tx = stderr_tx;
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx.send(line).await;
                }
            });
        }

        Ok(ProcessHandle {
            child,
            stdout_rx,
            stderr_rx,
        })
    }

    pub async fn kill(&mut self) -> Result<()> {
        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;
            if let Some(id) = self.child.id() {
                let _ = kill(Pid::from_raw(id as i32), Signal::SIGTERM);
            }
        }
        #[cfg(windows)]
        {
            let _ = self.child.kill().await;
        }
        Ok(())
    }
}
