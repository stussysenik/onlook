import generate from '@babel/generator';
import { parse as parseJsx } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { parse as parseSvelte } from 'svelte/compiler';

import type {
  EditAction,
  EditorDocument,
  EditorNode,
  FrameworkId,
  NewEditorNode,
  SourcePosition,
  SourceLocation,
} from '@onlook-next/editor-contracts';
import { buildLineStartIndex, configureAccelerator, offsetToPositionWithIndex, warmAccelerator } from './accelerator';

export { configureAccelerator, warmAccelerator };

type FrameworkAdapter = {
  framework: FrameworkId;
  parse: (source: string) => EditorDocument;
  serialize: (document: EditorDocument) => string;
};

type JSXChildNode =
  | t.JSXElement
  | t.JSXFragment
  | t.JSXText
  | t.JSXExpressionContainer
  | t.JSXSpreadChild;

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source']);
const SAMPLES: Record<Exclude<FrameworkId, 'vue'>, string> = {
  svelte: `<script>
  let subtitle = 'Source-aware editing';
</script>

<section class="hero-card">
  <h1>Onlook Next</h1>
  <p>{subtitle}</p>
  <button class="cta">Start designing</button>
</section>

<style>
  .hero-card {
    display: grid;
    gap: 0.75rem;
    padding: 1.5rem;
    border-radius: 1rem;
    background: linear-gradient(135deg, #f5f1e8, #ffffff);
  }

  .cta {
    justify-self: start;
  }
</style>
`,
  react: `export default function HeroCard() {
  return (
    <section className="hero-card">
      <h1>Onlook Next</h1>
      <p>Source-aware editing</p>
      <button className="cta">Start designing</button>
    </section>
  );
}
`,
};

export function getSampleSource(framework: Exclude<FrameworkId, 'vue'>): string {
  return SAMPLES[framework];
}

export function getSupportedFrameworks(): FrameworkId[] {
  return ['svelte', 'react', 'vue'];
}

export function parseDocument(framework: FrameworkId, source: string): EditorDocument {
  return getAdapter(framework).parse(source);
}

export function applyEdit(document: EditorDocument, action: EditAction): EditorDocument {
  const root = cloneNode(document.root);
  executeAction(root, action);
  const normalizedRoot = normalizeNodeIds(root);
  const adapter = getAdapter(document.framework);
  const serialized = adapter.serialize({
    ...document,
    root: normalizedRoot,
  });

  return adapter.parse(serialized);
}

function getAdapter(framework: FrameworkId): FrameworkAdapter {
  switch (framework) {
    case 'svelte':
      return svelteAdapter;
    case 'react':
      return reactAdapter;
    case 'vue':
      return vueAdapter;
    default:
      throw new Error(`Unsupported framework: ${framework satisfies never}`);
  }
}

function executeAction(root: EditorNode, action: EditAction): void {
  switch (action.type) {
    case 'update_text': {
      const node = findNode(root, action.nodeId);
      if (!node) {
        throw new Error(`Node not found: ${action.nodeId}`);
      }

      node.textContent = action.text;
      if (node.kind !== 'text' && node.children.length > 0) {
        const firstTextChild = node.children.find((child) => child.kind === 'text');
        if (firstTextChild) {
          firstTextChild.textContent = action.text;
        } else {
          node.children.unshift(createNode(action.nodeId + '.text', { kind: 'text', name: '#text', textContent: action.text }));
        }
      }
      return;
    }
    case 'update_attributes': {
      const node = findNode(root, action.nodeId);
      if (!node || node.kind === 'text') {
        throw new Error(`Cannot update attributes for node: ${action.nodeId}`);
      }

      for (const [key, value] of Object.entries(action.attributes)) {
        if (value === null || value === '') {
          delete node.attributes[key];
        } else {
          node.attributes[key] = value;
        }
      }
      return;
    }
    case 'update_styles': {
      const node = findNode(root, action.nodeId);
      if (!node || node.kind === 'text') {
        throw new Error(`Cannot update styles for node: ${action.nodeId}`);
      }

      const classKey = node.attributes.className !== undefined ? 'className' : 'class';
      node.attributes[classKey] = action.className;
      return;
    }
    case 'insert_node': {
      const parent = findNode(root, action.parentId);
      if (!parent || parent.kind === 'text') {
        throw new Error(`Cannot insert into node: ${action.parentId}`);
      }

      const child = createNode('', action.node);
      const index = action.index ?? parent.children.length;
      parent.children.splice(Math.max(0, Math.min(index, parent.children.length)), 0, child);
      return;
    }
    case 'move_node': {
      if (action.nodeId === 'root') {
        throw new Error('Cannot move the synthetic root');
      }

      const sourceParent = findParent(root, action.nodeId);
      const targetParent = findNode(root, action.targetParentId);
      if (!sourceParent || !targetParent || targetParent.kind === 'text') {
        throw new Error('Move operation references an unknown node');
      }

      const sourceIndex = sourceParent.children.findIndex((child) => child.id === action.nodeId);
      if (sourceIndex < 0) {
        throw new Error(`Cannot move missing node: ${action.nodeId}`);
      }

      const [node] = sourceParent.children.splice(sourceIndex, 1);
      if (!node) {
        throw new Error(`Cannot move missing node: ${action.nodeId}`);
      }

      const targetIndex = Math.max(0, Math.min(action.index, targetParent.children.length));
      targetParent.children.splice(targetIndex, 0, node);
      return;
    }
    case 'remove_node': {
      if (action.nodeId === 'root') {
        throw new Error('Cannot remove the synthetic root');
      }

      const parent = findParent(root, action.nodeId);
      if (!parent) {
        throw new Error(`Cannot remove missing node: ${action.nodeId}`);
      }

      parent.children = parent.children.filter((child) => child.id !== action.nodeId);
      return;
    }
    default:
      throw new Error(`Unhandled action: ${(action satisfies never) as never}`);
  }
}

function findNode(node: EditorNode, id: string): EditorNode | undefined {
  if (node.id === id) {
    return node;
  }

  for (const child of node.children) {
    const match = findNode(child, id);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function findParent(node: EditorNode, childId: string): EditorNode | undefined {
  if (node.children.some((child) => child.id === childId)) {
    return node;
  }

  for (const child of node.children) {
    const match = findParent(child, childId);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function normalizeNodeIds(root: EditorNode): EditorNode {
  const clone = cloneNode(root);
  assignIds(clone, 'root');
  return clone;
}

function assignIds(node: EditorNode, id: string): void {
  node.id = id;
  node.children.forEach((child, index) => assignIds(child, `${id}.${index}`));
}

function cloneNode(node: EditorNode): EditorNode {
  return {
    ...node,
    attributes: { ...node.attributes },
    children: node.children.map(cloneNode),
  };
}

function createNode(id: string, node: NewEditorNode): EditorNode {
  const children = (node.children ?? []).map((child, index) => createNode(`${id}.${index}`, child));

  if (node.kind !== 'text' && node.textContent && !children.some((child) => child.kind === 'text')) {
    children.unshift({
      id: `${id}.text`,
      kind: 'text',
      name: '#text',
      attributes: {},
      children: [],
      textContent: node.textContent,
    });
  }

  return {
    id,
    kind: node.kind,
    name: node.name,
    attributes: { ...(node.attributes ?? {}) },
    children,
    textContent: node.kind === 'text' ? node.textContent : getTextChildren(children),
  };
}

function createFragmentNode(children: EditorNode[]): EditorNode {
  const root: EditorNode = {
    id: 'root',
    kind: 'fragment',
    name: '#root',
    attributes: {},
    children,
  };
  assignIds(root, 'root');
  return root;
}

function offsetToLocation(lineStarts: Uint32Array, start: number, end: number): SourceLocation {
  return {
    start: offsetToPosition(lineStarts, start),
    end: offsetToPosition(lineStarts, end),
  };
}

function offsetToPosition(lineStarts: Uint32Array, offset: number): SourcePosition {
  return offsetToPositionWithIndex(lineStarts, offset);
}

function getTextChildren(children: EditorNode[]): string | undefined {
  return children.find((child) => child.kind === 'text')?.textContent;
}

function renderSvelteNode(node: EditorNode): string {
  if (node.kind === 'fragment') {
    return node.children.map(renderSvelteNode).join('\n');
  }

  if (node.kind === 'text') {
    return node.textContent ?? '';
  }

  const attrs = Object.entries(node.attributes)
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join('');

  if (node.children.length === 0 && (node.kind === 'component' || VOID_ELEMENTS.has(node.name.toLowerCase()))) {
    return `<${node.name}${attrs} />`;
  }

  const children = node.children.map(renderSvelteNode).join('');
  return `<${node.name}${attrs}>${children}</${node.name}>`;
}

function renderReactNode(node: EditorNode): t.JSXElement | t.JSXFragment | t.JSXText {
  if (node.kind === 'text') {
    return t.jsxText(node.textContent ?? '');
  }

  if (node.kind === 'fragment') {
    return t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), node.children.map(renderReactChild));
  }

  const name = t.jsxIdentifier(node.name);
  const attributes = Object.entries(node.attributes).map(([key, value]) =>
    t.jsxAttribute(t.jsxIdentifier(key), t.stringLiteral(value)),
  );
  const children = node.children.map(renderReactChild);
  const selfClosing = children.length === 0 && (node.kind === 'component' || VOID_ELEMENTS.has(node.name.toLowerCase()));

  return t.jsxElement(
    t.jsxOpeningElement(name, attributes, selfClosing),
    selfClosing ? null : t.jsxClosingElement(name),
    selfClosing ? [] : children,
    selfClosing,
  );
}

function renderReactChild(node: EditorNode): t.JSXElement | t.JSXFragment | t.JSXText {
  return renderReactNode(node);
}

function escapeAttribute(value: string): string {
  return value.replaceAll('"', '&quot;');
}

function svelteChildrenToNodes(source: string, lineStarts: Uint32Array, children: any[], warnings: string[]): EditorNode[] {
  const nodes: EditorNode[] = [];

  for (const child of children) {
    if (child.type === 'Text') {
      if (child.data.trim().length === 0) {
        continue;
      }

      nodes.push({
        id: '',
        kind: 'text',
        name: '#text',
        attributes: {},
        children: [],
        textContent: child.data.trim(),
        sourceLocation: offsetToLocation(lineStarts, child.start, child.end),
      });
      continue;
    }

    if (child.type === 'MustacheTag') {
      nodes.push({
        id: '',
        kind: 'text',
        name: '#text',
        attributes: {},
        children: [],
        textContent: source.slice(child.start, child.end),
        sourceLocation: offsetToLocation(lineStarts, child.start, child.end),
      });
      continue;
    }

    if (child.type === 'Element' || child.type === 'InlineComponent') {
      const attributes: Record<string, string> = {};
      for (const attribute of child.attributes ?? []) {
        if (attribute.type !== 'Attribute') {
          warnings.push(`Unsupported Svelte attribute type: ${attribute.type}`);
          continue;
        }

        if (attribute.value === true) {
          attributes[attribute.name] = 'true';
          continue;
        }

        if (Array.isArray(attribute.value) && attribute.value.every((value: any) => value.type === 'Text')) {
          attributes[attribute.name] = attribute.value.map((value: any) => value.data).join('');
          continue;
        }

        warnings.push(`Unsupported Svelte attribute value on "${child.name}.${attribute.name}"`);
      }

      const parsedChildren = svelteChildrenToNodes(source, lineStarts, child.children ?? [], warnings);

      nodes.push({
        id: '',
        kind: child.type === 'InlineComponent' ? 'component' : 'element',
        name: child.name,
        attributes,
        children: parsedChildren,
        textContent: getTextChildren(parsedChildren),
        sourceLocation: offsetToLocation(lineStarts, child.start, child.end),
      });
      continue;
    }

    warnings.push(`Unsupported Svelte node: ${child.type}`);
    if (typeof child.start === 'number' && typeof child.end === 'number') {
      nodes.push({
        id: '',
        kind: 'text',
        name: '#text',
        attributes: {},
        children: [],
        textContent: source.slice(child.start, child.end),
        sourceLocation: offsetToLocation(lineStarts, child.start, child.end),
      });
    }
  }

  return nodes;
}

const svelteAdapter: FrameworkAdapter = {
  framework: 'svelte',
  parse(source) {
    const ast = parseSvelte(source);
    const warnings: string[] = [];
    const lineStarts = buildLineStartIndex(source);
    const children = svelteChildrenToNodes(source, lineStarts, ast.html.children ?? [], warnings);

    return {
      framework: 'svelte',
      root: createFragmentNode(children),
      source,
      editableRange: { start: ast.html.start ?? 0, end: ast.html.end ?? source.length },
      preservedSource: {
        prefix: source.slice(0, ast.html.start ?? 0),
        suffix: source.slice(ast.html.end ?? source.length),
      },
      warnings,
    };
  },
  serialize(document) {
    const markup = document.root.children.map(renderSvelteNode).join('\n');
    return `${document.preservedSource.prefix}${markup}${document.preservedSource.suffix}`;
  },
};

function jsxNameToString(node: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string {
  if (t.isJSXIdentifier(node)) {
    return node.name;
  }

  if (t.isJSXMemberExpression(node)) {
    return `${jsxNameToString(node.object)}.${jsxNameToString(node.property)}`;
  }

  return `${node.namespace.name}:${node.name.name}`;
}

function jsxNodeToEditorNode(
  source: string,
  lineStarts: Uint32Array,
  node: JSXChildNode,
  warnings: string[],
): EditorNode | null {
  if (t.isJSXSpreadChild(node)) {
    warnings.push('Unsupported JSX spread child');
    return {
      id: '',
      kind: 'text',
      name: '#text',
      attributes: {},
      children: [],
      textContent: `{...${generate(node.expression, { concise: true }).code}}`,
      sourceLocation: node.start != null && node.end != null ? offsetToLocation(lineStarts, node.start, node.end) : undefined,
    };
  }

  if (t.isJSXText(node)) {
    if (node.value.trim().length === 0) {
      return null;
    }

    return {
      id: '',
      kind: 'text',
      name: '#text',
      attributes: {},
      children: [],
      textContent: node.value.replace(/\s+/g, ' ').trim(),
      sourceLocation: node.start != null && node.end != null ? offsetToLocation(lineStarts, node.start, node.end) : undefined,
    };
  }

  if (t.isJSXExpressionContainer(node)) {
    warnings.push('Unsupported JSX expression container; emitted as text placeholder');
    const expressionSource =
      node.expression.type === 'JSXEmptyExpression'
        ? ''
        : generate(node.expression, { concise: true }).code;

    return {
      id: '',
      kind: 'text',
      name: '#text',
      attributes: {},
      children: [],
      textContent: `{${expressionSource}}`,
      sourceLocation: node.start != null && node.end != null ? offsetToLocation(lineStarts, node.start, node.end) : undefined,
    };
  }

  if (t.isJSXFragment(node)) {
    return {
      id: '',
      kind: 'fragment',
      name: '#fragment',
      attributes: {},
      children: node.children
        .map((child) => jsxNodeToEditorNode(source, lineStarts, child, warnings))
        .filter((child): child is EditorNode => child !== null),
      sourceLocation: node.start != null && node.end != null ? offsetToLocation(lineStarts, node.start, node.end) : undefined,
    };
  }

  const attributes: Record<string, string> = {};
  for (const attribute of node.openingElement.attributes) {
    if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name)) {
      warnings.push('Unsupported JSX spread attribute');
      continue;
    }

    if (attribute.value == null) {
      attributes[attribute.name.name] = 'true';
      continue;
    }

    if (t.isStringLiteral(attribute.value)) {
      attributes[attribute.name.name] = attribute.value.value;
      continue;
    }

    warnings.push(`Unsupported JSX attribute expression on "${attribute.name.name}"`);
  }

  const children = node.children
    .map((child) => jsxNodeToEditorNode(source, lineStarts, child, warnings))
    .filter((child): child is EditorNode => child !== null);

  return {
    id: '',
    kind: /^[A-Z]/.test(jsxNameToString(node.openingElement.name)) ? 'component' : 'element',
    name: jsxNameToString(node.openingElement.name),
    attributes,
    children,
    textContent: getTextChildren(children),
    sourceLocation: node.start != null && node.end != null ? offsetToLocation(lineStarts, node.start, node.end) : undefined,
  };
}

const reactAdapter: FrameworkAdapter = {
  framework: 'react',
  parse(source) {
    const ast = parseJsx(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
    const lineStarts = buildLineStartIndex(source);
    const warnings: string[] = [];
    let rootNode: t.JSXElement | t.JSXFragment | null = null;
    let editableRange: { start: number; end: number } | null = null;

    traverse(ast, {
      ReturnStatement(path) {
        if (path.node.argument && (t.isJSXElement(path.node.argument) || t.isJSXFragment(path.node.argument))) {
          rootNode = path.node.argument;
          if (path.node.argument.start != null && path.node.argument.end != null) {
            editableRange = { start: path.node.argument.start, end: path.node.argument.end };
          }
          path.stop();
        }
      },
      ExpressionStatement(path) {
        if (!rootNode && (t.isJSXElement(path.node.expression) || t.isJSXFragment(path.node.expression))) {
          rootNode = path.node.expression;
          if (path.node.expression.start != null && path.node.expression.end != null) {
            editableRange = { start: path.node.expression.start, end: path.node.expression.end };
          }
          path.stop();
        }
      },
    });

    if (!rootNode || !editableRange) {
      throw new Error('Could not find an editable JSX root');
    }

    const range = editableRange as { start: number; end: number };
    const parsedRoot = jsxNodeToEditorNode(source, lineStarts, rootNode, warnings);
    const normalizedRoot =
      parsedRoot?.kind === 'fragment'
        ? createFragmentNode(parsedRoot.children)
        : createFragmentNode(parsedRoot ? [parsedRoot] : []);

    return {
      framework: 'react',
      root: normalizedRoot,
      source,
      editableRange: range,
      preservedSource: {
        prefix: source.slice(0, range.start),
        suffix: source.slice(range.end),
      },
      warnings,
    };
  },
  serialize(document) {
    const jsxRoot =
      document.root.children.length === 1
        ? renderReactNode(document.root.children[0]) as t.JSXElement | t.JSXFragment
        : renderReactNode(document.root) as t.JSXFragment;

    const body = generate(jsxRoot, {
      jsescOption: { minimal: true },
    }).code;

    return `${document.preservedSource.prefix}${body}${document.preservedSource.suffix}`;
  },
};

const vueAdapter: FrameworkAdapter = {
  framework: 'vue',
  parse() {
    throw new Error('Vue support is planned but not implemented in this initial slice.');
  },
  serialize() {
    throw new Error('Vue support is planned but not implemented in this initial slice.');
  },
};
