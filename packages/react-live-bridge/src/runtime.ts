import type {
  BridgeElementSnapshot,
  BridgeRequestSnapshotMessage,
  BridgeSnapshotMessage,
} from '@onlook-next/editor-contracts';

function toElementSnapshot(node: HTMLElement): BridgeElementSnapshot | null {
  const id = node.dataset.onlookId;
  const file = node.dataset.onlookSourceFile;
  const line = Number(node.dataset.onlookSourceLine);
  const column = Number(node.dataset.onlookSourceColumn);

  if (!id || !file || Number.isNaN(line) || Number.isNaN(column)) {
    return null;
  }

  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const text = Array.from(node.childNodes)
    .filter((child) => child.nodeType === Node.TEXT_NODE)
    .map((child) => child.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    id,
    tag: node.tagName.toLowerCase(),
    text,
    className: node.className,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    source: {
      file,
      line,
      column,
    },
    canEditText: Array.from(node.childNodes).every((child) => child.nodeType === Node.TEXT_NODE),
  };
}

function collectElements() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-onlook-id]'))
    .map(toElementSnapshot)
    .filter((element): element is BridgeElementSnapshot => element !== null);
}

export function startOnlookBridge() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  let rafId = 0;

  const publishSnapshot = () => {
    rafId = 0;
    if (window.parent === window) {
      return;
    }

    const message: BridgeSnapshotMessage = {
      type: 'onlook:snapshot',
      url: window.location.href,
      elements: collectElements(),
    };

    window.parent.postMessage(message, '*');
  };

  const scheduleSnapshot = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }

    rafId = requestAnimationFrame(publishSnapshot);
  };

  const observer = new MutationObserver(scheduleSnapshot);
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.addEventListener('resize', scheduleSnapshot);
  window.addEventListener('scroll', scheduleSnapshot, true);
  window.addEventListener('message', (event: MessageEvent<BridgeRequestSnapshotMessage>) => {
    if (event.data?.type === 'onlook:request-snapshot') {
      scheduleSnapshot();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleSnapshot, { once: true });
  } else {
    scheduleSnapshot();
  }
}
