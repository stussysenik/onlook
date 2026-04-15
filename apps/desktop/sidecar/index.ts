/**
 * Onlook Next sidecar — Bun process that hosts `@onlook-next/framework-engine`.
 *
 * The desktop Rust core spawns this file and talks to it over stdio using a
 * length-prefixed JSON protocol:
 *
 *     [u32 LE length] [N bytes UTF-8 JSON]
 *
 * One message per frame. Requests and responses share a string `id` so the
 * Rust side can match pairs without relying on ordering. Anything that is not
 * a recognized request kind is answered with an error envelope and the loop
 * keeps running — we never tear the sidecar down from inside for recoverable
 * input errors. Only a protocol-level framing failure causes an exit.
 *
 * Everything in this file runs in Bun, not Node, so `Bun.stdin` / `Bun.stdout`
 * are the happy path. No Node polyfills, no `process.stdin` event listeners.
 */

import { applyEdit, parseDocument } from '@onlook-next/framework-engine';
import type {
  EditAction,
  EditorDocument,
  FrameworkId,
  SidecarRequest,
  SidecarResponse,
} from '@onlook-next/editor-contracts';

const VERSION = '0.0.0-sidecar';

type FramedRequest = SidecarRequest;
type FramedResponse = SidecarResponse;

function encodeFrame(payload: unknown): Uint8Array {
  const text = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(text);
  const frame = new Uint8Array(4 + bytes.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, bytes.length, true);
  frame.set(bytes, 4);
  return frame;
}

async function writeResponse(response: FramedResponse): Promise<void> {
  const frame = encodeFrame(response);
  // Bun exposes stdout as a Writer; writing a Uint8Array is atomic at the
  // syscall level so we don't need to hand-sync multiple writes per frame.
  await Bun.write(Bun.stdout, frame);
}

async function sayHello(): Promise<void> {
  // The hello payload is the first frame Rust will read so it can distinguish
  // "sidecar spawned and healthy" from "sidecar crashed during startup."
  const hello = { id: 'hello', ok: true as const, kind: 'ping' as const, version: VERSION };
  await writeResponse(hello);
}

async function handleRequest(request: FramedRequest): Promise<FramedResponse> {
  try {
    switch (request.kind) {
      case 'ping': {
        return { id: request.id, ok: true, kind: 'ping', version: VERSION };
      }

      case 'parse_source': {
        const document = parseDocument(request.framework, request.source);
        return { id: request.id, ok: true, kind: 'parse_source', document };
      }

      case 'parse_file': {
        const source = await Bun.file(request.path).text();
        const document = parseDocument(request.framework, source);
        return { id: request.id, ok: true, kind: 'parse_file', document };
      }

      case 'emit_edit': {
        const nextDocument = applyEdit(request.document as EditorDocument, request.action as EditAction);
        return {
          id: request.id,
          ok: true,
          kind: 'emit_edit',
          document: nextDocument,
          serialized: nextDocument.source,
        };
      }

      default: {
        return errorResponse((request as { id?: string }).id ?? 'unknown', 'unknown_request', `Unknown request kind`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse((request as { id?: string }).id ?? 'unknown', 'engine_error', message);
  }
}

function errorResponse(id: string, code: string, message: string): FramedResponse {
  return { id, ok: false, error: { code, message } };
}

async function runReadLoop(): Promise<void> {
  // Read framed messages off stdin. Bun's stdin is an async iterable of
  // `Uint8Array` chunks — we accumulate them in a buffer and peel off frames
  // whenever we have enough bytes.
  let buffer = new Uint8Array(0);

  async function* framesFromStdin() {
    for await (const chunk of Bun.stdin.stream()) {
      const merged = new Uint8Array(buffer.length + chunk.length);
      merged.set(buffer, 0);
      merged.set(chunk, buffer.length);
      buffer = merged;

      while (buffer.length >= 4) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const length = view.getUint32(0, true);
        if (buffer.length < 4 + length) break;

        const jsonBytes = buffer.slice(4, 4 + length);
        buffer = buffer.slice(4 + length);

        try {
          const text = new TextDecoder().decode(jsonBytes);
          const parsed = JSON.parse(text) as FramedRequest;
          yield parsed;
        } catch (err) {
          yield {
            id: 'parse_error',
            kind: 'ping',
            // @ts-expect-error — decoy request; handler will answer with an error.
            __framing_error: err instanceof Error ? err.message : String(err),
          } as FramedRequest;
        }
      }
    }
  }

  for await (const request of framesFromStdin()) {
    const response = await handleRequest(request);
    await writeResponse(response);
  }
}

async function main(): Promise<void> {
  await sayHello();
  await runReadLoop();
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  writeResponse({
    id: 'fatal',
    ok: false,
    error: { code: 'fatal', message },
  }).finally(() => {
    process.exit(1);
  });
});
