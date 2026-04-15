# framework-engine API surface used by apps/editor

Resolved as part of §1.2 recon. Every call `apps/editor` makes into `@onlook-next/framework-engine` is enumerated here. The Bun sidecar protocol derives directly from this list.

## Call sites in `apps/editor/src`

| SPA site | Engine API | Purpose |
|---|---|---|
| `App.tsx` L101 (`reparseSource`) | `engine.parseDocument(framework, source)` | Parse source string → `EditorDocument` IR. |
| `App.tsx` L144 (`applyNodeEdit`) | `engine.applyEdit(document, { type: 'update_text', nodeId, text })` | Edit text content of a node. |
| `App.tsx` L152 (`applyNodeEdit`) | `engine.applyEdit(document, { type: 'update_styles', nodeId, className })` | Edit class/className. |
| `App.tsx` L168 (`insertChildNode`) | `engine.applyEdit(document, { type: 'insert_node', parentId, node })` | Insert a new child node. |
| `App.tsx` L189 (`removeSelectedNode`) | `engine.applyEdit(document, { type: 'remove_node', nodeId })` | Remove a node. |
| `App.tsx` L213 (`moveSelectedNode`) | `engine.applyEdit(document, { type: 'move_node', nodeId, targetParentId, index })` | Reorder a node. |

`framework-engine`'s own `executeAction` (`packages/framework-engine/src/index.ts:105–201`) also supports `update_attributes`. The SPA does not currently call it, but the sidecar protocol should accept it so we don't have to widen the contract later.

## Dynamic loader

`apps/editor/src/engine.ts:1–9` uses `import('@onlook-next/framework-engine')` and memoizes the module promise. The runtime adapter keeps this shape: in browser mode it still dynamic-imports the in-process engine; in desktop mode it swaps in an IPC-backed module with the same surface so `App.tsx` can stay dumb.

## Derived sidecar protocol

Two request types are sufficient for v1:

```ts
type ParseFileRequest = {
  kind: 'parse_file';
  path: string;          // absolute path inside the opened project
  framework: FrameworkId;
};

type EmitEditRequest = {
  kind: 'emit_edit';
  document: EditorDocument;
  action: EditAction;    // the same discriminated union from editor-contracts
};
```

Both requests map 1:1 onto engine calls (`parseDocument(framework, fs.readFileSync(path))` and `applyEdit(document, action)`), so porting is type-level plumbing. No new behavior belongs in the sidecar — it is the engine with a stdio mouth.

## Open-question status

- **Q2 (design.md)**: Resolved. Two engine calls, five edit action types in use today, one more (`update_attributes`) available in the engine but unused by the SPA.
