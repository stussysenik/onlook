//! Onlook Next desktop shell — Rust core.
//!
//! The Rust side is intentionally a thin plumbing layer. It owns three things:
//!
//! 1. `projects`      — opens a local folder, validates it, returns a [`ProjectHandle`].
//! 2. `dev_server`    — supervises the project's own `dev` script as a child process.
//! 3. `sidecar`       — supervises the Bun subprocess that hosts `framework-engine`.
//!
//! Nothing here owns business logic or framework knowledge. The editor SPA and the
//! sidecar still carry those. Rust is the OS-facing seam that makes both of them
//! reachable from a single `.app` window.
//!
//! Every mutation path is routed through Tauri IPC commands defined below. The
//! editor SPA calls them via `@tauri-apps/api/core`'s `invoke`, and the responses
//! come back as plain JSON-serializable payloads.

mod dev_server;
mod error;
mod files;
mod preview;
mod projects;
mod sidecar;

use std::sync::Arc;

use tauri::Manager;

use crate::error::CoreError;
use crate::preview::PreviewBoundsPayload;
use crate::projects::ProjectHandle;

/// Top-level mutable state held by the Tauri app.
pub struct AppState {
    pub projects: Arc<tokio::sync::Mutex<projects::ProjectRegistry>>,
    pub dev_server: Arc<tokio::sync::Mutex<dev_server::DevServerSupervisor>>,
    pub sidecar: Arc<tokio::sync::Mutex<sidecar::SidecarSupervisor>>,
    pub preview: Arc<tokio::sync::Mutex<preview::PreviewController>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            projects: Arc::new(tokio::sync::Mutex::new(projects::ProjectRegistry::default())),
            dev_server: Arc::new(tokio::sync::Mutex::new(dev_server::DevServerSupervisor::new())),
            sidecar: Arc::new(tokio::sync::Mutex::new(sidecar::SidecarSupervisor::new())),
            preview: Arc::new(tokio::sync::Mutex::new(preview::PreviewController::new())),
        }
    }
}

/// Entry point for both desktop and (future) mobile targets.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            // Make sure every child process this app spawns is torn down when the
            // last window closes. The supervisors all own `Child` handles directly,
            // so the `Drop` impls do the work — this closure just wires the signal.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Placeholder: reserved for future pre-flight (permissions, etc.).
                let _ = handle;
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Synchronously stop supervisors so no child process outlives the
                // window. Anything async would race the process teardown.
                let state = window.state::<AppState>();
                let dev = state.dev_server.clone();
                let side = state.sidecar.clone();
                tauri::async_runtime::block_on(async move {
                    let mut d = dev.lock().await;
                    let _ = d.stop().await;
                    let mut s = side.lock().await;
                    let _ = s.stop().await;
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            project_open_dialog,
            project_validate,
            project_close,
            project_list_files,
            project_write_file,
            dev_server_start,
            dev_server_stop,
            engine_parse_file,
            engine_emit_edit,
            preview_attach,
            preview_set_bounds,
        ])
        .run(tauri::generate_context!())
        .expect("error while running onlook desktop");
}

// ---------------------------------------------------------------------------
// IPC commands. Each one is a thin wrapper around a module function so unit
// tests can exercise the logic without a Tauri app handle.
// ---------------------------------------------------------------------------

#[tauri::command]
async fn project_open_dialog(
    app: tauri::AppHandle,
) -> Result<Option<String>, CoreError> {
    projects::open_dialog(&app).await
}

#[tauri::command]
async fn project_validate(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<ProjectHandle, CoreError> {
    let mut registry = state.projects.lock().await;
    registry.validate_and_register(&path)
}

#[tauri::command]
async fn project_close(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), CoreError> {
    // Close order matters: stop the dev server so it doesn't spew to a dead
    // preview, then tear down the preview, then stop the sidecar, then clear
    // the registry. Anything else risks a zombie or a stale preview url.
    {
        let mut dev = state.dev_server.lock().await;
        dev.stop().await?;
    }
    {
        let mut preview = state.preview.lock().await;
        preview.teardown(&app).await?;
    }
    {
        let mut sidecar = state.sidecar.lock().await;
        sidecar.stop().await?;
    }
    {
        let mut registry = state.projects.lock().await;
        registry.clear();
    }
    Ok(())
}

#[tauri::command]
async fn project_list_files(
    state: tauri::State<'_, AppState>,
) -> Result<files::ScanResult, CoreError> {
    // Snapshot the root out of the registry so the blocking walk doesn't hold
    // the mutex across an `await`. If the project is closed mid-scan the
    // worker thread will still finish and its result is simply discarded by
    // the caller.
    let root = {
        let registry = state.projects.lock().await;
        registry
            .active()
            .map(|handle| std::path::PathBuf::from(&handle.root))
            .ok_or(CoreError::NoActiveProject)?
    };

    tauri::async_runtime::spawn_blocking(move || files::scan_project(&root))
        .await
        .map_err(|e| CoreError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?
}

#[tauri::command]
async fn project_write_file(
    state: tauri::State<'_, AppState>,
    path: String,
    contents: String,
) -> Result<(), CoreError> {
    let root = {
        let registry = state.projects.lock().await;
        registry
            .active()
            .map(|handle| std::path::PathBuf::from(&handle.root))
            .ok_or(CoreError::NoActiveProject)?
    };

    tauri::async_runtime::spawn_blocking(move || {
        files::write_file(&root, std::path::Path::new(&path), &contents)
    })
    .await
    .map_err(|e| CoreError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?
}

#[tauri::command]
async fn dev_server_start(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    path: String,
) -> Result<(), CoreError> {
    // Start the project's dev script. Port detection, readiness, timeout, and
    // exit are all surfaced as IPC events from inside the supervisor.
    let mut dev = state.dev_server.lock().await;
    dev.start(app.clone(), &path).await?;

    // Kick the sidecar at the same time — framework-engine parse calls will
    // start landing as soon as the SPA has a project handle.
    let mut sidecar = state.sidecar.lock().await;
    sidecar.start(app.clone(), &path).await?;
    Ok(())
}

#[tauri::command]
async fn dev_server_stop(
    state: tauri::State<'_, AppState>,
) -> Result<(), CoreError> {
    let mut dev = state.dev_server.lock().await;
    dev.stop().await
}

#[tauri::command]
async fn engine_parse_file(
    state: tauri::State<'_, AppState>,
    path: String,
    framework: String,
) -> Result<serde_json::Value, CoreError> {
    let mut sidecar = state.sidecar.lock().await;
    sidecar.parse_file(&path, &framework).await
}

#[tauri::command]
async fn engine_emit_edit(
    state: tauri::State<'_, AppState>,
    document: serde_json::Value,
    action: serde_json::Value,
) -> Result<serde_json::Value, CoreError> {
    let mut sidecar = state.sidecar.lock().await;
    sidecar.emit_edit(document, action).await
}

#[tauri::command]
async fn preview_attach(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    url: String,
) -> Result<(), CoreError> {
    let mut preview = state.preview.lock().await;
    preview.attach(&app, &url).await
}

#[tauri::command]
async fn preview_set_bounds(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    bounds: PreviewBoundsPayload,
) -> Result<(), CoreError> {
    let mut preview = state.preview.lock().await;
    preview.set_bounds(&app, bounds).await
}
