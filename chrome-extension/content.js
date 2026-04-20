/**
 * MEDIC Content Script (isolated world)
 * Listens for postMessage events from inject.js (main world)
 * and relays them to the background service worker.
 */
(function () {
  'use strict';

  const CHANNEL = '__medic_error__';

  window.addEventListener('message', (event) => {
    // Only accept messages from the same frame
    if (event.source !== window) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    const payload = event.data.payload;
    if (!payload || !payload.type || !payload.message) return;

    try {
      chrome.runtime.sendMessage(payload);
    } catch {
      // Extension context invalidated — ignore
    }
  });
})();
