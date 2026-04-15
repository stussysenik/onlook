// Injected into the preview child webview at load time.
// Posts minimal element identifiers back to the main webview via Tauri events.
// Deliberately tiny — overlays, selection rendering, and drag handles all
// live in the main editor SPA, not here.
(function () {
  if (window.__onlook_preview_probe_installed) return;
  window.__onlook_preview_probe_installed = true;

  const invoke = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) || null;
  const emit = (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) || null;

  function identify(element) {
    if (!element || element.nodeType !== 1) return null;
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      className: element.className || null,
      text: (element.textContent || '').slice(0, 120),
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      path: cssPath(element),
    };
  }

  function cssPath(element) {
    const segments = [];
    let current = element;
    while (current && current.nodeType === 1 && segments.length < 12) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        segment += '#' + current.id;
        segments.unshift(segment);
        break;
      }
      const parent = current.parentNode;
      if (parent && parent.children && parent.children.length > 1) {
        const index = Array.prototype.indexOf.call(parent.children, current);
        segment += ':nth-child(' + (index + 1) + ')';
      }
      segments.unshift(segment);
      current = parent;
    }
    return segments.join(' > ');
  }

  function send(eventName, payload) {
    if (emit) {
      try { emit(eventName, payload); return; } catch (_) {}
    }
    // Fallback: best-effort postMessage to parent if embedded as iframe — not
    // used in the v1 shell (we're a child webview, not an iframe), but cheap.
    try {
      window.parent && window.parent.postMessage({ __onlookEvent: eventName, payload }, '*');
    } catch (_) {}
  }

  document.addEventListener(
    'click',
    function (ev) {
      const target = ev.target instanceof Element ? ev.target : null;
      const payload = identify(target);
      if (payload) send('desktop://preview-click', payload);
    },
    true,
  );

  document.addEventListener(
    'mouseover',
    function (ev) {
      const target = ev.target instanceof Element ? ev.target : null;
      const payload = identify(target);
      if (payload) send('desktop://preview-hover', payload);
    },
    true,
  );

  window.addEventListener('load', function () {
    send('desktop://preview-loaded', {
      href: location.href,
      title: document.title,
      timestamp: Date.now(),
    });
  });
})();
