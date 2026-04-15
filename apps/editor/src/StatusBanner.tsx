import { useEffect, useState } from 'react';

import {
  EVENTS,
  subscribe,
  type DevServerExited,
  type DevServerReady,
  type DevServerTimeout,
  type SidecarCrashed,
} from './runtime/events';

type BannerState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'ready'; url: string }
  | { kind: 'timeout'; stdoutBuffer: string }
  | { kind: 'exited'; code: number | null; lastStderr: string[] }
  | { kind: 'sidecar-crashed'; code: number | null };

export function StatusBanner({
  onReady,
  onBlocked,
}: {
  onReady?: (url: string) => void;
  onBlocked?: (blocked: boolean) => void;
}) {
  const [state, setState] = useState<BannerState>({ kind: 'idle' });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const unsubs: Array<Promise<() => void>> = [
      subscribe<DevServerReady>(EVENTS.devServerReady, (payload) => {
        setState({ kind: 'ready', url: payload.url });
        onReady?.(payload.url);
        onBlocked?.(false);
      }),
      subscribe<DevServerTimeout>(EVENTS.devServerTimeout, (payload) => {
        setState({ kind: 'timeout', stdoutBuffer: payload.stdoutBuffer });
        onBlocked?.(true);
      }),
      subscribe<DevServerExited>(EVENTS.devServerExited, (payload) => {
        setState({ kind: 'exited', code: payload.code, lastStderr: payload.lastStderr });
        onBlocked?.(true);
      }),
      subscribe<SidecarCrashed>(EVENTS.sidecarCrashed, (payload) => {
        setState({ kind: 'sidecar-crashed', code: payload.code });
        onBlocked?.(true);
      }),
    ];

    return () => {
      unsubs.forEach((promise) =>
        promise.then((fn) => fn()).catch(() => undefined),
      );
    };
  }, [onReady, onBlocked]);

  const variant =
    state.kind === 'ready'
      ? 'status-ready'
      : state.kind === 'idle'
      ? 'status-idle'
      : 'status-error';

  return (
    <div className={`status-banner ${variant}`} role="status" aria-live="polite">
      <div className="status-banner-message">{renderMessage(state)}</div>
      {hasDetails(state) ? (
        <button
          className="status-banner-toggle"
          type="button"
          onClick={() => setShowDetails((v) => !v)}
        >
          {showDetails ? 'Hide output' : 'Show output'}
        </button>
      ) : null}
      {showDetails ? (
        <pre className="status-banner-details">{renderDetails(state)}</pre>
      ) : null}
    </div>
  );
}

function renderMessage(state: BannerState): string {
  switch (state.kind) {
    case 'idle':
      return 'Ready. Open a project folder to begin.';
    case 'starting':
      return 'Starting dev server…';
    case 'ready':
      return `Dev server ready · ${state.url}`;
    case 'timeout':
      return 'Dev server did not emit a URL within 60 seconds.';
    case 'exited':
      return `Dev server exited${state.code !== null ? ` with code ${state.code}` : ''}.`;
    case 'sidecar-crashed':
      return 'Framework-engine sidecar crashed. Reopen the project to recover.';
  }
}

function hasDetails(state: BannerState): boolean {
  return state.kind === 'timeout' || state.kind === 'exited' || state.kind === 'sidecar-crashed';
}

function renderDetails(state: BannerState): string {
  if (state.kind === 'timeout') return state.stdoutBuffer || '(no output captured)';
  if (state.kind === 'exited') return state.lastStderr.join('\n') || '(no stderr captured)';
  if (state.kind === 'sidecar-crashed')
    return `Sidecar process exited${state.code !== null ? ` with code ${state.code}` : ''}.`;
  return '';
}
