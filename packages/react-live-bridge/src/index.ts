import fs from 'node:fs/promises';
import path from 'node:path';

import generateModule from '@babel/generator';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import type { ApplyDomEditRequest } from '@onlook-next/editor-contracts';
import type { Connect, Plugin, ViteDevServer } from 'vite';

const APPLY_ROUTE = '/__onlook/apply';
const generate =
  (generateModule as typeof generateModule & { default?: typeof generateModule }).default ??
  generateModule;
const traverse = (traverseModule as typeof traverseModule & { default?: typeof traverseModule }).default ?? traverseModule;

function isJsxModule(id: string) {
  return /\.(jsx|tsx)$/.test(id) && !id.includes('/node_modules/');
}

function isDomElementName(
  name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName,
): name is t.JSXIdentifier {
  return t.isJSXIdentifier(name) && /^[a-z]/.test(name.name);
}

function addStringAttribute(attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[], name: string, value: string) {
  if (attributes.some((attribute) => t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name }))) {
    return;
  }

  attributes.push(t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value)));
}

function decorateJsx(code: string, id: string) {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  let changed = false;

  traverse(ast, {
    JSXOpeningElement(path) {
      if (!isDomElementName(path.node.name) || !path.node.loc) {
        return;
      }

      const start = path.node.loc.start;
      const elementId = `${path.node.name.name}:${start.line}:${start.column}`;

      addStringAttribute(path.node.attributes, 'data-onlook-id', elementId);
      addStringAttribute(path.node.attributes, 'data-onlook-source-file', id);
      addStringAttribute(path.node.attributes, 'data-onlook-source-line', String(start.line));
      addStringAttribute(path.node.attributes, 'data-onlook-source-column', String(start.column));
      changed = true;
    },
  });

  if (!changed) {
    return null;
  }

  return generate(ast, {
    retainLines: true,
    jsescOption: { minimal: true },
  }).code;
}

function readBody(req: Parameters<Connect.NextHandleFunction>[0]) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Uint8Array[] = [];

    req.on('data', (chunk: Uint8Array) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

function setCorsHeaders(res: Parameters<Connect.NextHandleFunction>[1]) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

async function applyDomEdit(payload: ApplyDomEditRequest) {
  const sourcePath = path.resolve(payload.source.file);
  const code = await fs.readFile(sourcePath, 'utf8');
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  let updated = false;

  traverse(ast, {
    JSXElement(path) {
      const openingElement = path.node.openingElement;
      const loc = openingElement.loc?.start;

      if (!loc || !isDomElementName(openingElement.name)) {
        return;
      }

      if (loc.line !== payload.source.line || loc.column !== payload.source.column) {
        return;
      }

      if (payload.action.type === 'update_text') {
        const hasNestedElements = path.node.children.some((child) => t.isJSXElement(child) || t.isJSXFragment(child));
        if (hasNestedElements) {
          throw new Error('Text edits are only supported for direct-text DOM elements.');
        }

        path.node.children = [t.jsxText(payload.action.text)];
      } else {
        const existingAttribute = openingElement.attributes.find(
          (attribute): attribute is t.JSXAttribute =>
            t.isJSXAttribute(attribute) &&
            t.isJSXIdentifier(attribute.name, { name: 'className' }),
        );

        if (existingAttribute) {
          existingAttribute.value = t.stringLiteral(payload.action.className);
        } else {
          openingElement.attributes.push(
            t.jsxAttribute(t.jsxIdentifier('className'), t.stringLiteral(payload.action.className)),
          );
        }
      }

      updated = true;
      path.stop();
    },
  });

  if (!updated) {
    throw new Error('Could not locate the selected JSX element in source.');
  }

  const output = generate(ast, {
    retainLines: true,
    jsescOption: { minimal: true },
  }).code;

  await fs.writeFile(sourcePath, output, 'utf8');
}

export const __internal = {
  applyDomEdit,
  decorateJsx,
};

function createOnlookMiddleware(server: ViteDevServer): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url?.startsWith(APPLY_ROUTE)) {
      next();
      return;
    }

    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      const body = await readBody(req);
      const payload = JSON.parse(body) as ApplyDomEditRequest;
      await applyDomEdit(payload);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));

      server.ws.send({ type: 'full-reload' });
    } catch (error) {
      res.statusCode = 422;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown apply error',
        }),
      );
    }
  };
}

export function onlookReactBridge(): Plugin {
  return {
    name: 'onlook-react-bridge',
    enforce: 'pre',
    transform(code, id) {
      if (!isJsxModule(id)) {
        return null;
      }

      return decorateJsx(code, id);
    },
    configureServer(server) {
      server.middlewares.use(createOnlookMiddleware(server));
    },
  };
}
