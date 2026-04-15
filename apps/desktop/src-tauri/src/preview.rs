//! Preview window controller.
//!
//! **v1 design note.** `design.md` imagined a child webview *embedded* in the
//! main window, with an SPA-owned overlay layer aligned to its bounds. Tauri
//! 2.10's stable public surface does not expose multi-webview-per-window via
//! `WebviewWindowBuilder`, and we explicitly do not want to reach into
//! `tauri::webview` internals that move between point releases. So v1 ships
//! the preview as a **separate `WebviewWindow`** created via
//! `WebviewWindowBuilder`.
//!
//! The user ends up with two native windows side-by-side: the editor SPA and
//! the dev-server preview. The editor still draws an empty slot in its
//! preview panel (so the layout looks right in screenshots and so a future
//! embedded-webview build can drop in without SPA changes), but
//! `set_bounds` is a no-op here. Re-embedding will happen in a later change
//! (`add-embedded-preview`) that owns the Tauri API migration end-to-end.
//!
//! Everything else (probe script injection, click/hover forwarding, tear-down
//! on project close, lifecycle tied to dev-server events) matches the spec.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::CoreError;

pub const PREVIEW_LABEL: &str = "preview";
pub const EVENT_PREVIEW_ATTACHED: &str = "desktop://preview-attached";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PreviewBoundsPayload {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Tiny probe script injected into the preview webview at load time.
/// Forwards clicks, hovers, and `load` events back to the SPA via Tauri
/// events. Kept as a static string so there's no build pipeline for it.
const PROBE_SCRIPT: &str = include_str!("preview_probe.js");

pub struct PreviewController {
    /// Last bounds reported by the SPA. Currently unused (set_bounds is a
    /// no-op) but kept around for the later embedded-preview change.
    #[allow(dead_code)]
    last_bounds: Option<PreviewBoundsPayload>,
    attached: bool,
}

impl PreviewController {
    pub fn new() -> Self {
        Self {
            last_bounds: None,
            attached: false,
        }
    }

    pub async fn attach(&mut self, app: &AppHandle, url: &str) -> Result<(), CoreError> {
        let parsed = url::Url::parse(url)
            .map_err(|e| CoreError::Preview(format!("invalid preview url: {e}")))?;

        // If a previous preview window is still around (e.g. project switch),
        // tear it down before creating the new one.
        if app.get_webview_window(PREVIEW_LABEL).is_some() {
            self.teardown(app).await?;
        }

        WebviewWindowBuilder::new(
            app,
            PREVIEW_LABEL,
            WebviewUrl::External(parsed),
        )
        .title("Onlook · Preview")
        .inner_size(1200.0, 800.0)
        .initialization_script(PROBE_SCRIPT)
        .build()
        .map_err(|e| CoreError::Preview(format!("failed to create preview window: {e}")))?;

        self.attached = true;
        let _ = app.emit(EVENT_PREVIEW_ATTACHED, url.to_string());
        Ok(())
    }

    pub async fn set_bounds(
        &mut self,
        _app: &AppHandle,
        bounds: PreviewBoundsPayload,
    ) -> Result<(), CoreError> {
        // v1 stores the last reported bounds but does not apply them — the
        // preview is a free-floating window. See the module-level doc for
        // the plan to restore true overlay geometry.
        self.last_bounds = Some(bounds);
        Ok(())
    }

    pub async fn teardown(&mut self, app: &AppHandle) -> Result<(), CoreError> {
        if let Some(window) = app.get_webview_window(PREVIEW_LABEL) {
            let _ = window.close();
        }
        self.attached = false;
        self.last_bounds = None;
        Ok(())
    }
}
