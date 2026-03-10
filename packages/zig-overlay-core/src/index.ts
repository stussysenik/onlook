export type OverlayRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type OverlayCoreExports = {
  memory: WebAssembly.Memory;
  alloc: (size: number) => number;
  free: (pointer: number, size: number) => void;
  pick_target: (rectPointer: number, rectCount: number, x: number, y: number) => number;
};

type OverlayCore = {
  pickTarget: (rects: OverlayRect[], x: number, y: number) => number;
};

let overlayCore: OverlayCore | null = null;
let overlayCorePromise: Promise<void> | null = null;

export async function ensureOverlayCoreReady() {
  if (overlayCore) {
    return;
  }

  if (!overlayCorePromise) {
    overlayCorePromise = loadOverlayCoreFromUrl(new URL('../zig/hit_test.wasm', import.meta.url))
      .then((nextCore) => {
        overlayCore = nextCore;
      })
      .catch((error) => {
        console.warn('Falling back to the JavaScript overlay core.', error);
      })
      .finally(() => {
        overlayCorePromise = null;
      });
  }

  await overlayCorePromise;
}

export function pickTargetIndex(rects: OverlayRect[], x: number, y: number) {
  if (overlayCore) {
    return overlayCore.pickTarget(rects, x, y);
  }

  return pickTargetIndexFallback(rects, x, y);
}

export function pickTargetIndexFallback(rects: OverlayRect[], x: number, y: number) {
  let bestIndex = -1;
  let bestArea = Number.POSITIVE_INFINITY;

  rects.forEach((rect, index) => {
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      const area = rect.width * rect.height;
      if (area <= bestArea) {
        bestArea = area;
        bestIndex = index;
      }
    }
  });

  return bestIndex;
}

export async function loadOverlayCoreFromUrl(url: URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load Zig overlay core: ${response.status}`);
  }

  const source = await response.arrayBuffer();
  return loadOverlayCoreFromBinary(source);
}

export async function loadOverlayCoreFromBinary(source: ArrayBuffer) {
  const result = await WebAssembly.instantiate(source, {});
  const exports = result.instance.exports as unknown as OverlayCoreExports;

  if (!exports.memory || !exports.alloc || !exports.free || !exports.pick_target) {
    throw new Error('The Zig overlay core is missing required exports.');
  }

  return {
    pickTarget(rects: OverlayRect[], x: number, y: number) {
      const flatRects = new Float32Array(rects.length * 4);
      rects.forEach((rect, index) => {
        const base = index * 4;
        flatRects[base] = rect.x;
        flatRects[base + 1] = rect.y;
        flatRects[base + 2] = rect.width;
        flatRects[base + 3] = rect.height;
      });

      const byteLength = flatRects.byteLength;
      const rectPointer = exports.alloc(byteLength);
      if (!rectPointer) {
        throw new Error('Could not allocate memory for overlay rectangles.');
      }

      try {
        new Uint8Array(exports.memory.buffer, rectPointer, byteLength).set(new Uint8Array(flatRects.buffer));
        return exports.pick_target(rectPointer, rects.length, x, y);
      } finally {
        exports.free(rectPointer, byteLength);
      }
    },
  };
}
