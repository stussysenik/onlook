# Onlook Next

Local-first visual editing reset for a true Onlook-style product.

## Current Shape

This repository now has a new first slice centered on:

- `apps/studio`: Svelte-based studio shell for live attachment and overlay editing
- `apps/react-host`: React target app used as the first live editing surface
- `packages/react-live-bridge`: Vite plugin + runtime bridge for DOM/source metadata and file writes
- `packages/zig-overlay-core`: Zig/WASM hit-testing core for overlay selection
- `apps/backend`: Phoenix backend kept as existing scaffolding for sessions, projects, and AI work
- `apps/editor`: legacy shell retained for reference while the live-editing path takes over

## What Works Now

- The studio can attach to a running React app over a bridge instead of rendering a synthetic preview pane.
- The React host emits live DOM element geometry and source metadata to the studio.
- The studio uses a Zig/WASM overlay core to pick live elements from pointer coordinates.
- Text and `className` edits can be written straight back to the React source file through the host bridge.
- The React host is now the first-class target surface; the old editor shell is no longer the default dev path.

## Run It

1. Install dependencies:

```bash
bun install
```

2. Start the React target app:

```bash
bun run dev:react-host
```

3. In another terminal, start the studio shell:

```bash
bun run dev:studio
```

4. Open the studio URL from the terminal output and attach to the React host URL.

## Validation

```bash
bun run typecheck
bun run test
bun run build
```

## Notes

- The new local-first loop is implemented without requiring Rails or Tauri yet.
- Rails remains a future control-plane option for product/workspace shape.
- Tauri remains the intended desktop host direction after this first live bridge slice.
