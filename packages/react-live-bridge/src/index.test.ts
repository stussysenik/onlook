import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { __internal } from './index';

describe('react live bridge', () => {
  it('injects source metadata into DOM JSX elements', async () => {
    const source = `export function Example() { return <section><h1>Hello</h1></section>; }`;
    const transformed = __internal.decorateJsx(source, '/tmp/Example.tsx');

    expect(typeof transformed).toBe('string');
    expect(transformed).toContain('data-onlook-id');
    expect(transformed).toContain('data-onlook-source-file');
  });

  it('writes text edits through the dev middleware', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'onlook-bridge-'));
    const sourcePath = path.join(tempDir, 'Example.tsx');
    await fs.writeFile(
      sourcePath,
      `export function Example() {\n  return <h1>Hello</h1>;\n}\n`,
      'utf8',
    );

    await __internal.applyDomEdit({
      source: {
        file: sourcePath,
        line: 2,
        column: 9,
      },
      action: {
        type: 'update_text',
        text: 'Holy Grail',
      },
    });

    const updated = await fs.readFile(sourcePath, 'utf8');
    expect(updated).toContain('Holy Grail');
  });
});
