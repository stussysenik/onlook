import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, '..');
const sourcePath = resolve(packageDir, 'zig', 'hit_test.zig');
const outputPath = resolve(packageDir, 'zig', 'hit_test.wasm');

await mkdir(dirname(outputPath), { recursive: true });

const check = spawnSync('zig', ['version'], { stdio: 'ignore' });
if (check.status !== 0) {
  console.warn('Skipping Zig WASM build because zig is not installed.');
  process.exit(0);
}

const result = spawnSync(
  'zig',
  [
    'build-exe',
    sourcePath,
    '-target',
    'wasm32-freestanding',
    '-O',
    'ReleaseSmall',
    '-fno-entry',
    '-rdynamic',
    '-femit-bin=' + outputPath,
  ],
  { stdio: 'inherit' },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
