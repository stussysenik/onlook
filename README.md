# Onlook Next

![Demo](demo.gif)


Svelte-first visual editing core inspired by Onlook, implemented as a Bun workspace plus a Phoenix backend.

## Intention

This repository is being repurposed from a direct Onlook fork into a new product direction:

- keep the visual, source-aware editing model
- replace the hosted app backend shape with Phoenix for sessions, presence, and persistence
- center the editing engine on a framework-neutral IR
- ship Svelte first, then extend the same engine to React and Vue
- treat Zig as a later optimization tool for measured hot paths, not as the primary app rewrite

The current code is the first vertical slice of that direction. It proves the architecture with a React editor shell, a Svelte-first TypeScript framework engine, and a Phoenix backend for projects, sessions, and collaboration channels.

## What is implemented

- React editor app with:
  - source pane
  - framework-neutral tree view
  - preview surface with selectable nodes
  - inspector actions for text, class, insert, move, and remove
  - backend persistence actions for project/session creation and source saves
- TypeScript framework engine with:
  - shared `EditorNode` / `EditorDocument` contracts
  - Svelte parser + source regeneration
  - React parser baseline + source regeneration
  - Vue adapter stub that fails explicitly for now
- Phoenix backend with:
  - persisted `projects` and `sessions`
  - JSON APIs
  - project collaboration channel
  - presence tracking

## Run it

1. Install JS dependencies:

```bash
bun install
```

2. Start Phoenix (only needed for the web-mode backend path — the desktop shell does not use it):

```bash
cd apps/backend
mix deps.get
mix ecto.create
mix ecto.migrate
mix phx.server
```

3. In another terminal, start the editor:

```bash
bun run dev:editor
```

The editor runs at `http://localhost:5173` and (in browser mode) talks to Phoenix at `http://localhost:4000`.

## Desktop dev

The desktop shell is a Tauri 2 application that hosts the same `apps/editor` SPA, opens a local project folder via a native macOS picker, supervises the project's dev server, and bridges `framework-engine` calls through a Bun sidecar. It does **not** talk to Phoenix — v1 is a single-user, local-only workflow.

```bash
# One command: boots the editor dev server + the Tauri shell
bun run dev:desktop
```

First launch will download the Tauri crate graph (~200 crates, several minutes) and compile the Rust core. Subsequent launches are fast.

To open a project inside the shell, click "Open folder…" in the top bar and point at a folder whose `package.json` has a `scripts.dev` entry. The shell spawns `bun run dev` in that folder, waits for it to print a local URL, attaches a child webview to the URL, and wires the editor's inspector actions to edit the source through the sidecar. The target of verification is `~/Desktop/portfolio-forever`, but any SvelteKit/Vite/Next-style project should work.

### File tree

Once the dev server is ready, the left rail turns into a file tree scanned from the project root. `node_modules`, `.git`, `dist`, `build`, `.svelte-kit`, `.next`, `.turbo`, and `.cache` are ignored; the scan is capped at 10,000 entries. Click any `.svelte`, `.jsx`, or `.tsx` file to load it into the inspector — other extensions are shown grayed out. Inspector edits (text, class, insert, move, remove) write back to disk via an atomic temp-file-plus-rename, and the project's own dev server HMR reloads the preview. The left-rail textarea is read-only in desktop mode — source changes happen through the inspector.

See [`openspec/changes/add-desktop-shell/`](openspec/changes/add-desktop-shell/) and [`openspec/changes/add-desktop-file-tree/`](openspec/changes/add-desktop-file-tree/) for the full specs.

## Validation

```bash
bun run build
bun run test
bun run typecheck
cd apps/backend && mix test
```
