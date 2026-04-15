# Onlook Next — Tech Stack

This document records **what we use and why**, plus **what we deliberately don't use and why**. It's paired with [VISION.md](VISION.md), [ROADMAP.md](ROADMAP.md), [PROGRESS.md](PROGRESS.md), and the active openspec proposals under [`openspec/changes/`](openspec/changes/).

> **As-built status (2026-04-15)**: the desktop shell described in the "v1 additions" section below is now on disk and passes `openspec validate --strict`. The first full `cargo build` has not been run yet — the dev machine ran out of disk during the apply pass. See [`PROGRESS.md`](PROGRESS.md) for the exact verification state.

---

## Current state of the repo

```
onlook-next (Bun workspace)
├── apps/
│   ├── editor/        Vite + React 19 SPA   (the visual editor UI)
│   └── backend/       Phoenix (Elixir)      (DORMANT in v1 — future collab)
├── packages/
│   ├── editor-contracts/    shared TypeScript types
│   └── framework-engine/    framework-neutral IR + Svelte + React parsers
└── openspec/                change proposals (spec-driven)
```

## v1 additions (now on disk — apply pass 1)

```
apps/desktop/                 Tauri 2 shell (NEW)
├── package.json              Bun workspace member (JS side)
├── sidecar/
│   └── index.ts              Bun entry; hosts framework-engine over stdio JSON
└── src-tauri/
    ├── Cargo.toml            Rust core crate
    ├── build.rs              Tauri build script
    ├── tauri.conf.json       Window, devUrl, bundle (dev-only in v1)
    ├── capabilities/
    │   └── default.json      Permissions for dialog + webview APIs
    └── src/
        ├── main.rs           Binary entry → lib::run()
        ├── lib.rs            AppState, Tauri builder, IPC command handlers
        ├── error.rs          Typed CoreError → {kind, message} JSON
        ├── projects.rs       Native folder picker + package.json validation
        ├── dev_server.rs     bun run dev supervisor + URL regex catalogue
        ├── sidecar.rs        Bun sidecar supervisor + length-prefixed JSON
        ├── preview.rs        Child webview + bounds + probe script
        └── preview_probe.js  Injected into the preview webview at load time

apps/editor/src/              (TOUCHED surgically)
├── runtime/
│   ├── adapter.ts            isDesktop() + BrowserAdapter + DesktopAdapter
│   ├── events.ts             Typed subscribe() for Tauri IPC events
│   └── tauri-shim.d.ts       Ambient types so typecheck works pre-install
├── StatusBanner.tsx          NEW
└── App.tsx                   Additive desktop-mode top bar + preview slot
```

---

## Stack by layer

### Shell — Tauri 2 (Rust)

| | |
|---|---|
| **Role** | Native macOS `.app` bundle; hosts the editor SPA in its main WebView; owns the child WebView for the preview; bridges the SPA to the Rust core via Tauri IPC. |
| **Version** | Tauri 2.x |
| **Runtime** | System WebView (WKWebView on macOS); ~3 MB binary overhead vs ~150 MB for Electron. |
| **Targets v1** | macOS (primary). Linux and Windows builds likely work for free from Tauri but are not verified. iPadOS / Android deferred to a future proposal (`add-ipad-attach`). |

**Why Tauri and not the alternatives**:

- **Not Electron** — ships Chromium, huge binary, the owner explicitly dislikes the "Electron look," and the memory footprint is wrong for a local tool.
- **Not Swift + SwiftUI + Catalyst** — best macOS polish but locks us into Apple, forces a second codebase the moment we want cross-platform, and throws away months of React SPA work.
- **Not a pure web app in a browser tab** — status quo we're trying to leave. Browser tabs cannot open local folders, spawn dev servers, or persist native window state.
- **Not Flutter / .NET MAUI / Qt** — no reason to leave the React ecosystem when the editor SPA already lives there.

### Editor UI — existing Vite + React 19 SPA

| | |
|---|---|
| **Role** | The visual editor itself: source pane, framework-neutral tree view, preview surface (overlay canvas for selection/drag), inspector for text/class/insert/move/remove. |
| **Location** | `apps/editor` — no framework migration planned. |
| **Entry** | Single `index.html` + Vite — Tauri's happiest case. |

**Why we keep it**: rewriting the editor in SwiftUI or egui would be months of UI work thrown away for aesthetic reasons. The SPA is the moat. Tauri hosts it unchanged.

**What it gains in v1**: a small **runtime adapter** (`apps/editor/src/runtime/adapter.ts`) that detects `window.__TAURI_INTERNALS__` and switches file IO, project loading, and preview surface to IPC-backed implementations. Browser-mode fallback is preserved — the SPA still works in a regular browser tab with the mocked preview path.

### Rust core — Tauri `src-tauri` crate

Minimal by design. Three responsibilities:

1. **Project loader**: native macOS folder picker, `package.json` validation.
2. **Dev-server supervisor**: spawns the project's dev script as a child process, captures stdout, detects the served URL via a regex catalogue, owns the child's lifetime so nothing leaks on shutdown.
3. **Sidecar supervisor**: spawns the Bun sidecar, bridges framework-engine calls over stdin/stdout with a length-prefixed JSON protocol, forwards to the SPA via Tauri IPC commands.

**Rust crates**:

| Crate | Why |
|---|---|
| `tauri` 2.x | The shell itself. |
| `tauri-plugin-dialog` | Native file picker. |
| `tokio` | Async runtime for child process supervision and IPC. |
| `serde` / `serde_json` | IPC payload encoding. |
| `notify` | Filesystem watcher (debounced against our own writes). |
| `portpicker` or equivalent | Port probing for dev-server readiness checks. |
| `which` | Locate `bun` binary on PATH. |

**What is not in the Rust core**: business logic, AST parsers, framework knowledge, scripting runtimes, network servers, auth, anything that could conceivably belong to the SPA or the sidecar. Rust is plumbing, not policy.

### Framework-engine host — Bun sidecar

| | |
|---|---|
| **Role** | Runs `packages/framework-engine` in its native runtime, accepts parse / emit / transform requests from the Rust core over stdio, returns `EditorDocument` IR and source strings. |
| **Why a subprocess** | Keeps framework-engine in TypeScript. No need to port Svelte / React parsers to Rust in v1. |
| **Protocol** | Length-prefixed JSON (messages typed in `packages/editor-contracts`). |
| **Lifetime** | Owned by the Rust core's `sidecar_supervisor`. Crashes surface a `SidecarCrashed` IPC event to the SPA; no auto-restart. |

**Alternative considered and rejected**: embedding a JS engine in Rust (QuickJS / rquickjs, Deno core, Boa). All of them complicate debugging, some don't run Bun-specific APIs the engine depends on, and none produce a meaningful win over a separate subprocess for a tool that runs on the owner's machine. The subprocess is honest, inspectable (`ps`, `lsof`), and swappable.

### Preview rendering — separate child WebView, not iframe

| | |
|---|---|
| **Role** | Renders the user project's dev-server URL (e.g. `http://localhost:5173`) inside a Tauri child webview attached to the main window. |
| **Why not an iframe** | Cross-origin between `tauri://localhost` (editor SPA) and `http://localhost:5173` (user dev server) creates surprising failures around `postMessage`, cookies, and event propagation. A child webview gives us process isolation, independent navigation, and a clean overlay story. |
| **Overlay** | The editor SPA draws selection handles on a transparent canvas positioned over the child webview's bounding rect. Coordinates sync via IPC (`preview_set_bounds`). DOM inspection happens via a Rust-injected probe script inside the preview webview that posts element identifiers back to Rust. |

### Source of truth — the filesystem, no database

- Project state lives in files. The editor writes via the sidecar → Rust → `fs::write`.
- File-watcher events for paths we just wrote are suppressed for 500 ms to avoid a self-triggered reparse loop.
- **No SQLite, no database, no session store** in v1. If we ever need persisted workspace state (window positions, recent projects), it goes in a plain JSON file in the macOS app support dir. Not a database.

### Dev-server supervision — subprocess, not in-process bundling

We spawn the project's own dev script (`bun run dev`) as a child process. We don't run Vite or esbuild or SWC ourselves.

**Why**: whatever the user's project does — Vite, Webpack, Turbopack, Next.js, SvelteKit, Astro, Nuxt, `portless portfolio vite dev`, Convex's dev server running alongside — works without Onlook knowing. Compatibility scales with the ecosystem for free, including fullstack projects with server routes. The cost is port detection and readiness probing, which is tractable with a regex catalogue + an explicit override escape hatch.

---

## What we deliberately do not use

Every entry here was considered seriously and rejected. The rejections are load-bearing — if we forget why we rejected them, we will drift back into complexity for no user.

### No Electron
Binary size, memory footprint, aesthetics. Tauri solves the same problem at a fraction of the cost.

### No Phoenix in v1
`apps/backend` stays in the repo but is not wired into the desktop shell. A single-user local tool does not need a web server framework. Phoenix becomes load-bearing again if/when we add multi-user presence (v2's LAN workspace is the first step, v4 cloud if ever). Until then: dormant.

### No Vapor
Swift-on-server makes no sense when our client is React/TypeScript — you don't get the one win (shared types client/server) and you pay the full cost (extra language, extra runtime, extra deployment). If we ever want native Swift for Mac-only distribution, Vapor still doesn't belong — Tauri's Rust core is the backend.

### No Loco.rs, no Leptos, no Axum-as-framework
Same principle as Phoenix and Vapor: a local desktop tool needs a **daemon**, not a **server framework**. Daemons are ~200 lines of Rust. Frameworks are for strangers hitting your box. In v1, zero strangers hit our box.

### No WebContainers (StackBlitz)
Tempting for offline iPad support ("run Node in WASM inside the tablet's WebView"). Rejected because:
1. Licensing — commercial use requires a license.
2. Constraints — Node-only, some APIs missing, network requests proxied.
3. Scope — nothing in v1 or v2 needs it. iPad attach (v2) talks to a desktop workspace over LAN, which is simpler and more powerful.

### No embedded scripting runtime (QuickJS / mlua / mruby / rhai)
v1 has no plugin surface. Scripting arrives in v3 (`add-scripting-surface`) and will be built on top of the Bun sidecar, using TypeScript as the first-class plugin language (types come free from `framework-engine`). A Lua REPL may be added as a quick-transform surface. Ruby is a dead end — mruby embed is heavy and splits the plugin ecosystem for no gain.

### No Metal / WebGPU foundation in v1
Metal and WebGPU are tools looking for problems until we have infinite-canvas zoom, multi-viewport compositing, or shader-driven effects. The drag handles are 2D. The preview is HTML. Native feel comes from AppKit's compositor for free. We will reconsider when we have a concrete reason (most likely v4+).

### No Rust port of framework-engine in v1
The parsers work in TypeScript today. Porting them to Rust costs 3–6 weeks and delivers zero new user-visible capability. Revisit only if the sidecar hop becomes a measured bottleneck.

### No cross-platform testing in v1
Tauri will likely produce working Linux and Windows builds. We will not verify them. Verification happens when a platform becomes load-bearing, not preemptively.

### No iPadOS, Android, or tablet support in v1
Deferred to `add-ipad-attach`. iOS cannot spawn subprocesses, which means the tablet build is architecturally different from the desktop build (workspace-over-LAN instead of workspace-in-process). That difference deserves its own proposal and its own review.

### No code signing, notarization, Gatekeeper certificates
Dev build only for v1. Distribution is not a v1 concern.

### No telemetry, no analytics, no Sentry, no PostHog
Personal tool. If it breaks, the owner is right there. External observability only becomes useful when we have users who are not the owner, which is v4 if ever.

### No i18n, theming, empty states, onboarding
Personal tool.

### No CI / release pipeline for the desktop shell
We run it locally. When we have users, we set up CI.

---

## Why the stack hangs together

The whole thing is one coherent bet: **keep the TypeScript editing layer, wrap it in Rust for OS integration, supervise subprocesses instead of owning runtimes, and defer every abstraction until a real v-number needs it.**

That bet minimizes new code per unit of user value and leaves clean seams for later expansion:

- Adding iPad = make the Rust core optionally expose a LAN WebSocket server. No changes to framework-engine, no changes to the SPA beyond a touch-adapted layout.
- Adding cloud = extract the Rust core into a headless binary and run it on a VM. Phoenix becomes the broker between client and workspace. Same Rust code.
- Adding scripting = reuse the existing Bun sidecar for plugin execution. No new runtime process.
- Adding React and Vue parity = framework-engine's IR is already framework-neutral; the Vue adapter stub becomes a real adapter. Nothing in the shell changes.
- Porting framework-engine to Rust later = localized change inside `src-tauri/src/engine/`, invisible to the SPA because the IPC contract is stable.

Every one of those future moves is additive. None of them require a rewrite. That's what makes the v1 scope worth committing to.

---

## Reference proposals

- **Active, v1**: [`openspec/changes/add-desktop-shell/`](openspec/changes/add-desktop-shell/)
  - `proposal.md` — what and why
  - `design.md` — architectural decisions with alternatives
  - `specs/desktop-shell/spec.md` — requirements and scenarios
  - `tasks.md` — ordered, verifiable implementation checklist

- **Future, not yet drafted**: `add-ipad-attach`, `add-scripting-surface`. Stubs will land when v1 is working.
