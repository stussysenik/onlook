## Why

`add-desktop-shell` landed the Tauri window, the dev-server supervisor, the Bun sidecar, and the preview WebView, but the editor SPA still edits an in-memory sample string. The sidecar's `engine_parse_file` and `engine_emit_edit` commands are compiled and wired in `apps/desktop/src-tauri/src/sidecar.rs`, but zero code paths in `apps/editor/src` call them — there is no UI to pick a file, so the round-trip from disk → IR → inspector → disk is dead weight. The dev-server preview loads `~/Desktop/portfolio-forever` and reloads on HMR, but the user cannot actually change anything about that project from inside Onlook.

This change is the smallest slice that makes the desktop shell useful: a minimal file tree panel in desktop mode, plus a write-back command, so the owner can open `~/Desktop/portfolio-forever`, click `src/routes/+page.svelte`, edit a heading via the inspector, and see the preview reload with the new content on disk. That is the full loop the product needs before anything else — more file actions, a better tree, a file watcher, git awareness — has a reason to exist.

## What Changes

- Add a `project_list_files` Tauri command in `apps/desktop/src-tauri` that walks the active project root and returns a flat list of file/directory entries, with a hardcoded ignore list (`node_modules`, `.git`, `dist`, `build`, `.svelte-kit`, `.next`, `.turbo`, `.cache`, `.DS_Store`) and a 1 MB per-file size cap so the editor never loads runaway assets by mistake. Directory entries are always included; file entries are annotated with an `editable` boolean so the SPA can gate selection without having to duplicate the extension allow-list.
- Add a `project_write_file` Tauri command that takes an absolute path and a string, verifies the path is inside the active project root (rejecting traversal), and writes atomically via temp file + rename. No watcher, no transaction log — the dev server's own HMR is the feedback loop.
- Extend the `framework-engine` → sidecar contract so `parse_file` takes a framework hint and `emit_edit` already returns a `serialized` string; both are already in `packages/editor-contracts/src/sidecar.ts`, so this change is purely additive on the consumer side.
- Add a `FileTree` React panel to `apps/editor/src` that renders in desktop mode in place of the current framework-pill sample selector and shows the scanned entries as a tree, tracks a `selectedFilePath`, and exposes a framework inferred from extension (`.svelte` → `svelte`, `.jsx`/`.tsx` → `react`, others disabled).
- Route the SPA's existing `reparseSource` → `applyNodeEdit` → write loop through `adapter.parseFile(path, framework)` and a new `adapter.writeFile(path, contents)` whenever a desktop file is selected. Browser mode keeps the in-memory sample path untouched so `bun run dev:editor` still works without a Tauri runtime.
- Add a minimal "active file" indicator in the source panel header so the user always knows which file on disk the inspector is editing.
- Do **not** add a file watcher, directory rename/create/delete, file search, git status, diff view, or persistence beyond the single-file save. Those are deliberately out of scope for the first usable loop.
- Do **not** change the framework-engine API, the preview webview wiring, or the dev-server supervisor. This is a plumbing-plus-UI change, not a core engine change.

## Capabilities

### New Capabilities
- `desktop-file-tree`: Scans the active project for source files, renders a selectable file tree inside the editor SPA in desktop mode, routes file selections to the sidecar's `parse_file` command to produce an `EditorDocument`, and routes inspector-driven edits back to disk via an atomic `write_file` command so the project's dev server HMR-reloads the preview with the new content.

### Modified Capabilities
<!-- None. This change adds a new capability that composes on top of `desktop-shell`. The existing `desktop-shell` spec is unchanged; no scenarios are rewritten. The new capability references `desktop-shell` implicitly via its preconditions (project must already be loaded), but that is a dependency, not a modification. -->

## Impact

- **New files**: `apps/desktop/src-tauri/src/files.rs` (scan + write module), `apps/editor/src/FileTree.tsx` (panel component), `apps/editor/src/runtime/files.ts` (typed helpers over the new adapter calls). No new crates — the scan uses `std::fs::read_dir` recursively, no `walkdir` / `ignore` dependencies.
- **Touched code**: `apps/desktop/src-tauri/src/lib.rs` (register two new commands, thread a `files` module), `apps/editor/src/runtime/adapter.ts` (two new methods on `Adapter` — `listFiles`, `writeFile`), `apps/editor/src/App.tsx` (desktop-mode panel layout swap, new state for `selectedFilePath` / `fileEntries`, new effect that calls `adapter.listFiles` after `dev-server-ready`). Touches are additive; existing browser-mode code paths remain intact.
- **Dependencies added**: None. Rust adds zero crates; SPA adds zero npm packages.
- **Platform**: macOS first (matching `desktop-shell`). Path normalization uses `PathBuf`, so Linux should come along for free when we verify it later.
- **User-visible**: In desktop mode, the left rail becomes a file tree. Clicking a `.svelte` / `.jsx` / `.tsx` file loads it into the inspector and the dev-server preview continues to reflect whatever that file's component currently renders. Clicking a non-editable file (`.md`, `.css`, `.json`, images) does nothing — the entry is shown grayed out. Edits applied via the inspector land on disk and trigger the dev server's own HMR reload; the user sees the change in the preview webview within a second.
- **Risks**:
  - **Path escapes**: `project_write_file` must canonicalize both the project root and the target path before checking containment, otherwise a symlink inside the project could write outside it. Addressed in `design.md` by the containment check + explicit rejection of symlinks in the target path component.
  - **Large directory scans**: A project with 30k files and no blocklist match would stall the UI. Addressed by the hardcoded ignore list plus a 10k-entry cap that returns a truncation warning rather than hanging.
  - **Atomic write on APFS**: `std::fs::rename` is atomic on APFS for same-volume renames. The temp file is always written next to the target so the rename stays on-volume.
  - **Stale IR after write**: The SPA already holds the post-edit `EditorDocument` returned by `emit_edit`; the write just persists it. No re-parse is needed after a successful write.
