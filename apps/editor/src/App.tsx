import { createElement as createReactElement, startTransition, useEffect, useRef, useState } from 'react';

import type { EditorDocument, EditorNode, FrameworkId } from '@onlook-next/editor-contracts';
import { loadFrameworkEngine } from './engine';
import { FileTree } from './FileTree';
import {
  getAdapter,
  inferFrameworkFromPath,
  isDesktop as detectDesktop,
  type Adapter,
  type FileEntry,
  type PreviewBounds,
  type ProjectHandle,
} from './runtime/adapter';
import { EVENTS, subscribe, type PreviewSelection } from './runtime/events';
import { StatusBanner } from './StatusBanner';

const FRAMEWORKS: Array<{ id: FrameworkId; label: string; disabled?: boolean }> = [
  { id: 'svelte', label: 'Svelte' },
  { id: 'react', label: 'React' },
  { id: 'vue', label: 'Vue', disabled: true },
];

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000';
const SAMPLE_SOURCES: Record<'svelte' | 'react', string> = {
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

type BackendProject = {
  id: string;
  name: string;
  framework: string;
  source: string;
};

type BackendSession = {
  id: string;
  project_id: string;
  client_id: string;
  status: string;
};

export default function App() {
  const [framework, setFramework] = useState<FrameworkId>('svelte');
  const [source, setSource] = useState(() => SAMPLE_SOURCES.svelte);
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState('root.0');
  const [parseError, setParseError] = useState<string | null>(null);
  const [backendUrl, setBackendUrl] = useState(BACKEND_URL);
  const [projectName, setProjectName] = useState('Onlook Next Draft');
  const [project, setProject] = useState<BackendProject | null>(null);
  const [session, setSession] = useState<BackendSession | null>(null);
  const [syncStatus, setSyncStatus] = useState('Local only');
  const [insertTag, setInsertTag] = useState('div');
  const [insertText, setInsertText] = useState('New element');
  const [draftText, setDraftText] = useState('');
  const [draftClassName, setDraftClassName] = useState('');
  const [adapter, setAdapter] = useState<Adapter | null>(null);
  const [desktopProject, setDesktopProject] = useState<ProjectHandle | null>(null);
  const [desktopDevUrl, setDesktopDevUrl] = useState<string | null>(null);
  const [desktopBlocked, setDesktopBlocked] = useState(false);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [fileTreeTruncated, setFileTreeTruncated] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const desktopPreviewSlotRef = useRef<HTMLDivElement | null>(null);
  const isDesktopMode = detectDesktop();
  const selectedFileRelative =
    selectedFilePath && desktopProject
      ? relativizeAgainst(desktopProject.root, selectedFilePath)
      : null;

  useEffect(() => {
    void reparseSource(source, framework);
  }, []);

  useEffect(() => {
    // Resolve the adapter once per session. In browser mode this is a cheap
    // synchronous shim; in desktop mode it dynamic-imports `@tauri-apps/api`.
    let cancelled = false;
    void (async () => {
      const next = await getAdapter();
      if (!cancelled) setAdapter(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Preview selection events from the probe script — we do not yet map
    // them to source positions, but surfacing the payload is enough for
    // v1 to prove the round trip is alive.
    if (!isDesktopMode) return;
    const unsubs: Array<Promise<() => void>> = [
      subscribe<PreviewSelection>(EVENTS.previewClick, (payload) => {
        setPreviewSelection(payload);
      }),
    ];
    return () => {
      unsubs.forEach((promise) => promise.then((fn) => fn()).catch(() => undefined));
    };
  }, [isDesktopMode]);

  useEffect(() => {
    // Keep the Rust preview child webview positioned over our slot. The slot
    // is an empty, sized <div> in the preview panel; whenever it resizes we
    // post the new logical-pixel bounds to Rust via the adapter.
    if (!isDesktopMode || !adapter || !desktopDevUrl) return;
    const slot = desktopPreviewSlotRef.current;
    if (!slot) return;

    const report = () => {
      const rect = slot.getBoundingClientRect();
      const bounds: PreviewBounds = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
      void adapter.setPreviewBounds(bounds);
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(slot);
    window.addEventListener('resize', report);
    window.addEventListener('scroll', report, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      window.removeEventListener('scroll', report, true);
    };
  }, [isDesktopMode, adapter, desktopDevUrl]);

  useEffect(() => {
    // First time we see a dev-server URL for the current project, ask Rust to
    // scan the project's files. Re-running the scan on every URL change is
    // wasted work because HMR reloads don't rename files — we only want one
    // scan per `project_open` session.
    if (!isDesktopMode || !adapter || adapter.mode !== 'desktop') return;
    if (!desktopDevUrl) return;
    if (fileEntries.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await adapter.listFiles();
        if (cancelled) return;
        setFileEntries(result.entries);
        setFileTreeTruncated(result.truncated);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to list files';
        setSyncStatus(`Desktop: ${message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDesktopMode, adapter, desktopDevUrl, fileEntries.length]);

  async function handleDesktopOpenProject() {
    if (!adapter || adapter.mode !== 'desktop') return;
    const handle = await adapter.openProject();
    if (!handle) return;
    setDesktopProject(handle);
    setDesktopDevUrl(null);
    setDesktopBlocked(false);
    setFileEntries([]);
    setFileTreeTruncated(false);
    setSelectedFilePath(null);
    try {
      await adapter.startDevServer(handle);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start dev server';
      setSyncStatus(`Desktop: ${message}`);
      setDesktopBlocked(true);
    }
  }

  async function handleSelectFile(path: string, nextFramework: FrameworkId) {
    if (!adapter || adapter.mode !== 'desktop') return;
    try {
      const nextDocument = await adapter.parseFile(path, nextFramework);
      startTransition(() => {
        setDocument(nextDocument);
        setSource(nextDocument.source);
        setFramework(nextFramework);
        setSelectedNodeId(nextDocument.root.children[0]?.id ?? 'root');
        setSelectedFilePath(path);
        setParseError(null);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse file';
      setParseError(message);
      setDocument(null);
      setSelectedFilePath(path);
    }
  }

  async function persistDocumentIfDesktop(nextDocument: EditorDocument) {
    if (!isDesktopMode || !selectedFilePath || !adapter || adapter.mode !== 'desktop') return;
    try {
      await adapter.writeFile(selectedFilePath, nextDocument.source);
      const relative = desktopProject
        ? relativizeAgainst(desktopProject.root, selectedFilePath)
        : selectedFilePath;
      setSyncStatus(`Saved ${relative}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save file';
      setSyncStatus(`Save failed: ${message}`);
    }
  }

  async function handleDesktopDevServerReady(url: string) {
    setDesktopDevUrl(url);
    if (adapter?.mode === 'desktop') {
      try {
        await adapter.attachPreview(url);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to attach preview';
        setSyncStatus(`Desktop: ${message}`);
      }
    }
  }

  async function handleDesktopCloseProject() {
    if (!adapter || adapter.mode !== 'desktop') return;
    await adapter.closeProject();
    setDesktopProject(null);
    setDesktopDevUrl(null);
    setDesktopBlocked(false);
    setPreviewSelection(null);
    setFileEntries([]);
    setFileTreeTruncated(false);
    setSelectedFilePath(null);
  }

  const selectedNode = document ? findNode(document.root, selectedNodeId) : undefined;
  const selectedParent = document && selectedNodeId !== 'root' ? findParent(document.root, selectedNodeId) : undefined;

  useEffect(() => {
    if (!selectedNode) {
      setDraftText('');
      setDraftClassName('');
      return;
    }

    setDraftText(selectedNode.textContent ?? '');
    setDraftClassName(selectedNode.attributes.class ?? selectedNode.attributes.className ?? '');
  }, [selectedNode]);

  async function reparseSource(nextSource: string, nextFramework: FrameworkId) {
    try {
      const engine = await loadFrameworkEngine();
      const nextDocument = engine.parseDocument(nextFramework, nextSource);
      startTransition(() => {
        setDocument(nextDocument);
        setSelectedNodeId(nextDocument.root.children[0]?.id ?? 'root');
        setParseError(null);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      setParseError(message);
      setDocument(null);
    }
  }

  function handleFrameworkChange(nextFramework: FrameworkId) {
    if (nextFramework === 'vue') {
      return;
    }

    const nextSource = SAMPLE_SOURCES[nextFramework];
    setFramework(nextFramework);
    setSource(nextSource);
    setProject(null);
    setSession(null);
    setSyncStatus('Local only');
    void reparseSource(nextSource, nextFramework);
  }

  function updateDocument(nextDocument: EditorDocument) {
    setDocument(nextDocument);
    setSource(nextDocument.source);
    if (!findNode(nextDocument.root, selectedNodeId)) {
      setSelectedNodeId(nextDocument.root.children[0]?.id ?? 'root');
    }
  }

  async function applyNodeEdit() {
    if (!document || !selectedNode || selectedNode.id === 'root') {
      return;
    }

    // Route through the adapter so desktop mode can forward edits to the
    // sidecar later, once a file-tree selection makes this meaningful. In
    // browser mode the adapter's `emitEdit` just delegates to the in-process
    // `framework-engine`, so behavior is unchanged.
    const ed = await getAdapter();
    let nextDocument = document;
    if (draftText !== selectedNode.textContent && (selectedNode.kind === 'text' || selectedNode.children.some((child) => child.kind === 'text'))) {
      nextDocument = await ed.emitEdit(nextDocument, {
        type: 'update_text',
        nodeId: selectedNode.id,
        text: draftText,
      });
    }

    if (draftClassName !== (selectedNode.attributes.class ?? selectedNode.attributes.className ?? '')) {
      nextDocument = await ed.emitEdit(nextDocument, {
        type: 'update_styles',
        nodeId: selectedNode.id,
        className: draftClassName,
      });
    }

    updateDocument(nextDocument);
    await persistDocumentIfDesktop(nextDocument);
  }

  async function insertChildNode() {
    if (!document || !selectedNode || selectedNode.kind === 'text') {
      return;
    }

    const ed = await getAdapter();
    const nextDocument = await ed.emitEdit(document, {
      type: 'insert_node',
      parentId: selectedNode.id,
      node: {
        kind: /^[A-Z]/.test(insertTag) ? 'component' : 'element',
        name: insertTag,
        textContent: insertText,
      },
    });

    updateDocument(nextDocument);
    await persistDocumentIfDesktop(nextDocument);
  }

  async function removeSelectedNode() {
    if (!document || !selectedNode || selectedNode.id === 'root') {
      return;
    }

    const fallbackSelection = selectedParent?.id ?? 'root';
    const ed = await getAdapter();
    const nextDocument = await ed.emitEdit(document, {
      type: 'remove_node',
      nodeId: selectedNode.id,
    });

    updateDocument(nextDocument);
    setSelectedNodeId(fallbackSelection);
    await persistDocumentIfDesktop(nextDocument);
  }

  async function moveSelectedNode(direction: -1 | 1) {
    if (!document || !selectedNode || !selectedParent) {
      return;
    }

    const currentIndex = selectedParent.children.findIndex((child) => child.id === selectedNode.id);
    if (currentIndex < 0) {
      return;
    }

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= selectedParent.children.length) {
      return;
    }

    const ed = await getAdapter();
    const nextDocument = await ed.emitEdit(document, {
      type: 'move_node',
      nodeId: selectedNode.id,
      targetParentId: selectedParent.id,
      index: targetIndex,
    });

    updateDocument(nextDocument);
    await persistDocumentIfDesktop(nextDocument);
  }

  async function createBackendProject() {
    if (!document) {
      return;
    }

    setSyncStatus('Creating backend project...');

    try {
      const projectResponse = await fetch(`${backendUrl}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: {
            name: projectName,
            framework,
            source: document.source,
          },
        }),
      });
      if (!projectResponse.ok) {
        throw new Error(`Project creation failed with ${projectResponse.status}`);
      }
      const projectPayload = await projectResponse.json();
      const createdProject = projectPayload.data as BackendProject;

      const sessionResponse = await fetch(`${backendUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session: {
            project_id: createdProject.id,
            client_id: 'editor-ui',
          },
        }),
      });
      if (!sessionResponse.ok) {
        throw new Error(`Session creation failed with ${sessionResponse.status}`);
      }
      const sessionPayload = await sessionResponse.json();
      setProject(createdProject);
      setSession(sessionPayload.data as BackendSession);
      setSyncStatus(`Connected to project ${createdProject.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown backend error';
      setSyncStatus(`Sync failed: ${message}`);
    }
  }

  async function saveProjectSource() {
    if (!document || !project) {
      return;
    }

    setSyncStatus('Saving source...');

    try {
      const response = await fetch(`${backendUrl}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: {
            name: project.name,
            framework,
            source: document.source,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Project save failed with ${response.status}`);
      }
      const payload = await response.json();
      setProject(payload.data as BackendProject);
      setSyncStatus(`Saved ${payload.data.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown backend error';
      setSyncStatus(`Save failed: ${message}`);
    }
  }

  return (
    <div className="shell">
      {isDesktopMode ? (
        <StatusBanner onReady={(url) => void handleDesktopDevServerReady(url)} onBlocked={setDesktopBlocked} />
      ) : null}
      <header className="topbar">
        <div>
          <p className="eyebrow">Onlook Next{isDesktopMode ? ' · Desktop' : ''}</p>
          <h1>
            {isDesktopMode && desktopProject
              ? desktopProject.name
              : 'Multi-framework visual editing core'}
          </h1>
        </div>
        <div className="controls">
          {isDesktopMode ? (
            desktopProject ? (
              <button
                className="pill pill-active"
                onClick={() => void handleDesktopCloseProject()}
                type="button"
              >
                Close project
              </button>
            ) : (
              <button
                className="pill pill-active"
                onClick={() => void handleDesktopOpenProject()}
                type="button"
              >
                Open folder…
              </button>
            )
          ) : (
            FRAMEWORKS.map((option) => (
              <button
                key={option.id}
                className={framework === option.id ? 'pill pill-active' : 'pill'}
                disabled={option.disabled}
                onClick={() => handleFrameworkChange(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      </header>

      <main className="grid">
        {isDesktopMode ? (
          <section className="panel source-panel">
            <div className="panel-header">
              <div>
                <h2>Files</h2>
                <p>
                  {desktopProject
                    ? 'Click a .svelte / .jsx / .tsx file to load it.'
                    : 'Open a project folder to browse its source files.'}
                </p>
              </div>
              {selectedFileRelative ? (
                <span className="file-path-indicator" title={selectedFilePath ?? undefined}>
                  {selectedFileRelative}
                </span>
              ) : null}
            </div>
            {desktopProject ? (
              <FileTree
                entries={fileEntries}
                truncated={fileTreeTruncated}
                selectedFilePath={selectedFilePath}
                onSelect={(path, nextFramework) => void handleSelectFile(path, nextFramework)}
              />
            ) : (
              <p className="empty-state">No project loaded.</p>
            )}
            {selectedFilePath ? (
              <textarea
                className="source-editor"
                onChange={() => undefined}
                spellCheck={false}
                value={source}
                readOnly
                aria-label="Read-only source of the selected file"
              />
            ) : null}
            {parseError ? <p className="error-text">{parseError}</p> : null}
            {document?.warnings.length ? (
              <div className="warning-box">
                <strong>Adapter warnings</strong>
                <ul>
                  {document.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="panel source-panel">
            <div className="panel-header">
              <div>
                <h2>Source</h2>
                <p>Editable source stays in sync with document actions.</p>
              </div>
              <button className="secondary-button" onClick={() => void reparseSource(source, framework)} type="button">
                Reload document
              </button>
            </div>
            <textarea className="source-editor" onChange={(event) => setSource(event.target.value)} spellCheck={false} value={source} />
            {parseError ? <p className="error-text">{parseError}</p> : null}
            {document?.warnings.length ? (
              <div className="warning-box">
                <strong>Adapter warnings</strong>
                <ul>
                  {document.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}

        <section className="panel tree-panel">
          <div className="panel-header">
            <div>
              <h2>Structure</h2>
              <p>Framework-neutral IR derived from the source.</p>
            </div>
          </div>
          {document ? (
            <NodeTree node={document.root} selectedNodeId={selectedNodeId} setSelectedNodeId={setSelectedNodeId} />
          ) : (
            <p className="empty-state">Reload the source to inspect its tree.</p>
          )}
        </section>

        <section className="panel preview-panel">
          <div className="panel-header">
            <div>
              <h2>Preview</h2>
              <p>
                {isDesktopMode
                  ? desktopDevUrl
                    ? 'Live dev-server preview. Click any element to inspect it.'
                    : 'Open a project folder to load a live preview.'
                  : 'Selection in the preview maps back to the source-aware document.'}
              </p>
            </div>
          </div>
          {isDesktopMode ? (
            <div
              className="preview-surface desktop-preview-slot"
              data-desktop-preview-slot
              ref={desktopPreviewSlotRef}
              aria-label="Dev-server preview"
            >
              {desktopDevUrl ? (
                <p className="empty-state" style={{ opacity: 0.4 }}>
                  Preview attached · {desktopDevUrl}
                </p>
              ) : (
                <p className="empty-state">
                  {desktopProject ? 'Waiting for dev server…' : 'No project loaded.'}
                </p>
              )}
            </div>
          ) : (
            <div className="preview-surface">
              {document ? (
                document.root.children.map((node) => (
                  <PreviewNode key={node.id} node={node} selectedNodeId={selectedNodeId} setSelectedNodeId={setSelectedNodeId} />
                ))
              ) : (
                <p className="empty-state">No parsed document available.</p>
              )}
            </div>
          )}
          {isDesktopMode && previewSelection ? (
            <div className="preview-selection-meta">
              <strong>Selected in preview:</strong>
              <code>{previewSelection.path || previewSelection.tag}</code>
              {previewSelection.text ? <span className="preview-selection-text">{previewSelection.text}</span> : null}
            </div>
          ) : null}
        </section>

        <section className="panel inspector-panel">
          <div className="panel-header">
            <div>
              <h2>Inspector</h2>
              <p>Apply text, class, move, insert, and persistence actions.</p>
            </div>
          </div>
          {selectedNode ? (
            <div className="inspector-stack">
              <div className="meta-box">
                <p>
                  <strong>Selected:</strong> {selectedNode.name}
                </p>
                <p>
                  <strong>Node ID:</strong> {selectedNode.id}
                </p>
                <p>
                  <strong>Kind:</strong> {selectedNode.kind}
                </p>
              </div>

              <label className="field">
                <span>Text</span>
                <input onChange={(event) => setDraftText(event.target.value)} value={draftText} />
              </label>

              <label className="field">
                <span>Class / className</span>
                <input onChange={(event) => setDraftClassName(event.target.value)} value={draftClassName} />
              </label>

              <div className="button-row">
                <button className="primary-button" onClick={() => void applyNodeEdit()} type="button">
                  Apply node edits
                </button>
                <button className="secondary-button" onClick={() => void moveSelectedNode(-1)} type="button">
                  Move up
                </button>
                <button className="secondary-button" onClick={() => void moveSelectedNode(1)} type="button">
                  Move down
                </button>
                <button className="danger-button" onClick={() => void removeSelectedNode()} type="button">
                  Remove
                </button>
              </div>

              <label className="field">
                <span>Insert child tag</span>
                <input onChange={(event) => setInsertTag(event.target.value)} value={insertTag} />
              </label>

              <label className="field">
                <span>Insert child text</span>
                <input onChange={(event) => setInsertText(event.target.value)} value={insertText} />
              </label>

              <button className="primary-button" onClick={() => void insertChildNode()} type="button">
                Insert child
              </button>

              <div className="backend-box">
                <h3>Phoenix backend</h3>
                <label className="field">
                  <span>Backend URL</span>
                  <input onChange={(event) => setBackendUrl(event.target.value)} value={backendUrl} />
                </label>
                <label className="field">
                  <span>Project name</span>
                  <input onChange={(event) => setProjectName(event.target.value)} value={projectName} />
                </label>
                <div className="button-row">
                  <button className="primary-button" onClick={createBackendProject} type="button">
                    Create project + session
                  </button>
                  <button className="secondary-button" disabled={!project} onClick={saveProjectSource} type="button">
                    Save source
                  </button>
                </div>
                <p className="status-line">{syncStatus}</p>
                {project ? <p className="status-line">Project: {project.id}</p> : null}
                {session ? <p className="status-line">Session: {session.id}</p> : null}
              </div>
            </div>
          ) : (
            <p className="empty-state">Select a node in the tree or preview.</p>
          )}
        </section>
      </main>
    </div>
  );
}

function NodeTree({
  node,
  selectedNodeId,
  setSelectedNodeId,
}: {
  node: EditorNode;
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
}) {
  return (
    <ul className="node-list">
      <li>
        <button
          className={node.id === selectedNodeId ? 'tree-node tree-node-active' : 'tree-node'}
          onClick={() => setSelectedNodeId(node.id)}
          type="button"
        >
          <span>{node.name}</span>
          <small>{node.kind}</small>
        </button>
        {node.children.length ? (
          <div className="node-children">
            {node.children.map((child) => (
              <NodeTree key={child.id} node={child} selectedNodeId={selectedNodeId} setSelectedNodeId={setSelectedNodeId} />
            ))}
          </div>
        ) : null}
      </li>
    </ul>
  );
}

function PreviewNode({
  node,
  selectedNodeId,
  setSelectedNodeId,
}: {
  node: EditorNode;
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
}) {
  const className =
    node.id === selectedNodeId ? 'preview-node preview-node-active' : 'preview-node';

  if (node.kind === 'text') {
    return (
      <span
        className={className}
        onClick={(event) => { event.stopPropagation(); setSelectedNodeId(node.id); }}
        onKeyDown={(event) => handleSelectableKeyDown(event, node.id, setSelectedNodeId)}
        role="button"
        tabIndex={0}
      >
        {node.textContent}
      </span>
    );
  }

  const childContent = node.children.map((child) => (
    <PreviewNode key={child.id} node={child} selectedNodeId={selectedNodeId} setSelectedNodeId={setSelectedNodeId} />
  ));

  if (node.kind === 'component') {
    return (
      <div
        className={`${className} preview-component`}
        onClick={(event) => { event.stopPropagation(); setSelectedNodeId(node.id); }}
        onKeyDown={(event) => handleSelectableKeyDown(event, node.id, setSelectedNodeId)}
        role="button"
        tabIndex={0}
      >
        <span className="component-chip">{node.name}</span>
        <div>{childContent}</div>
      </div>
    );
  }

  const previewProps: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.attributes)) {
    if (key === 'class') {
      previewProps.className = `${value} ${className}`;
    } else if (key === 'className') {
      previewProps.className = `${value} ${className}`;
    } else if (key.startsWith('data-') || key === 'href' || key === 'src' || key === 'alt' || key === 'title') {
      previewProps[key] = value;
    }
  }

  if (!previewProps.className) {
    previewProps.className = className;
  }

  const tagName = /^[a-z][a-z0-9-]*$/.test(node.name) ? node.name : 'div';

  return (
    <div
      className="preview-hitbox"
      onClick={(event) => { event.stopPropagation(); setSelectedNodeId(node.id); }}
      onKeyDown={(event) => handleSelectableKeyDown(event, node.id, setSelectedNodeId)}
      role="button"
      tabIndex={0}
    >
      {tagName === 'img'
        ? <img {...previewProps} alt={node.attributes.alt ?? 'Preview asset'} />
        : renderHtmlElement(tagName, previewProps, childContent)}
    </div>
  );
}

function renderHtmlElement(tagName: string, props: Record<string, string>, children: React.ReactNode[]) {
  return createReactElement(tagName, props, ...children);
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

function findParent(node: EditorNode, id: string): EditorNode | undefined {
  if (node.children.some((child) => child.id === id)) {
    return node;
  }

  for (const child of node.children) {
    const match = findParent(child, id);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function handleSelectableKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  nodeId: string,
  setSelectedNodeId: (id: string) => void,
) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setSelectedNodeId(nodeId);
}

function relativizeAgainst(root: string, absolute: string): string {
  // Lightweight relative-path helper. The Rust scan already returns a
  // `relative` field for tree entries, but the file-path indicator needs to
  // relativize the `selectedFilePath` separately because it is stored as an
  // absolute path (which is also what `writeFile` needs).
  if (!absolute.startsWith(root)) return absolute;
  const rest = absolute.slice(root.length);
  return rest.startsWith('/') ? rest.slice(1) : rest;
}
