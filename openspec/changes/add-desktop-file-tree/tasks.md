## 1. Rust core — file scan

- [x] 1.1 Add `apps/desktop/src-tauri/src/files.rs` with a public `scan_project(root: &Path) -> Result<ScanResult, CoreError>` function that walks the root on a blocking thread via `tokio::task::spawn_blocking`, applies the hardcoded ignore list (`node_modules`, `.git`, `dist`, `build`, `.svelte-kit`, `.next`, `.turbo`, `.cache`), caps at 10,000 entries, and returns a `ScanResult { entries: Vec<FileEntry>, truncated: bool }`
- [x] 1.2 Define `FileEntry { path: String, relative: String, kind: EntryKind, size: Option<u64>, editable: bool }` with `EntryKind::{File, Dir}` serialized in lowercase, and a helper `is_editable(path: &Path) -> bool` that returns true for `.svelte`, `.jsx`, `.tsx` extensions
- [x] 1.3 Wire a new Tauri command `project_list_files` in `lib.rs` that reads the active project root from `ProjectRegistry::active()`, calls `files::scan_project`, and returns the result; on no-active-project it returns `CoreError::NoActiveProject` (new variant)
- [x] 1.4 Add `CoreError::NoActiveProject` and the three new variants `CoreError::PathEscape`, `CoreError::SymlinkAncestor`, `CoreError::PayloadTooLarge` in `error.rs`, each with a typed message the SPA can branch on
- [x] 1.5 Unit-test `scan_project` against three fixtures: a minimal valid project (one file, one dir), an ignored-dir project (ensure `node_modules` is skipped), and a cap-hit project (synthesize 10,050 files, expect 10,000 + `truncated: true`) — tests use the same `tempfile_like::TempDir` helper `projects.rs` already has
- [x] 1.6 Unit-test `is_editable` for each supported extension + three non-supported extensions (`.css`, `.json`, `.md`)

## 2. Rust core — atomic file write

- [x] 2.1 Add `files::write_file(root: &Path, target: &Path, contents: &str) -> Result<(), CoreError>` that canonicalizes `root` and `target`, asserts `target.starts_with(canonicalized_root)`, walks ancestors checking for symlinks via `std::fs::symlink_metadata`, rejects payloads > 1 MB, writes to `<target>.onlook.tmp`, and renames via `std::fs::rename`
- [x] 2.2 On rename failure, attempt `std::fs::remove_file(<target>.onlook.tmp)` before returning the error so no temp files are left behind
- [x] 2.3 Wire a Tauri command `project_write_file` in `lib.rs` that reads `ProjectRegistry::active()`, delegates to `files::write_file`, and returns `Ok(())` or `CoreError`
- [x] 2.4 Unit-test `write_file` against six cases: happy path (writes file, confirms contents on disk), path outside root (rejects with `PathEscape`), symlinked ancestor (rejects with `SymlinkAncestor`), oversized payload (rejects with `PayloadTooLarge`), rename failure with temp cleanup (simulate by making target a read-only dir), overwrite existing file (succeeds and old contents are replaced)
- [x] 2.5 Register both new commands in `tauri::generate_handler![...]` inside `lib.rs::run()`

## 3. Editor SPA — runtime adapter

- [x] 3.1 Extend the `Adapter` interface in `apps/editor/src/runtime/adapter.ts` with `listFiles(): Promise<{ entries: FileEntry[]; truncated: boolean }>` and `writeFile(path: string, contents: string): Promise<void>`
- [x] 3.2 Add the `FileEntry` type mirror in `runtime/adapter.ts` (kept local because it is adapter-shaped, not framework-engine-shaped — re-exporting from `editor-contracts` would couple the contracts package to file-system shapes unnecessarily)
- [x] 3.3 Implement `DesktopAdapter.listFiles` via `invoke<{entries, truncated}>('project_list_files')` with snake_case → camelCase mapping on the entry fields
- [x] 3.4 Implement `DesktopAdapter.writeFile` via `invoke<void>('project_write_file', { path, contents })`
- [x] 3.5 Implement `BrowserAdapter.listFiles` and `BrowserAdapter.writeFile` as throwing stubs matching the existing `notAvailable(name)` pattern
- [x] 3.6 Export a small helper `inferFrameworkFromPath(path: string): FrameworkId | null` from `runtime/adapter.ts` (returns `svelte`, `react`, or `null`) so both the tree panel and `App.tsx` share one source of truth

## 4. Editor SPA — FileTree component

- [x] 4.1 Add `apps/editor/src/FileTree.tsx` — a pure presentational component that takes `entries`, `truncated`, `selectedFilePath`, and `onSelect(path, framework)` props and renders a nested tree built from the flat entries
- [x] 4.2 The tree builder groups entries by their relative-path segments and renders directories before files at each depth; non-editable files are rendered with reduced opacity and are not interactive
- [x] 4.3 Expand all directories by default in v1 — no collapse / expand state. If a project turns out to be deep enough that this is annoying, a later change can add disclosure arrows
- [x] 4.4 Show a "scan truncated" banner above the tree when `truncated` is true, with the fixed message "File tree capped at 10,000 entries. Hidden entries are not editable from the tree." The banner reuses the existing `.warning-box` styles from `index.css` so no new CSS is introduced for it.
- [x] 4.5 Add minimal tree styles to `apps/editor/src/index.css`: `.file-tree`, `.file-tree-entry`, `.file-tree-entry-editable`, `.file-tree-entry-disabled`, `.file-tree-depth`. Use the existing color tokens. No new fonts, no icons beyond a chevron character

## 5. Editor SPA — App.tsx integration

- [x] 5.1 Add new state in `App.tsx`: `fileEntries`, `fileTreeTruncated`, `selectedFilePath`. Wire them from `useState` hooks next to the existing desktop-mode state
- [x] 5.2 Add a `useEffect` that fires when `desktopDevUrl` transitions from null → non-null and calls `adapter.listFiles()` exactly once per project, populating `fileEntries` and `fileTreeTruncated`. On error, surface the message via `setSyncStatus` and leave entries empty
- [x] 5.3 Add `handleSelectFile(path: string, framework: FrameworkId)` that calls `adapter.parseFile(path, framework)`, then updates `document`, `source`, `selectedNodeId`, `framework`, and `selectedFilePath` in a single `startTransition`
- [x] 5.4 Replace the framework-pill section in the top bar when in desktop mode with the project name only (matching `add-desktop-shell`'s existing treatment) — no new UI here, just confirm the pills stay hidden
- [x] 5.5 Replace the left rail's first panel in desktop mode with a mounted `<FileTree />`. Browser mode still shows the existing Source panel. The left rail layout swap is a single ternary around the source panel JSX
- [x] 5.6 Update the Source panel header in desktop mode: when `selectedFilePath` is set, show the relative path as a `<code>` element next to the title; when unset, show `Untitled`. Switch the textarea to `readOnly` in desktop mode so edits must go through the inspector
- [x] 5.7 Update `applyNodeEdit`, `insertChildNode`, `removeSelectedNode`, `moveSelectedNode` — after each `updateDocument`, if desktop mode + `selectedFilePath` is set, call `adapter.writeFile(selectedFilePath, nextDocument.source)`. Catch errors and surface them via `setSyncStatus` without reverting the document
- [x] 5.8 Add a `handleDesktopCloseProject` cleanup: clear `fileEntries`, `fileTreeTruncated`, and `selectedFilePath` alongside the existing cleanup

## 6. Wiring verification (Rust + SPA)

- [x] 6.1 `cd apps/desktop/src-tauri && cargo check` — compiles clean
- [x] 6.2 `cd apps/desktop/src-tauri && cargo test` — all existing tests still pass + the new `files::tests` module passes (expect `3 projects + 4 dev_server + 6 files = 13+` passing tests)
- [x] 6.3 `bun --filter '*' typecheck` — 3/3 packages clean (especially watch for FileEntry / inferFrameworkFromPath drift)
- [x] 6.4 `bun --filter '*' test` — existing tests still pass (no new JS tests for v1; the Rust side carries the weight because the SPA code is mostly wiring)
- [x] 6.5 Manual walkthrough plan written as a `## Verification walkthrough` section in `PROGRESS.md`, ready for the same interactive session that will close out `add-desktop-shell` §9.2–9.6

## 7. Documentation

- [x] 7.1 Append a "File tree" section to `README.md`'s Desktop dev block — one paragraph on what to click and what to expect
- [x] 7.2 Append a `## 2026-04-15 — add-desktop-file-tree` entry to `PROGRESS.md` with the same structure the `add-desktop-shell` entry uses: What landed / What is verified / Open questions / Next slice
- [x] 7.3 Append a v1 note to `ROADMAP.md` reflecting that the loop-closing slice is now in progress (not a new section, just a dated bullet under v1)

## 8. OpenSpec hygiene

- [x] 8.1 Run `openspec validate add-desktop-file-tree --strict --no-interactive` — expected to pass
- [x] 8.2 `openspec show add-desktop-file-tree --json --deltas-only` — confirm the `desktop-file-tree` capability appears with the expected requirement count
- [x] 8.3 After apply, run the full green suite (`openspec validate`, `bun --filter '*' typecheck`, `bun --filter '*' test`, `cargo check`, `cargo test`) and verify every command is green before marking tasks complete in this file
