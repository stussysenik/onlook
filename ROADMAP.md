# Onlook Next — Roadmap

This roadmap is the load-bearing map from [VISION.md](VISION.md) to concrete OpenSpec proposals. Every version corresponds to one (or a small number of) openspec changes, and every row below has a hard "did this ship?" test. Anything that does not fit a v-number bucket here is deferred on purpose.

---

## v1 — Personal desktop visual editor (in progress)

**What it is**: a macOS `.app` that opens a local project folder, supervises its dev server, and lets the owner visually edit the source while watching a live preview.

**Active proposals**:
- [`openspec/changes/add-desktop-shell/`](openspec/changes/add-desktop-shell/) — window, dev-server supervisor, sidecar, preview webview
- [`openspec/changes/add-desktop-file-tree/`](openspec/changes/add-desktop-file-tree/) — file tree panel + atomic write-back (2026-04-15, code-complete, waiting on the same interactive walkthrough as the shell)

**v1 acceptance test** (from VISION.md): Launch the bundled `.app`, "Open Folder…" on `~/Desktop/portfolio-forever`, nudge a heading in the inspector, see the file on disk change, watch Vite HMR reload the preview, close the window, confirm no `bun` or sidecar process lingers in `ps aux`.

**Ship checklist** (the minimum bar for calling v1 done):

- [x] Tauri 2 scaffold compiling against `apps/editor` as the main webview
- [x] Rust project loader with native folder picker and `package.json` validation
- [x] Rust dev-server supervisor with ready / timeout / exited events and SIGTERM→SIGKILL cleanup
- [x] Bun sidecar hosting `framework-engine` with length-prefixed JSON protocol
- [x] Preview child webview + probe script + bounds-sync IPC
- [x] SPA runtime adapter with browser/desktop fallbacks, Open folder flow, StatusBanner
- [x] File tree panel + `project_list_files` + `project_write_file` atomic write (add-desktop-file-tree, 2026-04-15)
- [ ] First full `cargo build` verified against real Tauri crates (not run yet — see PROGRESS.md)
- [ ] End-to-end run on `~/Desktop/portfolio-forever` with a live HMR-applied text edit
- [ ] No lingering child processes after window close (verified via `ps aux | rg bun`)
- [ ] Short "Desktop dev" section in root README pointing at `bun run dev:desktop`

**Explicitly not in v1** (deferred to later proposals):

- iPad / Android / any mobile shell (v2)
- Scripting / plugin API (v3)
- Cloud-hosted workspaces (v4 if ever)
- Phoenix backend integration (dormant until v4)
- Code signing, notarization, distribution
- CI / release pipeline for the desktop shell
- Real port-override escape hatch for non-Vite projects (ship a regex catalogue, document the manual workaround)

---

## v2 — iPad attach over LAN (speculative draft)

**What it is**: the desktop shell becomes a workspace host. An iPad running a companion app joins the same workspace over the local network and drives the visual editor while the desktop keeps owning the filesystem, the dev server, and the sidecar.

**Future proposal**: `add-ipad-attach` (not yet drafted)

**Why LAN and not WebContainers**: the tablet cannot spawn `bun run dev` or write to the filesystem itself. LAN attach keeps all the messy parts on a real desktop, while the iPad is a rendered view plus an input surface. The Rust core grows a WebSocket listener — which is already factored out in v1 as "absent" — and the editor SPA grows a touch-adapted layout.

**v2 acceptance test**: Open a project on the desktop, walk into the other room, pick up the iPad, join the workspace, tap a heading, see the file on disk change, watch the preview HMR on the iPad.

**What stays the same**: `framework-engine`, the sidecar, the Rust project/dev-server modules, the SPA edit actions. Nothing about the edit pipeline changes — only the transport.

---

## v3 — Scripting surface (speculative draft)

**What it is**: the first plugin API. TypeScript is the first-class plugin language because the types come free from `framework-engine`. A Lua REPL may be added as a "quick transform" surface (type a one-liner, run it on the selected node, see the diff).

**Future proposal**: `add-scripting-surface` (not yet drafted)

**How it lands on top of v1/v2**: plugins execute inside the Bun sidecar that already exists, not in a new process. The sidecar becomes the "policy engine" for user-authored transforms. No new runtime, no new supervisor. The Rust core gets a single "approve this plugin for this project" UI and trust boundary.

**What it is not**: an AppKit extension framework. Not a scripting surface for the Rust core. Not a network call boundary for cloud plugins.

---

## v4 — Multi-user cloud workspace (maybe, maybe not)

**What it is**: Phoenix comes off the bench. Workspaces can live on a remote machine. The Rust core is extracted into a headless binary and run on a VM; Phoenix becomes the broker between client and workspace; `apps/backend` becomes load-bearing for the first time.

**Future proposal**: not drafted, not scheduled. Only becomes worth building if there is a clear answer to "who is the second user, and what do they need that v1/v2/v3 cannot do."

**Risk**: this is the version most likely to never ship. We are explicitly OK with that — the value of v1 does not depend on v4 happening.

---

## How to move from v-to-v

Every transition is meant to be **additive** — nothing we build in v1 should need to be rewritten for v2, v3, or v4:

| Transition | What changes | What stays the same |
|---|---|---|
| v1 → v2 | Rust core grows a WebSocket server; SPA gains touch layout | `framework-engine`, sidecar, dev-server supervisor, edit actions |
| v2 → v3 | Sidecar gains a plugin host module | Rust core, SPA, dev-server supervisor |
| v3 → v4 | Rust core runs headless on a VM; Phoenix becomes the broker | Everything else |

If any of those transitions would require rewriting the Rust core, the sidecar, or the SPA, the v1 design has failed and we should re-open [`openspec/changes/add-desktop-shell/design.md`](openspec/changes/add-desktop-shell/design.md).

## Update cadence

This roadmap is updated whenever a proposal lands, not on a calendar. Each landed change should:

1. Mark its ship-checklist items `[x]` here.
2. Leave the "explicitly not in this version" section untouched.
3. Append any **new** speculative drafts as `vN` placeholders without committing to dates.

Dates are deliberately absent. Deadlines are not how a personal tool gets built.
