//! Dev-server subprocess supervision.
//!
//! The Rust core *does not own the bundler*. It spawns whatever dev script the
//! user's own `package.json` declares, captures its stdout/stderr, and watches
//! for a line that matches a known "server is listening" pattern. Compatibility
//! with the ecosystem scales for free: Vite, SvelteKit, Next, Astro, Nuxt, or
//! any wrapper like `portless portfolio vite dev` (the target project).
//!
//! Every lifecycle edge is surfaced as a Tauri event the SPA can subscribe to:
//! - `desktop://dev-server-ready`   (with the captured URL)
//! - `desktop://dev-server-timeout` (with the stdout buffer seen so far)
//! - `desktop://dev-server-exited`  (with exit code + last stderr lines)
//!
//! No auto-respawn, no restart policy. If the child dies, we tell the SPA once
//! and stand down until the user reopens the project.

use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::error::CoreError;

pub const EVENT_READY: &str = "desktop://dev-server-ready";
pub const EVENT_TIMEOUT: &str = "desktop://dev-server-timeout";
pub const EVENT_EXITED: &str = "desktop://dev-server-exited";

const READINESS_TIMEOUT: Duration = Duration::from_secs(60);
const SIGTERM_GRACE: Duration = Duration::from_secs(5);
const LAST_LINES_BUFFER: usize = 20;

/// Regex catalogue for common "local URL" lines. Ordered by specificity:
/// the most framework-specific pattern wins, then fallbacks that just
/// hunt for a `localhost:port` substring. New entries can be appended
/// without touching the supervisor itself.
static READY_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"(?i)local:\s*(?P<url>https?://[^\s]+)").unwrap(),
        Regex::new(r"(?i)ready on\s+(?P<url>https?://[^\s]+)").unwrap(),
        Regex::new(r"(?i)listening on\s+(?P<url>https?://[^\s]+)").unwrap(),
        Regex::new(r"(?P<url>https?://localhost:\d+[^\s]*)").unwrap(),
        Regex::new(r"(?P<url>https?://127\.0\.0\.1:\d+[^\s]*)").unwrap(),
    ]
});

#[derive(Debug, Clone, Serialize)]
pub struct DevServerReadyPayload {
    pub url: String,
    pub pid: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DevServerTimeoutPayload {
    #[serde(rename = "stdoutBuffer")]
    pub stdout_buffer: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DevServerExitedPayload {
    pub code: Option<i32>,
    #[serde(rename = "lastStderr")]
    pub last_stderr: Vec<String>,
}

pub struct DevServerSupervisor {
    child: Option<Arc<Mutex<Child>>>,
    /// PID of the spawned child, captured once so we can signal the
    /// process group on shutdown without re-locking the `Child`.
    pid: Option<i32>,
}

impl DevServerSupervisor {
    pub fn new() -> Self {
        Self {
            child: None,
            pid: None,
        }
    }

    pub async fn start(&mut self, app: AppHandle, project_root: &str) -> Result<(), CoreError> {
        // Starting twice in a row tears the old one down first. Cheaper than
        // forcing callers to orchestrate it from the outside.
        if self.child.is_some() {
            self.stop().await?;
        }

        let mut command = Command::new("bun");
        command
            .arg("run")
            .arg("dev")
            .current_dir(project_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .kill_on_drop(true);

        #[cfg(unix)]
        {
            // Put the child in its own process group so we can signal the
            // whole tree on shutdown (bun often fork-execs vite as a grandchild).
            command.process_group(0);
        }

        let mut child = command
            .spawn()
            .map_err(|e| CoreError::DevServerStart(format!("failed to spawn bun: {e}")))?;

        let pid = child.id().ok_or_else(|| {
            CoreError::DevServerStart("child process had no pid after spawn".into())
        })? as i32;
        self.pid = Some(pid);

        let stdout = child.stdout.take().ok_or_else(|| {
            CoreError::DevServerStart("failed to capture stdout handle".into())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            CoreError::DevServerStart("failed to capture stderr handle".into())
        })?;

        // Shared ring buffer for stderr — watched by one task and read by the
        // exit watcher when the child finally dies. VecDeque so we cap memory.
        let stderr_buf: Arc<Mutex<VecDeque<String>>> =
            Arc::new(Mutex::new(VecDeque::with_capacity(LAST_LINES_BUFFER)));

        let child_arc = Arc::new(Mutex::new(child));
        self.child = Some(child_arc.clone());

        spawn_stdout_watcher(app.clone(), stdout, pid);
        spawn_stderr_watcher(stderr, stderr_buf.clone());
        spawn_exit_watcher(app, child_arc, stderr_buf);

        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), CoreError> {
        let Some(child_arc) = self.child.take() else {
            return Ok(());
        };
        let pid = self.pid.take();

        #[cfg(unix)]
        if let Some(pid) = pid {
            // SIGTERM the whole process group so bun's grandchildren (vite,
            // svelte-kit, convex-dev, …) all get a chance to clean up.
            unsafe {
                libc::kill(-pid, libc::SIGTERM);
            }
        }

        // Give the children `SIGTERM_GRACE` to exit, then hard-kill.
        let _ = tokio::time::timeout(SIGTERM_GRACE, async {
            let mut child = child_arc.lock().await;
            let _ = child.wait().await;
        })
        .await;

        let mut child = child_arc.lock().await;
        let _ = child.start_kill();
        let _ = child.wait().await;

        Ok(())
    }
}

impl Drop for DevServerSupervisor {
    fn drop(&mut self) {
        // Best-effort shutdown if nobody called stop() before dropping us.
        // We can't await inside Drop; we rely on `kill_on_drop(true)` for
        // the direct child and a synchronous SIGTERM for its process group.
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            unsafe {
                libc::kill(-pid, libc::SIGTERM);
            }
        }
    }
}

fn spawn_stdout_watcher(app: AppHandle, stdout: ChildStdout, pid: i32) {
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut emitted_ready = false;
        let mut buffer = String::new();
        let start = std::time::Instant::now();

        while let Ok(Some(line)) = lines.next_line().await {
            buffer.push_str(&line);
            buffer.push('\n');

            if !emitted_ready {
                if let Some(url) = detect_url(&line) {
                    let _ = app.emit(
                        EVENT_READY,
                        DevServerReadyPayload { url, pid },
                    );
                    emitted_ready = true;
                    continue;
                }

                if start.elapsed() >= READINESS_TIMEOUT {
                    let _ = app.emit(
                        EVENT_TIMEOUT,
                        DevServerTimeoutPayload {
                            stdout_buffer: buffer.clone(),
                        },
                    );
                    // Don't re-arm the timeout; keep draining so the exit
                    // watcher still has a chance to report cleanly.
                    emitted_ready = true;
                }
            }
        }
    });
}

fn spawn_stderr_watcher(stderr: ChildStderr, buf: Arc<Mutex<VecDeque<String>>>) {
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut guard = buf.lock().await;
            if guard.len() >= LAST_LINES_BUFFER {
                guard.pop_front();
            }
            guard.push_back(line);
        }
    });
}

fn spawn_exit_watcher(
    app: AppHandle,
    child: Arc<Mutex<Child>>,
    stderr_buf: Arc<Mutex<VecDeque<String>>>,
) {
    tokio::spawn(async move {
        let status = {
            let mut guard = child.lock().await;
            guard.wait().await
        };

        let code = status.ok().and_then(|s| s.code());
        let last_stderr = {
            let guard = stderr_buf.lock().await;
            guard.iter().cloned().collect::<Vec<_>>()
        };

        let _ = app.emit(
            EVENT_EXITED,
            DevServerExitedPayload { code, last_stderr },
        );
    });
}

fn detect_url(line: &str) -> Option<String> {
    for pattern in READY_PATTERNS.iter() {
        if let Some(caps) = pattern.captures(line) {
            if let Some(url_match) = caps.name("url") {
                // Trim trailing punctuation that is common in CLI output.
                return Some(
                    url_match
                        .as_str()
                        .trim_end_matches(&[',', '.', ')'][..])
                        .to_string(),
                );
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_vite_local_url() {
        assert_eq!(
            detect_url("  Local:   http://localhost:5173/"),
            Some("http://localhost:5173/".to_string())
        );
    }

    #[test]
    fn detects_sveltekit_url() {
        assert_eq!(
            detect_url("  ➜  Local:   http://localhost:5174/"),
            Some("http://localhost:5174/".to_string())
        );
    }

    #[test]
    fn detects_127_loopback() {
        assert_eq!(
            detect_url("server listening on http://127.0.0.1:3000"),
            Some("http://127.0.0.1:3000".to_string())
        );
    }

    #[test]
    fn ignores_non_url_lines() {
        assert_eq!(detect_url("compiling client routes…"), None);
        assert_eq!(detect_url("  VITE v7.2.6  ready in 412 ms"), None);
    }
}
