import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildLineStartIndexFallback,
  loadZigLineIndexerFromBinary,
} from '../src/accelerator.ts';

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const wasmPath = resolve(packageDir, 'zig', 'line_indexer.wasm');
const sample = Array.from({ length: 5000 }, (_, index) => `<div data-row="${index}">Row ${index}</div>`).join('\n');

const binary = await readFile(wasmPath);
const zigIndexer = await loadZigLineIndexerFromBinary(
  binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength),
);

function benchmark(label, fn) {
  const start = performance.now();
  for (let index = 0; index < 200; index += 1) {
    fn();
  }
  const end = performance.now();
  return `${label}: ${(end - start).toFixed(2)}ms`;
}

console.log(benchmark('ts', () => buildLineStartIndexFallback(sample)));
console.log(benchmark('zig-wasm', () => zigIndexer.buildLineStarts(sample)));
