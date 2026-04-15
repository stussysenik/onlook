//! Bun sidecar supervisor.
//!
//! Spawns the `apps/desktop/sidecar/index.ts` Bun process, owns its `Child`
//! handle, and talks to it over stdio using a length-prefixed JSON protocol.
//! Each frame is a little-endian u32 length followed by that many bytes of
//! UTF-8 JSON. Requests and responses share a `id` field so we can match
//! pairs asynchronously.
//!
//! The supervisor is a "call/response" facade: the SPA calls an IPC command,
//! which acquires the supervisor, sends a request, awaits the matching
//! response, and returns it. No concurrent in-flight requests in v1 — one
//! user, one window, one at a time. If we later need pipelining, the Arc<Mutex>
//! shape around `self.child_stdin` can grow a request registry without
//! breaking callers.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::error::CoreError;

pub const EVENT_SIDECAR_CRASHED: &str = "desktop://sidecar-crashed";

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[allow(dead_code)] // Ping / ParseSource round out the protocol even though
                   // Rust currently only calls ParseFile / EmitEdit.
enum SidecarRequest {
    Ping {
        id: String,
    },
    ParseSource {
        id: String,
        framework: String,
        source: String,
    },
    ParseFile {
        id: String,
        framework: String,
        path: String,
    },
    EmitEdit {
        id: String,
        document: Value,
        action: Value,
    },
}

#[derive(Debug, Deserialize)]
struct SidecarResponseEnvelope {
    id: String,
    ok: bool,
    #[serde(flatten)]
    body: Value,
}

/// The supervisor owns whatever it spawned. `Option<...>` lets us represent
/// "no project loaded yet" without an extra state type.
pub struct SidecarSupervisor {
    child: Option<Arc<Mutex<Child>>>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    stdout: Option<Arc<Mutex<ChildStdout>>>,
    counter: u64,
}

impl SidecarSupervisor {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            stdout: None,
            counter: 0,
        }
    }

    pub async fn start(&mut self, app: AppHandle, project_root: &str) -> Result<(), CoreError> {
        if self.child.is_some() {
            self.stop().await?;
        }

        // Path to the sidecar script. At dev time, this is the file in the
        // repo. At bundle time, Tauri's `resource_dir` would serve it —
        // deferred to a later proposal, not this one.
        let sidecar_script = sidecar_script_path();

        let mut child = Command::new("bun")
            .arg("run")
            .arg(sidecar_script)
            .current_dir(project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| CoreError::SidecarStart(format!("failed to spawn sidecar: {e}")))?;

        let stdin = child.stdin.take().ok_or_else(|| {
            CoreError::SidecarStart("sidecar stdin missing after spawn".into())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            CoreError::SidecarStart("sidecar stdout missing after spawn".into())
        })?;

        self.stdin = Some(Arc::new(Mutex::new(stdin)));
        self.stdout = Some(Arc::new(Mutex::new(stdout)));
        let child_arc = Arc::new(Mutex::new(child));
        self.child = Some(child_arc.clone());

        // Watch for unexpected exits. If this task ever fires, the sidecar
        // died mid-session — we tell the SPA and mark ourselves unusable,
        // but we do NOT auto-respawn.
        tokio::spawn({
            let app = app.clone();
            async move {
                let status = {
                    let mut guard = child_arc.lock().await;
                    guard.wait().await
                };
                let _ = app.emit(
                    EVENT_SIDECAR_CRASHED,
                    serde_json::json!({
                        "code": status.ok().and_then(|s| s.code()),
                    }),
                );
            }
        });

        // First frame from the sidecar is a hello. Reading it confirms the
        // process is alive AND that the frame codec agrees with ours.
        let _ = self.read_frame().await?;
        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), CoreError> {
        self.stdin = None;
        self.stdout = None;
        let Some(child_arc) = self.child.take() else {
            return Ok(());
        };
        let mut child = child_arc.lock().await;
        let _ = child.start_kill();
        let _ = child.wait().await;
        Ok(())
    }

    pub async fn parse_file(&mut self, path: &str, framework: &str) -> Result<Value, CoreError> {
        let id = self.next_id();
        let req = SidecarRequest::ParseFile {
            id: id.clone(),
            framework: framework.to_string(),
            path: path.to_string(),
        };
        self.call(&id, req).await
    }

    pub async fn emit_edit(&mut self, document: Value, action: Value) -> Result<Value, CoreError> {
        let id = self.next_id();
        let req = SidecarRequest::EmitEdit {
            id: id.clone(),
            document,
            action,
        };
        self.call(&id, req).await
    }

    fn next_id(&mut self) -> String {
        self.counter += 1;
        format!("req_{}", self.counter)
    }

    async fn call(&mut self, id: &str, req: SidecarRequest) -> Result<Value, CoreError> {
        let frame = encode_frame(&req)?;
        {
            let Some(stdin) = self.stdin.as_ref() else {
                return Err(CoreError::SidecarCall("sidecar not started".into()));
            };
            let mut guard = stdin.lock().await;
            guard
                .write_all(&frame)
                .await
                .map_err(|e| CoreError::SidecarCall(format!("write failed: {e}")))?;
            guard
                .flush()
                .await
                .map_err(|e| CoreError::SidecarCall(format!("flush failed: {e}")))?;
        }

        let response = self.read_frame().await?;
        if response.id != id {
            return Err(CoreError::SidecarCall(format!(
                "sidecar response id mismatch: expected {id}, got {}",
                response.id
            )));
        }
        if !response.ok {
            let message = response
                .body
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown sidecar error")
                .to_string();
            return Err(CoreError::SidecarCall(message));
        }
        Ok(response.body)
    }

    async fn read_frame(&mut self) -> Result<SidecarResponseEnvelope, CoreError> {
        let Some(stdout) = self.stdout.as_ref() else {
            return Err(CoreError::SidecarCall("sidecar not started".into()));
        };
        let mut guard = stdout.lock().await;

        let mut len_buf = [0u8; 4];
        guard
            .read_exact(&mut len_buf)
            .await
            .map_err(|e| CoreError::SidecarCall(format!("frame length read failed: {e}")))?;
        let len = u32::from_le_bytes(len_buf) as usize;

        let mut payload = vec![0u8; len];
        guard
            .read_exact(&mut payload)
            .await
            .map_err(|e| CoreError::SidecarCall(format!("frame body read failed: {e}")))?;

        let envelope: SidecarResponseEnvelope = serde_json::from_slice(&payload)?;
        Ok(envelope)
    }
}

impl Drop for SidecarSupervisor {
    fn drop(&mut self) {
        // `kill_on_drop(true)` on the Child plus tokio's `Drop` will send
        // SIGKILL for us. No extra work needed.
    }
}

fn encode_frame<T: Serialize>(value: &T) -> Result<Vec<u8>, CoreError> {
    let bytes = serde_json::to_vec(value)?;
    let mut frame = Vec::with_capacity(4 + bytes.len());
    frame.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    frame.extend_from_slice(&bytes);
    Ok(frame)
}

fn sidecar_script_path() -> PathBuf {
    // At dev time the sidecar file sits next to the Cargo crate. Using the
    // manifest dir makes this robust against `bun --filter desktop tauri dev`
    // from any working directory.
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    crate_dir.join("..").join("sidecar").join("index.ts")
}
