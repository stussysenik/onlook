use serde::{Serialize, Serializer};
use thiserror::Error;

/// Typed errors surfaced to the SPA. The `Serialize` impl produces a JSON
/// object with `kind` and `message`, which the SPA can branch on directly.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid project path: {0}")]
    InvalidProjectPath(String),

    #[error("missing package.json at {0}")]
    MissingPackageJson(String),

    #[error("package.json has no scripts.dev entry")]
    MissingDevScript,

    #[error("dev server failed to start: {0}")]
    DevServerStart(String),

    #[error("dev server is not running")]
    DevServerNotRunning,

    #[error("sidecar failed to start: {0}")]
    SidecarStart(String),

    #[error("sidecar call failed: {0}")]
    SidecarCall(String),

    #[error("preview webview unavailable: {0}")]
    Preview(String),

    #[error("no active project")]
    NoActiveProject,

    #[error("path escapes project root: {0}")]
    PathEscape(String),

    #[error("ancestor directory is a symlink: {0}")]
    SymlinkAncestor(String),

    #[error("payload too large: {0} bytes (max 1048576)")]
    PayloadTooLarge(usize),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),
}

impl Serialize for CoreError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("kind", self.kind_tag())?;
        map.serialize_entry("message", &self.to_string())?;
        map.end()
    }
}

impl CoreError {
    fn kind_tag(&self) -> &'static str {
        match self {
            Self::InvalidProjectPath(_) => "invalid_project_path",
            Self::MissingPackageJson(_) => "missing_package_json",
            Self::MissingDevScript => "missing_dev_script",
            Self::DevServerStart(_) => "dev_server_start",
            Self::DevServerNotRunning => "dev_server_not_running",
            Self::SidecarStart(_) => "sidecar_start",
            Self::SidecarCall(_) => "sidecar_call",
            Self::Preview(_) => "preview",
            Self::NoActiveProject => "no_active_project",
            Self::PathEscape(_) => "path_escape",
            Self::SymlinkAncestor(_) => "symlink_ancestor",
            Self::PayloadTooLarge(_) => "payload_too_large",
            Self::Io(_) => "io",
            Self::Serde(_) => "serde",
            Self::Tauri(_) => "tauri",
        }
    }
}
