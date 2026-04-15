//! Local project loader and validator.
//!
//! Responsibilities:
//! - Open a native macOS folder picker via `tauri-plugin-dialog`.
//! - Validate that the selected folder contains a `package.json` with a
//!   `scripts.dev` entry.
//! - Return a [`ProjectHandle`] to the SPA (absolute path + parsed metadata).
//!
//! What this module does *not* do: scaffold new projects, edit files, watch
//! the filesystem. All of that happens elsewhere.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::error::CoreError;

/// Metadata about an opened project, sent across the IPC boundary.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectHandle {
    pub id: String,
    pub root: String,
    pub name: String,
    pub dev_script: String,
    pub package_manager: PackageManager,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Bun,
    Pnpm,
    Npm,
    Yarn,
}

impl PackageManager {
    pub fn binary(&self) -> &'static str {
        match self {
            Self::Bun => "bun",
            Self::Pnpm => "pnpm",
            Self::Npm => "npm",
            Self::Yarn => "yarn",
        }
    }

    /// v1 only supports Bun-launched dev servers. The target project
    /// (`~/Desktop/portfolio-forever`) runs on Bun. When a later proposal
    /// needs pnpm/npm/yarn, the detector in `detect_package_manager` already
    /// returns them — we just need to relax this check.
    pub fn is_supported_v1(&self) -> bool {
        matches!(self, Self::Bun)
    }
}

/// Minimal parse of `package.json`. We only need `name`, `scripts.dev`, and
/// a hint at the package manager. Keeping the types narrow means we don't
/// have to keep up with every optional field upstream packages invent.
#[derive(Debug, Deserialize)]
struct PackageJson {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    scripts: HashMap<String, String>,
    #[serde(rename = "packageManager", default)]
    package_manager: Option<String>,
}

/// In-memory registry of opened projects. v1 only allows one project at a
/// time, but the registry is a map so future LAN-attach workflows can host
/// multiple without a schema migration.
#[derive(Default)]
pub struct ProjectRegistry {
    active: Option<ProjectHandle>,
}

impl ProjectRegistry {
    pub fn validate_and_register(&mut self, path: &str) -> Result<ProjectHandle, CoreError> {
        let handle = validate(path)?;
        self.active = Some(handle.clone());
        Ok(handle)
    }

    pub fn clear(&mut self) {
        self.active = None;
    }

    #[allow(dead_code)] // Reserved for §6 preview wiring.
    pub fn active(&self) -> Option<&ProjectHandle> {
        self.active.as_ref()
    }
}

/// Show the native macOS folder picker. Returns `Ok(None)` when the user
/// cancels; we specifically do not treat cancellation as an error so the SPA
/// can just render its idle state instead of a toast.
pub async fn open_dialog(app: &AppHandle) -> Result<Option<String>, CoreError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Open project folder")
        .pick_folder(move |path| {
            let result = path.map(|p| p.to_string());
            let _ = tx.send(result);
        });

    rx.await
        .map_err(|e| CoreError::InvalidProjectPath(e.to_string()))
}

/// Public so the unit tests in this file can call it without a Tauri app.
pub fn validate(path: &str) -> Result<ProjectHandle, CoreError> {
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return Err(CoreError::InvalidProjectPath(path.to_string()));
    }

    let pkg_path = root.join("package.json");
    if !pkg_path.is_file() {
        return Err(CoreError::MissingPackageJson(
            pkg_path.display().to_string(),
        ));
    }

    let raw = std::fs::read_to_string(&pkg_path)?;
    let pkg: PackageJson = serde_json::from_str(&raw)?;

    let dev_script = pkg
        .scripts
        .get("dev")
        .ok_or(CoreError::MissingDevScript)?
        .clone();

    let name = pkg
        .name
        .unwrap_or_else(|| root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());

    let package_manager = detect_package_manager(&root, pkg.package_manager.as_deref());

    Ok(ProjectHandle {
        id: stable_id_for_path(&root),
        root: root.to_string_lossy().into_owned(),
        name,
        dev_script,
        package_manager,
    })
}

fn detect_package_manager(root: &Path, declared: Option<&str>) -> PackageManager {
    if let Some(spec) = declared {
        if spec.starts_with("bun@") { return PackageManager::Bun; }
        if spec.starts_with("pnpm@") { return PackageManager::Pnpm; }
        if spec.starts_with("yarn@") { return PackageManager::Yarn; }
        if spec.starts_with("npm@") { return PackageManager::Npm; }
    }
    if root.join("bun.lock").is_file() || root.join("bun.lockb").is_file() {
        return PackageManager::Bun;
    }
    if root.join("pnpm-lock.yaml").is_file() { return PackageManager::Pnpm; }
    if root.join("yarn.lock").is_file() { return PackageManager::Yarn; }
    PackageManager::Npm
}

fn stable_id_for_path(root: &Path) -> String {
    // Deterministic per-path identifier so the SPA can remember project state
    // across reopens without persisting it. No need for a UUID — the absolute
    // path is already unique on the local machine.
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    root.to_string_lossy().hash(&mut hasher);
    format!("proj_{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile_like::TempDir;

    mod tempfile_like {
        //! Tiny scoped directory helper so tests don't need an external crate.
        use std::path::PathBuf;

        pub struct TempDir {
            path: PathBuf,
        }

        impl TempDir {
            pub fn new(label: &str) -> Self {
                let base = std::env::temp_dir().join(format!(
                    "onlook-desktop-test-{}-{}",
                    label,
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                ));
                std::fs::create_dir_all(&base).unwrap();
                Self { path: base }
            }

            pub fn path(&self) -> &std::path::Path {
                &self.path
            }
        }

        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.path);
            }
        }
    }

    #[test]
    fn validates_bun_project_with_dev_script() {
        let dir = TempDir::new("valid");
        fs::write(
            dir.path().join("package.json"),
            r#"{
  "name": "portfolio-forever",
  "packageManager": "bun@1.1.32",
  "scripts": { "dev": "portless portfolio vite dev" }
}"#,
        )
        .unwrap();
        fs::write(dir.path().join("bun.lock"), "").unwrap();

        let handle = validate(&dir.path().to_string_lossy()).unwrap();
        assert_eq!(handle.name, "portfolio-forever");
        assert_eq!(handle.dev_script, "portless portfolio vite dev");
        assert_eq!(handle.package_manager, PackageManager::Bun);
    }

    #[test]
    fn rejects_missing_package_json() {
        let dir = TempDir::new("no-pkg");
        let err = validate(&dir.path().to_string_lossy()).unwrap_err();
        assert!(matches!(err, CoreError::MissingPackageJson(_)));
    }

    #[test]
    fn rejects_missing_dev_script() {
        let dir = TempDir::new("no-dev");
        fs::write(
            dir.path().join("package.json"),
            r#"{ "name": "no-dev", "scripts": { "build": "vite build" } }"#,
        )
        .unwrap();
        let err = validate(&dir.path().to_string_lossy()).unwrap_err();
        assert!(matches!(err, CoreError::MissingDevScript));
    }
}
