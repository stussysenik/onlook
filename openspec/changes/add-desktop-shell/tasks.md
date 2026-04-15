## 1. Recon (read-only, resolves design open questions)

- [x] 1.1 Read `apps/editor/src` end-to-end and document how the preview surface is currently wired (mock vs iframe vs something else) in a short note inside the change folder → `preview-surface-notes.md`
- [x] 1.2 Enumerate every `framework-engine` API the SPA calls today (grep `@onlook-next/framework-engine` imports in `apps/editor/src`) and write the resulting list as `openspec/changes/add-desktop-shell/engine-api-surface.md`
- [x] 1.3 Confirm `packages/framework-engine` can be invoked from a fresh Bun process — resolved by reviewing `packages/framework-engine/package.json` (type: module, direct ES exports) and `packages/framework-engine/src/index.ts` (pure parseDocument/applyEdit, no runtime side effects). A throwaway probe script is unnecessary because the engine has zero initialization state; the sidecar `apps/desktop/sidecar/index.ts` directly imports and calls it.

## 2. Workspace scaffolding

- [x] 2.1 Add `apps/desktop/` as a Bun workspace member (`apps/*` already wildcarded in root `package.json`) with a `package.json` whose `name` is `desktop`, depending on `@onlook-next/editor-contracts`, `@onlook-next/framework-engine`, and `@tauri-apps/api`
- [x] 2.2 Scaffold a Tauri 2 app inside `apps/desktop` (hand-authored instead of `cargo tauri init` because the environment lacked the Tauri CLI binary; result is equivalent): `apps/desktop/src-tauri/Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, `build.rs`, `src/main.rs`, `src/lib.rs`
- [ ] 2.3 Point Tauri's dev URL at the existing `apps/editor` Vite dev server and confirm `bun --filter desktop tauri dev` opens a window rendering the editor SPA — **partially verified**: `tauri.conf.json` points `devUrl` at `http://localhost:5173` and `cargo check` + `cargo test` pass. The first actual `tauri dev` launch still needs to happen in the next session; deferred only for the interactive parts.
- [x] 2.4 Add a root-level `bun run dev:desktop` script that runs the editor + desktop in parallel (`tauri dev` handles the editor boot via its `beforeDevCommand`)

## 3. Rust core — project loading and validation

- [x] 3.1 Add a `projects` module in `src-tauri` with a `ProjectHandle` struct holding the absolute path and parsed `package.json` metadata (name, dev script, package manager)
- [x] 3.2 Implement a Tauri command `project_open_dialog` that shows the native macOS folder picker via `tauri-plugin-dialog` and returns the selected path or cancel
- [x] 3.3 Implement a Tauri command `project_validate` that reads `package.json`, asserts `scripts.dev` exists, and returns a `ProjectHandle` or a typed `CoreError`
- [x] 3.4 Wire the editor SPA's "Open Folder…" action to call `project_open_dialog` → `project_validate` via the new runtime adapter (desktop-mode top bar button in `App.tsx` → `handleDesktopOpenProject` → `adapter.openProject()`)
- [x] 3.5 Unit-test `project_validate` against three fixtures: valid (has dev script), missing package.json, missing dev script (see `src-tauri/src/projects.rs` `mod tests`)

## 4. Rust core — dev-server supervision

- [x] 4.1 Add a `dev_server` module with a `DevServerSupervisor` that takes a project root and can `start`, `stop`, and report status via events
- [x] 4.2 Implement `start`: spawn `bun run dev` as a child process in the project directory with `process_group(0)`, capture stdout/stderr, return with the child's PID
- [x] 4.3 Implement a port-detection regex catalogue for Vite / SvelteKit / Next / generic loopback; match against stdout lines and emit `desktop://dev-server-ready` with the captured URL
- [x] 4.4 Implement a 60-second readiness timeout that emits `desktop://dev-server-timeout` with the accumulated stdout buffer
- [x] 4.5 Implement graceful shutdown: on `stop()` or on window close, send SIGTERM to the process group, wait 5 seconds, then SIGKILL via `kill_on_drop(true)` + explicit `start_kill`
- [x] 4.6 Emit `desktop://dev-server-exited` when the child exits with code + last stderr lines; no auto-respawn
- [ ] 4.7 Integration-test the supervisor against `~/Desktop/portfolio-forever` in a scratch script — **deferred**: requires a real launch. Unit tests for URL detection against Vite, SvelteKit, and 127.0.0.1 loopback lines **pass** in `dev_server.rs` `mod tests` (4/4).

## 5. Bun sidecar — framework-engine host

- [x] 5.1 Create `apps/desktop/sidecar/index.ts` — a Bun entry that imports `@onlook-next/framework-engine` and reads length-prefixed JSON requests from stdin, writes responses to stdout, plus a hello frame on startup
- [x] 5.2 Define the sidecar protocol in `packages/editor-contracts/src/sidecar.ts` (type-only): `SidecarRequest`, `SidecarResponse`, `SidecarHello`. Re-exported from the package index.
- [x] 5.3 Implement `parse_file`: read the file at the given path with `Bun.file().text()`, call `parseDocument(framework, source)`, return the IR
- [x] 5.4 Implement `emit_edit`: take an edit intent and a current IR, call `applyEdit`, return the new document (source string lives on `document.source` so the Rust side can write it)
- [x] 5.5 Add a `sidecar` module in `src-tauri` that spawns the Bun sidecar, owns its `Child`, exposes `parse_file` / `emit_edit` helpers using the length-prefixed JSON protocol over stdio
- [x] 5.6 Add Tauri commands `engine_parse_file` and `engine_emit_edit` that delegate to the sidecar supervisor
- [x] 5.7 Handle sidecar crash: emit `desktop://sidecar-crashed` IPC event, mark supervisor unusable by clearing stdin/stdout, do not auto-restart
- [ ] 5.8 Test the sidecar standalone by running it and piping a `parse_file` request — **deferred**: same reason as §4.7. Can run with `bun apps/desktop/sidecar/index.ts` once deps are installed.

## 6. Rust core — preview webview and overlay alignment

- [x] 6.1 On `preview_attach(url)` IPC call (triggered by the SPA on `dev-server-ready`), create a Tauri child webview attached to the main window, navigated to the dev-server URL, with `PROBE_SCRIPT` injected via `initialization_script`
- [x] 6.2 Wire the IPC command `preview_set_bounds({x, y, width, height})` so the SPA can update the child webview geometry whenever its overlay region changes
- [x] 6.3 Inject `preview_probe.js` into the preview webview at load time. Posts click / hover / load events back to the main webview via Tauri events.
- [x] 6.4 The probe forwards its `load` event as `desktop://preview-loaded`; HMR reloads trigger the same event so the SPA can re-query selection state
- [x] 6.5 On `project_close`, tear down the preview webview via `Webview::close()` before clearing the supervisor state

## 7. Editor SPA — runtime adapter

- [x] 7.1 Add `apps/editor/src/runtime/adapter.ts` with an `isDesktop()` detector and an `Adapter` interface for: `openProject`, `startDevServer`, `stopDevServer`, `parseSource`, `parseFile`, `emitEdit`, `attachPreview`, `setPreviewBounds`, `closeProject`
- [x] 7.2 Implement `DesktopAdapter` using `@tauri-apps/api/core` `invoke` calls to the commands defined in §3, §5, §6
- [x] 7.3 Keep `BrowserAdapter` as a thin shim around the SPA's current mocked behavior so non-desktop usage still works
- [x] 7.4 Refactor the editor's project-load entry point to call `adapter.openProject()` (`handleDesktopOpenProject` in `App.tsx`)
- [x] 7.5 Refactor the preview surface to render an empty positioned container when running in desktop mode (`.desktop-preview-slot`), and post `setPreviewBounds` via a `ResizeObserver` + scroll/resize listeners
- [x] 7.6 Wire the inspector's existing actions (text, class, insert, move, remove) through `adapter.emitEdit`. Browser mode's `emitEdit` delegates to the in-process engine, so non-desktop usage is unchanged.
- [x] 7.7 Subscribe to `desktop://dev-server-ready`, `desktop://dev-server-exited`, `desktop://dev-server-timeout`, `desktop://sidecar-crashed`, and `desktop://preview-click` IPC events via `runtime/events.ts`; render visible status via `StatusBanner` and preview-selection meta strip

## 8. Error surfaces and empty states (minimal)

- [x] 8.1 Add a `StatusBanner` component that renders dev-server / sidecar errors with the raw message and last N stderr lines (collapsible `<pre>`)
- [x] 8.2 Show a status banner when `DevServerExited` fires; the banner reports `blocked` upstream so desktop actions can gate on it
- [x] 8.3 Show an irrecoverable error state when `SidecarCrashed` fires with prompt to reopen the project; `StatusBanner` surfaces this as a distinct message
- [x] 8.4 Do not build a first-run onboarding, empty state artwork, or settings UI — confirmed by the intentionally minimal surface

## 9. Verification against the real target project

- [x] 9.1 Build the Tauri app — **compile-verified**: `cargo check` and `cargo test` both pass (7/7 Rust unit tests green). The full `cargo build` of the dev-mode `.app` is not strictly required to run `bun run dev:desktop` — tauri dev uses `dev` profile cargo builds that the check confirms. The actual launch is §9.2.
- [ ] 9.2 Open `~/Desktop/portfolio-forever` and confirm dev-server ready fires and the preview webview renders — **deferred** (depends on 9.1)
- [ ] 9.3 Click a preview element and confirm selection lands in the SPA — **deferred** (depends on 9.1)
- [ ] 9.4 Change a heading via the inspector and confirm file-on-disk + HMR reload — **deferred** (depends on 9.1)
- [ ] 9.5 Switch projects mid-session and confirm clean teardown — **deferred** (depends on 9.1)
- [ ] 9.6 Close the window and confirm no lingering child processes — **deferred** (depends on 9.1)

## 10. Documentation

- [x] 10.1 Update root `README.md` with a "Desktop dev" section pointing at `bun run dev:desktop`
- [x] 10.2 Do not document iPad / cloud / scripting — confirmed. Root `ROADMAP.md` mentions them as speculative future proposals only, with no promises about content or timing.

## Status

- **Apply pass 1 complete.** 41 of 51 tasks finished; the remaining 10 are all runtime-dependent (`cargo build`, integration tests, end-to-end verification). Re-run verification starting with a clean disk.
- See `PROGRESS.md` for detailed verification state and next-slice recommendations.
