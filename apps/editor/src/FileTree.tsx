/**
 * File tree panel — desktop-mode only.
 *
 * Renders the flat entry list returned by `adapter.listFiles()` as a nested
 * tree, sorted directory-first by the Rust side. The component is purely
 * presentational: selection state lives in `App.tsx` so other panels can read
 * the active file without prop-drilling a context.
 *
 * v1 intentionally has no collapse/expand state, no search, and no context
 * menu — this is the minimum surface that lets the user click a source file
 * and see it in the inspector. Everything else is a deliberate follow-up.
 */

import type { FrameworkId } from '@onlook-next/editor-contracts';
import { inferFrameworkFromPath, type FileEntry } from './runtime/adapter';

type TreeNode = {
  name: string;
  path: string;
  relative: string;
  kind: 'file' | 'dir';
  editable: boolean;
  children: TreeNode[];
};

type FileTreeProps = {
  entries: FileEntry[];
  truncated: boolean;
  selectedFilePath: string | null;
  onSelect: (path: string, framework: FrameworkId) => void;
};

export function FileTree({ entries, truncated, selectedFilePath, onSelect }: FileTreeProps) {
  const roots = buildTree(entries);

  if (entries.length === 0) {
    return <p className="empty-state">No files found in this project.</p>;
  }

  return (
    <div className="file-tree" role="tree">
      {truncated ? (
        <div className="warning-box file-tree-warning">
          <strong>Scan truncated</strong>
          <p>File tree capped at 10,000 entries. Hidden entries are not editable from the tree.</p>
        </div>
      ) : null}
      {roots.map((node) => (
        <FileTreeNode
          key={node.path || node.name}
          node={node}
          depth={0}
          selectedFilePath={selectedFilePath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function FileTreeNode({
  node,
  depth,
  selectedFilePath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedFilePath: string | null;
  onSelect: (path: string, framework: FrameworkId) => void;
}) {
  const isActive = node.kind === 'file' && node.path === selectedFilePath;
  const isEditable = node.kind === 'file' && node.editable;
  const framework = isEditable ? inferFrameworkFromPath(node.path) : null;

  if (node.kind === 'dir') {
    return (
      <div className="file-tree-dir" role="treeitem" aria-expanded>
        <div
          className="file-tree-entry file-tree-entry-dir"
          style={{ paddingInlineStart: `${depth * 14 + 8}px` }}
        >
          <span className="file-tree-chevron" aria-hidden>
            ▾
          </span>
          <span className="file-tree-label">{node.name || '/'}</span>
        </div>
        {node.children.map((child) => (
          <FileTreeNode
            key={child.path || child.name}
            node={child}
            depth={depth + 1}
            selectedFilePath={selectedFilePath}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  const className = [
    'file-tree-entry',
    'file-tree-entry-file',
    isEditable ? 'file-tree-entry-editable' : 'file-tree-entry-disabled',
    isActive ? 'file-tree-entry-active' : null,
  ]
    .filter(Boolean)
    .join(' ');

  if (!isEditable || !framework) {
    return (
      <div
        className={className}
        style={{ paddingInlineStart: `${depth * 14 + 22}px` }}
        title="This file type is not editable"
        aria-disabled
      >
        <span className="file-tree-label">{node.name}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      style={{ paddingInlineStart: `${depth * 14 + 22}px` }}
      onClick={() => onSelect(node.path, framework)}
      aria-selected={isActive}
      role="treeitem"
    >
      <span className="file-tree-label">{node.name}</span>
    </button>
  );
}

/**
 * Build a nested tree from the flat entry list. The Rust scan already emits
 * entries in a stable order (directories before files at each depth,
 * alphabetic within), so a single pass that indexes by `relative` path is
 * enough — no re-sorting needed here.
 */
function buildTree(entries: FileEntry[]): TreeNode[] {
  const byRelative = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const entry of entries) {
    const node: TreeNode = {
      name: baseName(entry.relative),
      path: entry.path,
      relative: entry.relative,
      kind: entry.kind,
      editable: entry.editable,
      children: [],
    };
    byRelative.set(entry.relative, node);

    const parentRelative = dirName(entry.relative);
    if (!parentRelative) {
      roots.push(node);
      continue;
    }
    const parent = byRelative.get(parentRelative);
    if (parent) {
      parent.children.push(node);
    } else {
      // Defensive: if the scan ever returns a child without its parent (it
      // shouldn't — the walk emits parents first), fall back to the root so
      // the entry is still visible to the user.
      roots.push(node);
    }
  }

  return roots;
}

function baseName(relative: string): string {
  const idx = relative.lastIndexOf('/');
  return idx < 0 ? relative : relative.slice(idx + 1);
}

function dirName(relative: string): string {
  const idx = relative.lastIndexOf('/');
  return idx < 0 ? '' : relative.slice(0, idx);
}
