/**
 * Runtime adapter — the single seam that distinguishes "running inside the
 * Tauri desktop shell" from "running in a plain browser tab."
 *
 * Browser mode keeps the existing mocked behavior: source strings live in
 * component state, the in-process framework-engine does the parsing, and the
 * preview panel renders synthesized React nodes. Nothing changes for a user
 * who opens the editor in `bun run dev:editor`.
 *
 * Desktop mode swaps in a `DesktopAdapter` that routes file IO, project
 * loading, and preview-surface positioning through Tauri IPC commands defined
 * in `apps/desktop/src-tauri/src/lib.rs`. The SPA never imports
 * `@tauri-apps/api` at module level — it's a dynamic import guarded by
 * `isDesktop()` so the bundler can still produce a browser build that works
 * without the Tauri runtime installed.
 */

import type {
  EditAction,
  EditorDocument,
  FrameworkId,
} from '@onlook-next/editor-contracts';
import { loadFrameworkEngine } from '../engine';

export type ProjectHandle = {
  id: string;
  root: string;
  name: string;
  devScript: string;
  packageManager: 'bun' | 'pnpm' | 'npm' | 'yarn';
};

export type PreviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FileEntryKind = 'file' | 'dir';

export type FileEntry = {
  path: string;
  relative: string;
  kind: FileEntryKind;
  size: number | null;
  editable: boolean;
};

export type FileScanResult = {
  entries: FileEntry[];
  truncated: boolean;
};

export type Adapter = {
  mode: 'browser' | 'desktop';
  openProject(): Promise<ProjectHandle | null>;
  startDevServer(handle: ProjectHandle): Promise<void>;
  stopDevServer(): Promise<void>;
  parseSource(framework: FrameworkId, source: string): Promise<EditorDocument>;
  parseFile(path: string, framework: FrameworkId): Promise<EditorDocument>;
  emitEdit(document: EditorDocument, action: EditAction): Promise<EditorDocument>;
  attachPreview(url: string): Promise<void>;
  setPreviewBounds(bounds: PreviewBounds): Promise<void>;
  listFiles(): Promise<FileScanResult>;
  writeFile(path: string, contents: string): Promise<void>;
  closeProject(): Promise<void>;
};

/**
 * Framework inferred from a file path's extension. Returns `null` for paths
 * the current `framework-engine` cannot parse, so callers can render them as
 * disabled tree entries without duplicating the extension allow-list.
 */
export function inferFrameworkFromPath(path: string): FrameworkId | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.svelte')) return 'svelte';
  if (lower.endsWith('.jsx') || lower.endsWith('.tsx')) return 'react';
  return null;
}

export function isDesktop(): boolean {
  // `window.__TAURI_INTERNALS__` is the standard Tauri 2 marker. We also
  // tolerate the older `__TAURI__` global some plugins set during warm-up.
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}

let adapterPromise: Promise<Adapter> | null = null;

export function getAdapter(): Promise<Adapter> {
  // Cache the promise, not the resolved value, so concurrent callers during
  // React StrictMode double-invocation share a single in-flight resolution.
  if (!adapterPromise) {
    adapterPromise = (async (): Promise<Adapter> => {
      return isDesktop() ? await createDesktopAdapter() : createBrowserAdapter();
    })();
  }
  return adapterPromise;
}

// ---------------------------------------------------------------------------
// Browser adapter — mirrors the existing in-memory editor behavior. File IO
// is a no-op, previews are never real, dev-server calls throw so the SPA can
// render a "desktop only" state for anything that needs a running project.
// ---------------------------------------------------------------------------

function createBrowserAdapter(): Adapter {
  const notAvailable = (name: string) => {
    throw new Error(`${name} is only available in the desktop shell.`);
  };

  return {
    mode: 'browser',
    async openProject() {
      return null;
    },
    async startDevServer() {
      notAvailable('startDevServer');
    },
    async stopDevServer() {
      // No-op — browser mode never owns a dev server.
    },
    async parseSource(framework, source) {
      const engine = await loadFrameworkEngine();
      return engine.parseDocument(framework, source);
    },
    async parseFile() {
      notAvailable('parseFile');
      return undefined as unknown as EditorDocument;
    },
    async emitEdit(document, action) {
      const engine = await loadFrameworkEngine();
      return engine.applyEdit(document, action);
    },
    async attachPreview() {
      // Browser mode uses the mocked PreviewNode tree — no real webview.
    },
    async setPreviewBounds() {
      // Browser mode never positions a child webview.
    },
    async listFiles() {
      notAvailable('listFiles');
      return undefined as unknown as FileScanResult;
    },
    async writeFile() {
      notAvailable('writeFile');
    },
    async closeProject() {
      // No resources to release in browser mode.
    },
  };
}

// ---------------------------------------------------------------------------
// Desktop adapter — real Tauri IPC. All calls are dynamic-imported so the
// browser bundle stays free of `@tauri-apps/api`.
// ---------------------------------------------------------------------------

async function createDesktopAdapter(): Promise<Adapter> {
  const { invoke } = await import('@tauri-apps/api/core');

  return {
    mode: 'desktop',

    async openProject() {
      const path = (await invoke<string | null>('project_open_dialog')) ?? null;
      if (!path) return null;
      const handle = await invoke<{
        id: string;
        root: string;
        name: string;
        dev_script: string;
        package_manager: ProjectHandle['packageManager'];
      }>('project_validate', { path });
      return {
        id: handle.id,
        root: handle.root,
        name: handle.name,
        devScript: handle.dev_script,
        packageManager: handle.package_manager,
      };
    },

    async startDevServer(handle) {
      await invoke('dev_server_start', { path: handle.root });
    },

    async stopDevServer() {
      await invoke('dev_server_stop');
    },

    async parseSource(framework, source) {
      // The Rust core can also round-trip parse requests via the sidecar,
      // but for a plain source string the in-process engine is cheaper and
      // yields identical IR. Only real file IO goes through IPC.
      const engine = await loadFrameworkEngine();
      return engine.parseDocument(framework, source);
    },

    async parseFile(path, framework) {
      const response = await invoke<{ document: EditorDocument }>('engine_parse_file', {
        path,
        framework,
      });
      return response.document;
    },

    async emitEdit(document, action) {
      const response = await invoke<{ document: EditorDocument; serialized: string }>(
        'engine_emit_edit',
        { document, action },
      );
      return response.document;
    },

    async attachPreview(url) {
      await invoke('preview_attach', { url });
    },

    async setPreviewBounds(bounds) {
      await invoke('preview_set_bounds', { bounds });
    },

    async listFiles() {
      // Rust returns the entries in snake_case-free shape already because
      // `serde` uses field names verbatim here; we just retype the incoming
      // value so the SPA never touches the wire shape directly.
      return await invoke<FileScanResult>('project_list_files');
    },

    async writeFile(path, contents) {
      await invoke('project_write_file', { path, contents });
    },

    async closeProject() {
      await invoke('project_close');
    },
  };
}
