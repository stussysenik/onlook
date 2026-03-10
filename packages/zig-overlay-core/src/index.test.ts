import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { loadOverlayCoreFromBinary, pickTargetIndexFallback } from './index';

describe('zig overlay core', () => {
  it('picks the smallest containing rectangle', async () => {
    const wasmUrl = new URL('../zig/hit_test.wasm', import.meta.url);
    const source = await readFile(wasmUrl);
    const overlayCore = await loadOverlayCoreFromBinary(
      source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
    );

    const rects = [
      { x: 0, y: 0, width: 400, height: 400 },
      { x: 40, y: 40, width: 160, height: 80 },
      { x: 60, y: 60, width: 30, height: 20 },
    ];

    expect(overlayCore.pickTarget(rects, 66, 66)).toBe(2);
    expect(pickTargetIndexFallback(rects, 66, 66)).toBe(2);
    expect(overlayCore.pickTarget(rects, 5, 5)).toBe(0);
    expect(overlayCore.pickTarget(rects, 700, 700)).toBe(-1);
  });
});
