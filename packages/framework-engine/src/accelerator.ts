import type { SourcePosition } from '@onlook-next/editor-contracts';

type ZigLineIndexerExports = {
  memory: WebAssembly.Memory;
  alloc: (size: number) => number;
  free: (pointer: number, size: number) => void;
  count_line_starts: (sourcePointer: number, sourceLength: number) => number;
  fill_line_starts: (
    sourcePointer: number,
    sourceLength: number,
    outputPointer: number,
    outputLength: number,
  ) => number;
};

type ZigLineIndexer = {
  buildLineStarts: (source: string) => Uint32Array;
};

let acceleratorEnabled = false;
let zigLineIndexer: ZigLineIndexer | null = null;
let zigLineIndexerPromise: Promise<void> | null = null;

export function configureAccelerator(config: { enabled: boolean }) {
  acceleratorEnabled = config.enabled;
  if (!config.enabled) {
    zigLineIndexer = null;
    zigLineIndexerPromise = null;
  }
}

export async function warmAccelerator() {
  if (!acceleratorEnabled) {
    return;
  }

  if (zigLineIndexer) {
    return;
  }

  if (!zigLineIndexerPromise) {
    zigLineIndexerPromise = loadZigLineIndexerFromUrl(new URL('../zig/line_indexer.wasm', import.meta.url))
      .then((nextIndexer) => {
        zigLineIndexer = nextIndexer;
      })
      .catch((error) => {
        console.warn('Falling back to the TypeScript line indexer.', error);
      })
      .finally(() => {
        zigLineIndexerPromise = null;
      });
  }

  await zigLineIndexerPromise;
}

export function buildLineStartIndex(source: string) {
  if (acceleratorEnabled && zigLineIndexer) {
    return zigLineIndexer.buildLineStarts(source);
  }

  return buildLineStartIndexFallback(source);
}

export function offsetToPositionWithIndex(lineStarts: Uint32Array, offset: number): SourcePosition {
  const clampedOffset = Math.max(0, offset);
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] ?? 0;
    const nextLineStart = lineStarts[middle + 1];

    if (nextLineStart != null && clampedOffset >= nextLineStart) {
      low = middle + 1;
      continue;
    }

    if (clampedOffset < lineStart) {
      high = middle - 1;
      continue;
    }

    return {
      line: middle + 1,
      column: clampedOffset - lineStart,
      offset: clampedOffset,
    };
  }

  const lastIndex = Math.max(0, lineStarts.length - 1);
  const lineStart = lineStarts[lastIndex] ?? 0;
  return {
    line: lastIndex + 1,
    column: clampedOffset - lineStart,
    offset: clampedOffset,
  };
}

export function buildLineStartIndexFallback(source: string) {
  const starts: number[] = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      starts.push(index + 1);
    }
  }

  return Uint32Array.from(starts);
}

export async function loadZigLineIndexerFromUrl(url: URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load Zig accelerator: ${response.status}`);
  }

  const source = await response.arrayBuffer();
  return loadZigLineIndexerFromBinary(source);
}

export async function loadZigLineIndexerFromBinary(source: ArrayBuffer) {
  const result = await WebAssembly.instantiate(source, {});
  const exports = result.instance.exports as unknown as ZigLineIndexerExports;

  if (!exports.memory || !exports.alloc || !exports.free || !exports.count_line_starts || !exports.fill_line_starts) {
    throw new Error('The Zig accelerator is missing required exports.');
  }

  return {
    buildLineStarts(sourceText: string) {
      const codeUnits = new Uint16Array(sourceText.length);
      for (let index = 0; index < sourceText.length; index += 1) {
        codeUnits[index] = sourceText.charCodeAt(index);
      }

      const sourceSize = codeUnits.byteLength;
      const sourcePointer = exports.alloc(sourceSize);
      if (!sourcePointer) {
        throw new Error('Could not allocate memory for source text.');
      }

      const sourceBytes = new Uint8Array(codeUnits.buffer);
      new Uint8Array(exports.memory.buffer, sourcePointer, sourceBytes.byteLength).set(sourceBytes);

      const lineCount = exports.count_line_starts(sourcePointer, codeUnits.length);
      const outputSize = lineCount * Uint32Array.BYTES_PER_ELEMENT;
      const outputPointer = exports.alloc(outputSize);
      if (!outputPointer) {
        exports.free(sourcePointer, sourceSize);
        throw new Error('Could not allocate memory for line starts.');
      }

      try {
        const written = exports.fill_line_starts(sourcePointer, codeUnits.length, outputPointer, lineCount);
        const view = new Uint32Array(exports.memory.buffer, outputPointer, written);
        return Uint32Array.from(view);
      } finally {
        exports.free(outputPointer, outputSize);
        exports.free(sourcePointer, sourceSize);
      }
    },
  };
}
