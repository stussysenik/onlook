import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { buildLineStartIndexFallback, loadZigLineIndexerFromBinary, offsetToPositionWithIndex } from './accelerator';

describe('zig accelerator', () => {
  it('matches the TypeScript line index implementation', async () => {
    const wasmUrl = new URL('../zig/line_indexer.wasm', import.meta.url);
    const source = await readFile(wasmUrl);
    const zigIndexer = await loadZigLineIndexerFromBinary(
      source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
    );

    const sample = ['<section>', '  <h1>Hello</h1>', '  <p>World</p>', '</section>'].join('\n');
    const fallback = buildLineStartIndexFallback(sample);
    const accelerated = zigIndexer.buildLineStarts(sample);

    expect(Array.from(accelerated)).toEqual(Array.from(fallback));
    expect(offsetToPositionWithIndex(accelerated, sample.indexOf('World'))).toEqual({
      line: 3,
      column: 5,
      offset: sample.indexOf('World'),
    });
  });
});
