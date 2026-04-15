# apps/editor preview surface — as-is

Resolved as part of §1.1 recon. Answers Open Question 1 in `design.md`.

## Current wiring (no iframe, no real preview)

`apps/editor` renders an entirely synthesized React preview, not an `<iframe>` and not a real runtime. See `apps/editor/src/App.tsx:363–379` for the preview panel and `App.tsx:505–580` for the recursive `PreviewNode` component.

- The SPA keeps sample Svelte / React source strings in state (`SAMPLE_SOURCES` at `App.tsx:13–48`).
- It calls `engine.parseDocument` to get an `EditorDocument` IR (`App.tsx:101`).
- It walks `document.root.children` and renders each node using `createReactElement(tagName, props, children)` via `renderHtmlElement` (`App.tsx:582–584`).
- Selection is tracked by `selectedNodeId` state and the preview nodes add a `preview-node-active` class for the selected one.
- Text nodes are rendered as `<span>`, components as labeled `<div>`, and elements as their native tag (whitelisted with a safe-tag regex at `App.tsx:565`).

**There is no real dev server, no file IO, no HMR, and no cross-origin concern in the current code.** The entire preview is a mock of what the source would look like rendered, built on top of the parsed IR.

## Implications for the desktop adapter

- The runtime adapter is a **new code path**, not a swap-out of existing iframe wiring. Nothing needs to be ripped out.
- In desktop mode the preview panel renders an empty, sized, positioned container with a `data-desktop-preview-slot` attribute. The SPA measures it with a `ResizeObserver` and posts `preview_set_bounds` to Rust; Rust positions the child webview over those bounds.
- The in-memory mock preview (`PreviewNode` component) is kept as the browser-mode fallback. No deletion, no regression in `bun run dev:editor`.
- The existing inspector actions (text, class, insert, move, remove) already produce the edit action discriminated union — they feed straight into `adapter.emitEdit` with no code change to the inspector UI.
- The Phoenix backend panel in `App.tsx:441–462` stays untouched: it is out of scope per `proposal.md` and disabled in desktop mode, which is visually simpler than ripping it out.

## Open-question status

- **Q1 (design.md)**: Resolved. Current preview is mocked in-process, not an iframe. The desktop adapter is additive.
