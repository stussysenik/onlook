import { describe, expect, it } from 'vitest';

import { applyEdit, getSampleSource, parseDocument } from './index';

describe('framework engine', () => {
  it('round-trips Svelte text and class edits', () => {
    const document = parseDocument('svelte', getSampleSource('svelte'));
    const sectionId = document.root.children[0]?.id ?? 'root.0';
    const headingId = document.root.children[0]?.children[0]?.id ?? 'root.0.0';

    const withClass = applyEdit(document, {
      type: 'update_styles',
      nodeId: sectionId,
      className: 'hero-card polished',
    });
    const withText = applyEdit(withClass, {
      type: 'update_text',
      nodeId: headingId,
      text: 'Onlook Next Studio',
    });

    expect(withText.source).toContain('class="hero-card polished"');
    expect(withText.source).toContain('Onlook Next Studio');
    expect(withText.source).toContain('{subtitle}');
  });

  it('round-trips React attribute edits', () => {
    const document = parseDocument('react', getSampleSource('react'));
    const sectionId = document.root.children[0]?.id ?? 'root.0';

    const updated = applyEdit(document, {
      type: 'update_attributes',
      nodeId: sectionId,
      attributes: {
        'data-surface': 'canvas',
      },
    });

    expect(updated.source).toContain('data-surface="canvas"');
    expect(updated.source).toContain('section');
  });

  it('inserts a node into the Svelte tree', () => {
    const document = parseDocument('svelte', getSampleSource('svelte'));
    const updated = applyEdit(document, {
      type: 'insert_node',
      parentId: 'root.0',
      node: {
        kind: 'element',
        name: 'small',
        textContent: 'Design with source parity',
      },
    });

    expect(updated.source).toContain('<small>Design with source parity</small>');
  });
});
