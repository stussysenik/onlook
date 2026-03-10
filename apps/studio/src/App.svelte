<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import type {
    ApplyDomEditRequest,
    BridgeElementSnapshot,
    BridgeSnapshotMessage,
  } from '@onlook-next/editor-contracts';
  import { ensureOverlayCoreReady, pickTargetIndex } from '@onlook-next/zig-overlay-core';

  let targetUrl = 'http://localhost:5180';
  let activeUrl = targetUrl;
  let iframeElement: HTMLIFrameElement | null = null;
  let overlayElement: HTMLDivElement | null = null;
  let elements: BridgeElementSnapshot[] = [];
  let selectedId: string | null = null;
  let hoverId: string | null = null;
  let draftText = '';
  let draftClassName = '';
  let status = 'Attach a running React app to begin.';
  let applyStatus = 'No pending edits.';

  $: selectedElement = elements.find((element) => element.id === selectedId) ?? null;
  $: if (selectedElement) {
    draftText = selectedElement.text;
    draftClassName = selectedElement.className;
  }

  function connect() {
    activeUrl = targetUrl;
    status = `Connecting to ${activeUrl}`;
    requestSnapshot();
  }

  function requestSnapshot() {
    iframeElement?.contentWindow?.postMessage({ type: 'onlook:request-snapshot' }, '*');
  }

  function handleMessage(event: MessageEvent<BridgeSnapshotMessage>) {
    if (event.data?.type !== 'onlook:snapshot') {
      return;
    }

    if (iframeElement?.contentWindow !== event.source) {
      return;
    }

    elements = event.data.elements;
    if (selectedId && !elements.some((element) => element.id === selectedId)) {
      selectedId = null;
    }

    status = `${elements.length} live elements synced from the React app.`;
    if (applyStatus === 'Source updated. Waiting for host snapshot...') {
      applyStatus = 'Source and canvas synced.';
    }
  }

  function pointerToFramePosition(event: MouseEvent | PointerEvent) {
    if (!overlayElement) {
      return null;
    }

    const bounds = overlayElement.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  }

  function handleOverlayMove(event: PointerEvent) {
    const point = pointerToFramePosition(event);
    if (!point) {
      return;
    }

    const hitIndex = pickTargetIndex(
      elements.map((element) => element.rect),
      point.x,
      point.y,
    );

    hoverId = hitIndex >= 0 ? elements[hitIndex]?.id ?? null : null;
  }

  function handleOverlayLeave() {
    hoverId = null;
  }

  function handleOverlayClick(event: MouseEvent) {
    const point = pointerToFramePosition(event);
    if (!point) {
      return;
    }

    const hitIndex = pickTargetIndex(
      elements.map((element) => element.rect),
      point.x,
      point.y,
    );

    selectedId = hitIndex >= 0 ? elements[hitIndex]?.id ?? null : null;
    applyStatus = selectedId ? 'Element selected. Ready to write source.' : 'No element selected.';
  }

  async function sendEdit(payload: ApplyDomEditRequest) {
    if (!selectedElement) {
      return;
    }

    const origin = new URL(activeUrl).origin;
    applyStatus = 'Writing to source...';

    const response = await fetch(`${origin}/__onlook/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `Request failed with ${response.status}` }));
      applyStatus = `Write failed: ${error.error ?? response.status}`;
      return;
    }

    applyStatus = 'Source updated. Waiting for host snapshot...';
    requestSnapshot();
  }

  async function applyTextEdit() {
    if (!selectedElement) {
      return;
    }

    await sendEdit({
      source: selectedElement.source,
      action: {
        type: 'update_text',
        text: draftText,
      },
    });
  }

  async function applyClassEdit() {
    if (!selectedElement) {
      return;
    }

    await sendEdit({
      source: selectedElement.source,
      action: {
        type: 'update_class',
        className: draftClassName,
      },
    });
  }

  onMount(() => {
    void ensureOverlayCoreReady();
    window.addEventListener('message', handleMessage as EventListener);
  });

  onDestroy(() => {
    window.removeEventListener('message', handleMessage as EventListener);
  });
</script>

<svelte:head>
  <title>Onlook Studio</title>
</svelte:head>

<div class="studio-shell">
  <aside class="command-bar">
    <p class="eyebrow">Onlook Studio</p>
    <h1>Live React editing, not a synthetic preview</h1>
    <p class="lede">
      This shell attaches to a running React app, pulls live DOM geometry over the bridge, and
      writes edits straight back to source files.
    </p>

    <div class="attach-card">
      <label>
        <span>Target app URL</span>
        <input bind:value={targetUrl} />
      </label>
      <button class="primary" on:click={connect} type="button">Attach live app</button>
      <p>{status}</p>
    </div>

    <div class="inspector-card">
      <p class="card-kicker">Selection</p>
      {#if selectedElement}
        <h2>{selectedElement.tag}</h2>
        <p class="meta">{selectedElement.source.file}:{selectedElement.source.line}</p>

        <label>
          <span>Text</span>
          <textarea bind:value={draftText} disabled={!selectedElement.canEditText} rows="4"></textarea>
        </label>
        <button
          class="secondary"
          disabled={!selectedElement.canEditText}
          on:click={applyTextEdit}
          type="button"
        >
          Write text to source
        </button>

        <label>
          <span>Class name</span>
          <input bind:value={draftClassName} />
        </label>
        <button
          class="secondary"
          on:click={applyClassEdit}
          type="button"
        >
          Write class to source
        </button>
      {:else}
        <h2>No live selection</h2>
        <p>Hover or click the live canvas to select a real DOM node from the running React app.</p>
      {/if}

      <p class="status">{applyStatus}</p>
    </div>
  </aside>

  <main class="canvas-shell">
    <div class="canvas-header">
      <div>
        <p class="eyebrow">Local-first editor</p>
        <h2>Attached live surface</h2>
      </div>
      <button class="ghost" on:click={requestSnapshot} type="button">Refresh bridge snapshot</button>
    </div>

    <div class="canvas-frame">
      <iframe bind:this={iframeElement} src={activeUrl} title="Attached React app"></iframe>
      <div
        bind:this={overlayElement}
        class="overlay"
        on:pointermove={handleOverlayMove}
        on:pointerleave={handleOverlayLeave}
        on:click={handleOverlayClick}
        role="presentation"
      >
        {#each elements as element (element.id)}
          <div
            class:selected={element.id === selectedId}
            class:hovered={element.id === hoverId}
            class="overlay-box"
            style={`left:${element.rect.x}px;top:${element.rect.y}px;width:${element.rect.width}px;height:${element.rect.height}px;`}
          >
            {#if element.id === selectedId || element.id === hoverId}
              <span>{element.tag}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </main>
</div>

<style>
  .studio-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 360px minmax(0, 1fr);
  }

  .command-bar {
    padding: 1.6rem;
    background: rgba(13, 26, 23, 0.96);
    color: #f7f2eb;
    display: grid;
    align-content: start;
    gap: 1rem;
  }

  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.74rem;
    color: rgba(247, 242, 235, 0.6);
  }

  h1,
  h2 {
    margin: 0;
    font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
  }

  .lede,
  .meta,
  .status,
  .attach-card p {
    margin: 0;
    color: rgba(247, 242, 235, 0.74);
  }

  .attach-card,
  .inspector-card {
    border-radius: 1.2rem;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.08);
    display: grid;
    gap: 0.75rem;
  }

  .card-kicker {
    margin: 0;
    color: #9fe1d6;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }

  label {
    display: grid;
    gap: 0.3rem;
  }

  input,
  textarea {
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 0.9rem;
    background: rgba(247, 242, 235, 0.1);
    color: inherit;
    padding: 0.75rem 0.85rem;
  }

  button {
    cursor: pointer;
    border: 0;
    border-radius: 999px;
    padding: 0.8rem 1rem;
  }

  .primary {
    background: #ef8f37;
    color: #10221d;
    font-weight: 700;
  }

  .secondary,
  .ghost {
    background: rgba(16, 34, 29, 0.08);
    color: inherit;
  }

  .canvas-shell {
    padding: 1.6rem;
  }

  .canvas-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 1rem;
  }

  .canvas-frame {
    position: relative;
    min-height: calc(100vh - 5rem);
    border-radius: 1.4rem;
    overflow: hidden;
    border: 1px solid rgba(16, 34, 29, 0.12);
    background: rgba(255, 255, 255, 0.66);
    box-shadow: 0 24px 60px rgba(16, 34, 29, 0.12);
  }

  iframe {
    width: 100%;
    height: calc(100vh - 5rem);
    border: 0;
    display: block;
    background: white;
  }

  .overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
  }

  .overlay-box {
    position: absolute;
    border: 1px solid transparent;
    pointer-events: none;
  }

  .overlay-box.hovered {
    border-color: rgba(239, 143, 55, 0.9);
    background: rgba(239, 143, 55, 0.08);
  }

  .overlay-box.selected {
    border: 2px solid rgba(16, 104, 93, 0.95);
    background: rgba(16, 104, 93, 0.1);
  }

  .overlay-box span {
    position: absolute;
    top: -1.6rem;
    left: 0;
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
    background: #10221d;
    color: #f7f2eb;
    font-size: 0.72rem;
  }

  @media (max-width: 980px) {
    .studio-shell {
      grid-template-columns: 1fr;
    }

    .canvas-header {
      flex-direction: column;
    }

    iframe {
      height: 60vh;
    }
  }
</style>
