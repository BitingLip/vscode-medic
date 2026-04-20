/**
 * MEDIC Inject Script — runs in the MAIN world (page context)
 * Hooks console.error, console.warn, window.onerror, unhandledrejection
 * and posts structured messages to the content script via window.postMessage.
 */
(function () {
  'use strict';

  if (window.__medicInjected) return;
  window.__medicInjected = true;

  const CHANNEL = '__medic_error__';

  function post(entry) {
    try {
      window.postMessage({ channel: CHANNEL, payload: entry }, '*');
    } catch {
      // Never break the page
    }
  }

  function cleanStack(stack) {
    if (!stack) return undefined;
    const lines = stack.split('\n');
    if (lines.length > 1 && /^(\w*Error|.+):/.test(lines[0])) {
      return lines.slice(1).join('\n');
    }
    return stack;
  }

  function parseFirstFrame(stack) {
    if (!stack) return {};
    const match = /at\s+.*?\(?(.+?):(\d+):\d+\)?/.exec(stack);
    if (match) return { source: match[1], lineno: parseInt(match[2], 10) };
    return {};
  }

  // ── Hook console.error ─────────────────────────────────────────────

  const origError = console.error;
  console.error = function (...args) {
    origError.apply(console, args);
    try {
      const message = args.map(a =>
        typeof a === 'string' ? a : (a instanceof Error ? a.message : JSON.stringify(a))
      ).join(' ');

      const err = args.find(a => a instanceof Error);
      const stack = err?.stack ?? new Error().stack;
      const frame = parseFirstFrame(stack);

      post({
        type: 'error',
        message,
        source: frame.source,
        lineno: frame.lineno,
        stack: cleanStack(err?.stack),
        url: location.href,
        timestamp: Date.now(),
      });
    } catch { /* Never break the page */ }
  };

  // ── Hook console.warn ──────────────────────────────────────────────

  const origWarn = console.warn;
  console.warn = function (...args) {
    origWarn.apply(console, args);
    try {
      const message = args.map(a =>
        typeof a === 'string' ? a : (a instanceof Error ? a.message : JSON.stringify(a))
      ).join(' ');

      post({
        type: 'warning',
        message,
        url: location.href,
        timestamp: Date.now(),
      });
    } catch { /* Never break the page */ }
  };

  // ── Global error handler ───────────────────────────────────────────

  window.addEventListener('error', (event) => {
    if (event.target !== window) return;
    try {
      post({
        type: 'error',
        message: event.message,
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: cleanStack(event.error?.stack),
        url: location.href,
        timestamp: Date.now(),
      });
    } catch { /* Never break the page */ }
  });

  // ── Unhandled promise rejections ───────────────────────────────────

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason;
      const message = reason instanceof Error
        ? reason.message
        : (typeof reason === 'string' ? reason : 'Unhandled promise rejection');
      const stack = reason instanceof Error ? cleanStack(reason.stack) : undefined;
      const frame = parseFirstFrame(reason?.stack);

      post({
        type: 'error',
        message: `Unhandled rejection: ${message}`,
        source: frame.source,
        lineno: frame.lineno,
        stack,
        url: location.href,
        timestamp: Date.now(),
      });
    } catch { /* Never break the page */ }
  });
})();
