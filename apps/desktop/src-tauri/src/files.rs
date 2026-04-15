//! Project file scan + atomic write.
//!
//! Two responsibilities:
//!
//! 1. `scan_project` — one-shot blocking walk of the project root, returning a
//!    flat sorted list of entries annotated with editability. Hardcoded ignore
//!    list (no `.gitignore` parsing in v1), capped at 10,000 entries to keep
//!    pathological projects from stalling the UI.
//! 2. `write_file` — atomic temp+rename write to an absolute path, with
//!    canonicalization containment + symlink-ancestor rejection so the command
//!    cannot be used to escape the project root.
//!
//! No file watching, no incremental updates, no tree structure on the wire.
//! The SPA builds the tree from the flat list on its side.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::CoreError;

const SCAN_ENTRY_CAP: usize = 10_000;
const MAX_FILE_BYTES: usize = 1024 * 1024;
const TEMP_SUFFIX: &str = ".onlook.tmp";
const IGNORED_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".svelte-kit",
    ".next",
    ".turbo",
    ".cache",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub path: String,
    pub relative: String,
    pub kind: EntryKind,
    pub size: Option<u64>,
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanResult {
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
}

/// Walk `root` recursively on the current thread and return a sorted, capped
/// list of entries. Designed to be called from inside `spawn_blocking`.
pub fn scan_project(root: &Path) -> Result<ScanResult, CoreError> {
    if !root.is_dir() {
        return Err(CoreError::InvalidProjectPath(
            root.display().to_string(),
        ));
    }

    let mut entries: Vec<FileEntry> = Vec::new();
    let mut truncated = false;
    // Depth-first walk. We push directories onto a stack so the order is
    // deterministic; each directory's own children are sorted before the walk
    // descends so sibling order is stable regardless of OS readdir order.
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if entries.len() >= SCAN_ENTRY_CAP {
            truncated = true;
            break;
        }

        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            // Unreadable directory (permission denied, etc.) — skip silently,
            // the tree is best-effort. A future proposal can surface per-dir
            // errors as inline warnings.
            Err(_) => continue,
        };

        let mut children: Vec<(PathBuf, std::fs::Metadata)> = Vec::new();
        for entry in read.flatten() {
            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if IGNORED_DIR_NAMES.contains(&name) {
                        continue;
                    }
                }
            }
            children.push((path, metadata));
        }
        children.sort_by(sort_children);

        // Push subdirectories onto the stack in reverse so the next pop yields
        // them in forward order. Files are flushed to `entries` immediately so
        // they appear in the same depth-first order the user sees in the UI.
        let mut subdirs_to_push: Vec<PathBuf> = Vec::new();
        for (path, metadata) in children {
            if entries.len() >= SCAN_ENTRY_CAP {
                truncated = true;
                break;
            }
            let relative = match path.strip_prefix(root) {
                Ok(r) => r.to_string_lossy().into_owned(),
                Err(_) => continue,
            };
            let kind = if metadata.is_dir() {
                EntryKind::Dir
            } else if metadata.is_file() {
                EntryKind::File
            } else {
                // Symlinks and other odd kinds are ignored in v1 — we want
                // predictable behavior, not to chase a symlink loop.
                continue;
            };
            let size = if matches!(kind, EntryKind::File) {
                Some(metadata.len())
            } else {
                None
            };
            let editable = matches!(kind, EntryKind::File)
                && is_editable(&path)
                && metadata.len() as usize <= MAX_FILE_BYTES;
            entries.push(FileEntry {
                path: path.to_string_lossy().into_owned(),
                relative,
                kind,
                size,
                editable,
            });
            if matches!(kind, EntryKind::Dir) {
                subdirs_to_push.push(path);
            }
        }

        for subdir in subdirs_to_push.into_iter().rev() {
            stack.push(subdir);
        }
    }

    Ok(ScanResult { entries, truncated })
}

/// Deterministic child sort: directories before files, then alphabetic by file
/// name. Using `file_name` instead of the full path keeps the comparison stable
/// regardless of how deep the walk currently is.
fn sort_children(a: &(PathBuf, std::fs::Metadata), b: &(PathBuf, std::fs::Metadata)) -> std::cmp::Ordering {
    let a_is_dir = a.1.is_dir();
    let b_is_dir = b.1.is_dir();
    match (a_is_dir, b_is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => {
            let a_name = a.0.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let b_name = b.0.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            a_name.cmp(&b_name)
        }
    }
}

/// Files with these extensions can be parsed by the current framework-engine.
/// Everything else is shown in the tree but not selectable for editing.
pub fn is_editable(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    matches!(ext, "svelte" | "jsx" | "tsx")
}

/// Atomic write of a single file inside the project root. Temp file is written
/// next to the target so the rename stays on the same filesystem, which is the
/// only way `rename` is guaranteed atomic on APFS / ext4.
pub fn write_file(root: &Path, target: &Path, contents: &str) -> Result<(), CoreError> {
    if contents.len() > MAX_FILE_BYTES {
        return Err(CoreError::PayloadTooLarge(contents.len()));
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|e| CoreError::InvalidProjectPath(format!("{}: {e}", root.display())))?;

    // We cannot canonicalize the target if it doesn't exist yet, but in v1 we
    // only write files that already exist (the tree scan discovers them
    // first). So canonicalization is safe and gives us a normalized path for
    // the containment check.
    let canonical_target = target
        .canonicalize()
        .map_err(|e| CoreError::InvalidProjectPath(format!("{}: {e}", target.display())))?;

    if !canonical_target.starts_with(&canonical_root) {
        return Err(CoreError::PathEscape(format!(
            "{} is outside {}",
            canonical_target.display(),
            canonical_root.display()
        )));
    }

    // Reject symlinked ancestors. Canonicalize above already resolves the
    // target itself, but an ancestor symlink could still cross volumes. We
    // walk the path's components and stat each prefix with `symlink_metadata`
    // so we see the symlink *before* it's followed.
    let mut cursor = PathBuf::new();
    for component in canonical_target.parent().unwrap_or(Path::new("")).components() {
        cursor.push(component);
        if cursor.as_os_str().is_empty() {
            continue;
        }
        if let Ok(meta) = std::fs::symlink_metadata(&cursor) {
            if meta.file_type().is_symlink() {
                return Err(CoreError::SymlinkAncestor(cursor.display().to_string()));
            }
        }
    }

    // Temp file sits alongside the target so rename is on the same volume.
    let mut temp_path = canonical_target.clone().into_os_string();
    temp_path.push(TEMP_SUFFIX);
    let temp_path = PathBuf::from(temp_path);

    std::fs::write(&temp_path, contents)?;
    if let Err(rename_err) = std::fs::rename(&temp_path, &canonical_target) {
        // Best-effort cleanup so repeated failures don't leave a trail of
        // `.onlook.tmp` siblings behind.
        let _ = std::fs::remove_file(&temp_path);
        return Err(CoreError::Io(rename_err));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // Same throwaway TempDir helper projects.rs uses. Kept inline so files.rs
    // doesn't pull a dev-dep just to get a scratch directory.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "onlook-files-test-{}-{}",
                label,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&base).unwrap();
            Self { path: base }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn is_editable_accepts_supported_extensions() {
        assert!(is_editable(Path::new("foo.svelte")));
        assert!(is_editable(Path::new("src/Hero.jsx")));
        assert!(is_editable(Path::new("src/Hero.tsx")));
    }

    #[test]
    fn is_editable_rejects_unsupported_extensions() {
        assert!(!is_editable(Path::new("styles.css")));
        assert!(!is_editable(Path::new("package.json")));
        assert!(!is_editable(Path::new("README.md")));
        assert!(!is_editable(Path::new("no_extension_file")));
    }

    #[test]
    fn scan_returns_files_and_directories_sorted() {
        let dir = TempDir::new("scan-basic");
        let root = dir.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/Hero.svelte"), "<h1>x</h1>").unwrap();
        fs::write(root.join("package.json"), "{}").unwrap();

        let result = scan_project(root).unwrap();
        assert!(!result.truncated);

        // Walk emits all siblings at each directory, then descends DFS into
        // the first subdirectory. For a two-entry root with one subdirectory,
        // that gives [src, package.json, src/Hero.svelte].
        let relatives: Vec<_> = result.entries.iter().map(|e| e.relative.clone()).collect();
        assert_eq!(
            relatives,
            vec![
                "src".to_string(),
                "package.json".to_string(),
                "src/Hero.svelte".to_string(),
            ]
        );

        let hero = result
            .entries
            .iter()
            .find(|e| e.relative == "src/Hero.svelte")
            .unwrap();
        assert!(hero.editable);
        assert_eq!(hero.kind, EntryKind::File);
        assert!(hero.size.is_some());

        let pkg = result
            .entries
            .iter()
            .find(|e| e.relative == "package.json")
            .unwrap();
        assert!(!pkg.editable);
    }

    #[test]
    fn scan_skips_ignored_directories() {
        let dir = TempDir::new("scan-ignore");
        let root = dir.path();
        fs::create_dir_all(root.join("node_modules/react")).unwrap();
        fs::write(root.join("node_modules/react/index.js"), "// big").unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/HEAD"), "ref: refs/heads/main").unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/Hero.svelte"), "<h1>x</h1>").unwrap();

        let result = scan_project(root).unwrap();
        for entry in &result.entries {
            assert!(!entry.relative.starts_with("node_modules"));
            assert!(!entry.relative.starts_with(".git"));
        }
        assert!(result.entries.iter().any(|e| e.relative == "src/Hero.svelte"));
    }

    #[test]
    fn scan_caps_entries_at_10k() {
        let dir = TempDir::new("scan-cap");
        let root = dir.path();
        // 10,050 files is enough to exceed the 10,000 cap deterministically
        // without blowing the test runtime (< 1s on tmpfs / APFS).
        for i in 0..10_050 {
            fs::write(root.join(format!("f{i}.txt")), "x").unwrap();
        }

        let result = scan_project(root).unwrap();
        assert_eq!(result.entries.len(), SCAN_ENTRY_CAP);
        assert!(result.truncated);
    }

    #[test]
    fn write_file_happy_path() {
        let dir = TempDir::new("write-happy");
        let root = dir.path();
        let target = root.join("greeting.svelte");
        fs::write(&target, "old").unwrap();

        write_file(root, &target, "new contents").unwrap();

        let on_disk = fs::read_to_string(&target).unwrap();
        assert_eq!(on_disk, "new contents");
        assert!(!root.join("greeting.svelte.onlook.tmp").exists());
    }

    #[test]
    fn write_file_rejects_path_outside_root() {
        let dir = TempDir::new("write-escape");
        let root = dir.path();
        let outside_dir = TempDir::new("write-escape-outside");
        let outside_target = outside_dir.path().join("outside.svelte");
        fs::write(&outside_target, "old").unwrap();

        let err = write_file(root, &outside_target, "nope").unwrap_err();
        assert!(matches!(err, CoreError::PathEscape(_)));
    }

    #[test]
    fn write_file_rejects_oversized_payload() {
        let dir = TempDir::new("write-big");
        let root = dir.path();
        let target = root.join("big.svelte");
        fs::write(&target, "old").unwrap();

        let huge = "x".repeat(MAX_FILE_BYTES + 1);
        let err = write_file(root, &target, &huge).unwrap_err();
        assert!(matches!(err, CoreError::PayloadTooLarge(n) if n == MAX_FILE_BYTES + 1));
    }

    #[test]
    fn write_file_overwrites_existing_file() {
        let dir = TempDir::new("write-overwrite");
        let root = dir.path();
        let target = root.join("hero.svelte");
        fs::write(&target, "version 1").unwrap();

        write_file(root, &target, "version 2").unwrap();
        write_file(root, &target, "version 3").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "version 3");
    }
}
