/**
 * MEDIC Background Service Worker
 * Maintains a WebSocket connection to the MEDIC VS Code extension
 * and relays console errors/warnings from content scripts.
 *
 * Supports domain filtering: when autoEnableApproved is on, only
 * errors from tabs whose domain matches the approved list are relayed.
 * When it's off, all domains are relayed (if monitoring is enabled).
 */

const WS_URL = 'ws://localhost:18988';
const RECONNECT_DELAY_MS = 3000;
const MAX_QUEUE = 200;

/** @type {WebSocket | null} */
let ws = null;
/** @type {'connected' | 'connecting' | 'disconnected'} */
let status = 'disconnected';
/** @type {boolean} */
let enabled = true;
/** @type {boolean} */
let autoEnableApproved = true;
/** @type {string[]} */
let approvedDomains = [];
/** @type {Array<object>} */
let queue = [];
/** @type {number | null} */
let reconnectTimer = null;

// ── Domain matching ──────────────────────────────────────────────────

function extractDomain(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function isDomainApproved(tabUrl) {
  if (!autoEnableApproved) return true; // no filtering
  if (approvedDomains.length === 0) return true; // no domains = allow all
  const host = extractDomain(tabUrl);
  if (!host) return false;
  return approvedDomains.some(pattern => {
    if (host === pattern) return true;
    if (host.startsWith(pattern + ':')) return true;
    if (host.startsWith(pattern + '.')) return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return host.endsWith(suffix) || host === pattern.slice(2);
    }
    return false;
  });
}

// ── WebSocket Management ─────────────────────────────────────────────

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (!enabled) return;

  status = 'connecting';
  broadcastStatus();

  try {
    ws = new WebSocket(WS_URL);
  } catch {
    status = 'disconnected';
    broadcastStatus();
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    status = 'connected';
    broadcastStatus();
    // Flush queued messages
    for (const msg of queue) {
      ws.send(JSON.stringify(msg));
    }
    queue = [];
  };

  ws.onclose = () => {
    status = 'disconnected';
    ws = null;
    broadcastStatus();
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after this
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'connected') {
        console.log('[MEDIC] Connected to VS Code, watcher:', data.watcherId);
      }
    } catch {
      // Ignore invalid messages
    }
  };
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  status = 'disconnected';
  broadcastStatus();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  if (!enabled) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

// ── Message Relay ────────────────────────────────────────────────────

function relay(msg) {
  if (!enabled) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    // Queue if disconnected (bounded)
    if (queue.length < MAX_QUEUE) {
      queue.push(msg);
    }
    // Ensure we're trying to connect
    if (status === 'disconnected') {
      connect();
    }
  }
}

// ── Chrome Runtime Messaging ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Messages from content scripts — attach tab info before relaying
  if (message && message.type && message.message) {
    const tab = sender.tab;
    if (tab) {
      // Domain filter check
      const tabUrl = tab.url || message.url || '';
      if (!isDomainApproved(tabUrl)) {
        return; // silently drop — domain not approved
      }
      message.tabId = tab.id;
      message.tabTitle = tab.title || '';
      message.tabUrl = tabUrl;
    }
    relay(message);
  }

  // Messages from popup
  if (message && message.action) {
    switch (message.action) {
      case 'getStatus':
        sendResponse({ status, enabled, queueSize: queue.length });
        return true;
      case 'toggle':
        enabled = !enabled;
        chrome.storage.local.set({ enabled });
        if (enabled) {
          connect();
        } else {
          disconnect();
          queue = [];
        }
        sendResponse({ status, enabled });
        return true;
      case 'reconnect':
        disconnect();
        enabled = true;
        chrome.storage.local.set({ enabled });
        connect();
        sendResponse({ status: 'connecting', enabled });
        return true;
      case 'domainsUpdated':
        approvedDomains = message.approvedDomains || [];
        return false;
      case 'setAutoEnable':
        autoEnableApproved = message.autoEnableApproved !== false;
        return false;
    }
  }
});

// ── Dynamic Toolbar Icon ─────────────────────────────────────────────

const STATUS_DOT_COLORS = {
  connected:    '#4CAF50',
  connecting:   '#FF9800',
  disconnected: '#F44336',
};

/**
 * Draw the MEDIC eye+cross icon on an OffscreenCanvas with a status dot.
 * Returns ImageData at the requested size.
 */
function renderIcon(size, dotColor) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size / 24; // scale from 24×24 viewBox

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(s, s);

  // Eye outline (almond shape)
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(2, 12);
  ctx.bezierCurveTo(2, 12, 5.5, 5, 12, 5);
  ctx.bezierCurveTo(18.5, 5, 22, 12, 22, 12);
  ctx.bezierCurveTo(22, 12, 18.5, 19, 12, 19);
  ctx.bezierCurveTo(5.5, 19, 2, 12, 2, 12);
  ctx.closePath();
  ctx.stroke();

  // Cross — vertical bar
  ctx.fillStyle = '#cccccc';
  ctx.beginPath();
  ctx.roundRect(10.6, 8.5, 2.8, 7, 0.3);
  ctx.fill();

  // Cross — horizontal bar
  ctx.beginPath();
  ctx.roundRect(8.5, 10.6, 7, 2.8, 0.3);
  ctx.fill();

  ctx.restore();

  // Status dot (top-right corner)
  if (dotColor) {
    const r = Math.max(size * 0.15, 2);
    const cx = size - r - 0.5;
    const cy = r + 0.5;
    // Dark border for contrast
    ctx.beginPath();
    ctx.arc(cx, cy, r + Math.max(size * 0.05, 0.8), 0, Math.PI * 2);
    ctx.fillStyle = '#1e1e1e';
    ctx.fill();
    // Colored dot
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
  }

  return ctx.getImageData(0, 0, size, size);
}

function updateToolbarIcon(currentStatus) {
  const dotColor = STATUS_DOT_COLORS[currentStatus] || STATUS_DOT_COLORS.disconnected;
  try {
    chrome.action.setIcon({
      imageData: {
        16: renderIcon(16, dotColor),
        32: renderIcon(32, dotColor),
        48: renderIcon(48, dotColor),
      },
    });
  } catch {
    // Fallback: leave default icon
  }
}

// ── Status Broadcasting ──────────────────────────────────────────────

function broadcastStatus() {
  chrome.runtime.sendMessage({ action: 'statusUpdate', status, enabled }).catch(() => {
    // Popup not open — ignore
  });

  // Update toolbar icon with status dot
  updateToolbarIcon(status);
}

// ── Init ─────────────────────────────────────────────────────────────

chrome.storage.local.get(['enabled', 'approvedDomains', 'autoEnableApproved'], (result) => {
  approvedDomains = result.approvedDomains || [];
  autoEnableApproved = result.autoEnableApproved !== false;

  if (result.enabled === false) {
    enabled = false;
    broadcastStatus();
  } else {
    enabled = true;
    connect();
  }
});
