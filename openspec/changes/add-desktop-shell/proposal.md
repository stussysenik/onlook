## Why

Onlook Next today is a web application: the editor runs in a browser tab, the framework-engine lives inside that tab, and the Phoenix backend is designed for hosted sessions. The owner wants to use Onlook on their own machine to visually edit their own local fullstack projects (starting with a SvelteKit + Vite + Convex project at `~/Desktop/portfolio-forever`). The web shape is wrong for this: a browser tab cannot open a local folder, supervise `bun run dev`, route file-system events, or feel native. A desktop shell unlocks the single-user, local-first workflow the product actually needs first, without throwing away the framework-engine and editor-shell work that already exists.

## What Changes

- Add a new Tauri 2 desktop application at `apps/desktop` that hosts the existing `apps/editor` SPA in its main WebView.
- Add a Rust core library at `apps/desktop/src-tauri` with three responsibilities: open a local project folder via a native picker; detect and supervise the project's dev server subprocess (`bun run dev` or equivalent); bridge framework-engine calls between the SPA and a Bun sidecar process.
- Add a Bun sidecar that runs `packages/framework-engine` out-of-process so the Rust core can invoke parse / emit / transform operations over a local stdio protocol, without blocking the WebView thread and without porting the TypeScript parsers to Rust for v1.
- Introduce a second WebView (as a Tauri child window or child webview) that renders the user's dev server URL (`http://localhost:<port>`), with the editor SPA owning the overlay layer for selection and drag handles.
- Ship a first-run "Open Folder…" flow that detects the package manager (bun / pnpm / npm / yarn), reads the `dev` script, spawns it, waits for readiness, and attaches the preview WebView. Out-of-scope scripts or unsupported project shapes must fail loudly, not silently.
- Do **not** wire the Phoenix backend (`apps/backend`) into the desktop app in v1. The desktop app is local-only; Phoenix stays in the repo for future multi-user / cloud work and is explicitly dormant.
- Do **not** build iPad / tablet shells, mDNS workspace discovery, scripting plugin APIs, or WebContainer offline mode in this change. Those are deliberately separate future proposals so v1 stays ruthlessly scoped.

## Capabilities

### New Capabilities
- `desktop-shell`: Hosts the editor SPA inside a Tauri 2 window on macOS, opens local project folders, supervises the project's dev server, bridges the editor SPA to `framework-engine` via a Bun sidecar, and renders a live preview WebView that the SPA can overlay.

### Modified Capabilities
<!-- None. This proposal intentionally does not change spec-level behavior of framework-engine or editor-contracts. If the sidecar protocol requires new message shapes, those will be added under desktop-shell rather than introducing a new framework-engine requirement. -->

## Impact

- **New directories**: `apps/desktop/` (Tauri shell), `apps/desktop/src-tauri/` (Rust core), `apps/desktop/sidecar/` (Bun entry for framework-engine).
- **Touched code**: `apps/editor` gains a small runtime adapter that detects "running inside desktop shell" and switches from mocked preview mode to the real localhost WebView path. No changes to the editor's tree, source pane, or inspector logic.
- **Dependencies added**: Rust crates (`tauri`, `tokio`, `serde`, `notify`, `portpicker`, `which`); Cargo workspace at `apps/desktop/src-tauri`. No new npm packages in `apps/editor`. No new packages for `packages/framework-engine`.
- **Dependencies NOT added**: Vapor, Phoenix, Loco.rs, Leptos, Capacitor, Electron, WebContainers, QuickJS, mlua, rhai, mruby. Every server framework and scripting runtime stays out of v1.
- **Platform**: macOS first. Linux and Windows builds are expected to work for free from Tauri but are not verified in v1; iPadOS / Android are deferred to a separate proposal.
- **User-visible**: A `.app` bundle that, when launched, lets the owner open `~/Desktop/portfolio-forever` and visually edit it against a running dev server. No auth, no onboarding, no cloud, no empty states.
- **Risks**: Bun sidecar process supervision (crash recovery, zombie cleanup); dev server port detection reliability across frameworks; WebView cross-origin isolation between editor SPA and preview; overlay alignment with preview DOM across HMR reloads. These are enumerated in `design.md`.
