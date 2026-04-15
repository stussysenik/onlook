/**
 * Minimal ambient types for `@tauri-apps/api` so the editor can typecheck
 * before `bun install` has been run. Once the real package is installed,
 * TypeScript will prefer its declarations over these shims — this file
 * exists only so the dynamic imports in `runtime/adapter.ts` and
 * `runtime/events.ts` don't break the browser-mode typecheck when the
 * package hasn't been added to `node_modules` yet.
 */

declare module '@tauri-apps/api/core' {
  export function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
}

declare module '@tauri-apps/api/event' {
  export interface Event<T> {
    event: string;
    id: number;
    payload: T;
  }
  export type UnlistenFn = () => void;
  export function listen<T>(
    event: string,
    handler: (event: Event<T>) => void,
  ): Promise<UnlistenFn>;
  export function emit(event: string, payload?: unknown): Promise<void>;
}
