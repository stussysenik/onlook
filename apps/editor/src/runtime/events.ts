/**
 * IPC event subscription helpers.
 *
 * The desktop shell emits a small set of events the SPA reacts to:
 *
 * - `desktop://dev-server-ready`     — dev server reachable at `url`
 * - `desktop://dev-server-timeout`   — no URL after 60 seconds
 * - `desktop://dev-server-exited`    — child process exited (code + stderr)
 * - `desktop://sidecar-crashed`      — framework-engine sidecar died
 * - `desktop://preview-attached`     — child webview is attached
 * - `desktop://preview-reloaded`     — preview webview HMR-reloaded
 * - `desktop://preview-click`        — user clicked inside the preview
 * - `desktop://preview-hover`        — mouse moved over a preview element
 * - `desktop://preview-loaded`       — preview webview finished loading
 *
 * Browser mode no-ops every subscription so `App.tsx` can call them
 * unconditionally without branching on `isDesktop()`.
 */

import { isDesktop } from './adapter';

export type DevServerReady = { url: string; pid: number };
export type DevServerTimeout = { stdoutBuffer: string };
export type DevServerExited = { code: number | null; lastStderr: string[] };
export type SidecarCrashed = { code: number | null };
export type PreviewSelection = {
  tag: string;
  id: string | null;
  className: string | null;
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
  path: string;
};

export type UnsubscribeFn = () => void;

export async function subscribe<T>(
  eventName: string,
  handler: (payload: T) => void,
): Promise<UnsubscribeFn> {
  if (!isDesktop()) return () => undefined;

  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<T>(eventName, (event) => handler(event.payload));
  return () => unlisten();
}

export const EVENTS = {
  devServerReady: 'desktop://dev-server-ready',
  devServerTimeout: 'desktop://dev-server-timeout',
  devServerExited: 'desktop://dev-server-exited',
  sidecarCrashed: 'desktop://sidecar-crashed',
  previewAttached: 'desktop://preview-attached',
  previewReloaded: 'desktop://preview-reloaded',
  previewClick: 'desktop://preview-click',
  previewHover: 'desktop://preview-hover',
  previewLoaded: 'desktop://preview-loaded',
} as const;
