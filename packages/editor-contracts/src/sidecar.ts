/**
 * Sidecar protocol — type-only.
 *
 * The Rust desktop shell spawns a Bun subprocess that hosts
 * `@onlook-next/framework-engine`. Messages travel over stdio as
 * length-prefixed JSON: a 4-byte little-endian `u32` length, followed by that
 * many bytes of UTF-8 JSON. Every request has an `id` that the response echoes
 * back so the Rust side can match responses without keeping an ordering
 * assumption.
 *
 * Nothing in here runs at runtime — the shared types give both the sidecar
 * entry (`apps/desktop/sidecar/index.ts`) and the Rust supervisor a single
 * authoritative shape, without forcing either side to import a package they
 * don't already depend on.
 */

import type { EditAction, EditorDocument, FrameworkId } from './index';

export interface SidecarRequestEnvelope<T> {
  id: string;
  kind: T;
}

export type SidecarRequest =
  | (SidecarRequestEnvelope<'parse_source'> & {
      framework: FrameworkId;
      source: string;
      /** Optional absolute path used to disambiguate parser output. */
      path?: string;
    })
  | (SidecarRequestEnvelope<'parse_file'> & {
      framework: FrameworkId;
      path: string;
    })
  | (SidecarRequestEnvelope<'emit_edit'> & {
      document: EditorDocument;
      action: EditAction;
    })
  | (SidecarRequestEnvelope<'ping'> & Record<string, never>);

export type SidecarResponse =
  | { id: string; ok: true; kind: 'parse_source' | 'parse_file'; document: EditorDocument }
  | { id: string; ok: true; kind: 'emit_edit'; document: EditorDocument; serialized: string }
  | { id: string; ok: true; kind: 'ping'; version: string }
  | { id: string; ok: false; error: { code: string; message: string } };

export interface SidecarHello {
  type: 'hello';
  version: string;
}
