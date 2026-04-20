/**
 * MEDIC Popup Script
 * Controls the extension popup UI — domain management, toggles, connection status.
 */

// ── DOM refs ─────────────────────────────────────────────────────────

const headerDot = document.getElementById('header-dot');
const headerTooltip = document.getElementById('header-tooltip');
const toggleEnabled = document.getElementById('toggle-enabled');
const toggleAutoEnable = document.getElementById('toggle-auto-enable');
const domainInput = document.getElementById('domain-input');
const btnAddDomain = document.getElementById('btn-add-domain');
const domainListEl = document.getElementById('domain-list');
const expandBar = document.getElementById('expand-bar');
const reconnectSection = document.getElementById('reconnect-section');
const btnReconnect = document.getElementById('btn-reconnect');

const MAX_VISIBLE = 4; // items before cropping

let approvedDomains = [];
let isExpanded = false;
let currentTabDomain = '';

// ── Helpers ──────────────────────────────────────────────────────────

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.host; // e.g. "localhost:8001"
  } catch {
    return '';
  }
}

// ── Status rendering ─────────────────────────────────────────────────

function updateStatus(state) {
  const { status, enabled, queueSize } = state;

  // Header dot
  headerDot.className = 'header-dot ' + status;

  // Tooltip detail
  if (status === 'connected') {
    headerTooltip.textContent = 'Connected — streaming to VS Code';
  } else if (status === 'connecting') {
    headerTooltip.textContent = 'Connecting to ws://localhost:18988…';
  } else {
    headerTooltip.textContent = enabled
      ? (queueSize ? `Disconnected — ${queueSize} queued` : 'Disconnected — waiting to reconnect')
      : 'Monitoring paused';
  }

  // Toggle checkbox
  toggleEnabled.checked = enabled;

  // Reconnect button
  reconnectSection.style.display = (status !== 'connected' && enabled) ? '' : 'none';
}

// ── Domain list rendering ────────────────────────────────────────────

function renderDomainList() {
  domainListEl.innerHTML = '';

  if (approvedDomains.length === 0) {
    domainListEl.innerHTML = '<div class="domain-empty">No approved domains yet</div>';
    expandBar.classList.remove('visible');
    return;
  }

  approvedDomains.forEach((domain, i) => {
    const item = document.createElement('div');
    item.className = 'domain-item';

    // Left type sidebar (like error-code-type)
    const typeSide = document.createElement('div');
    const isActive = currentTabDomain && matchesDomain(currentTabDomain, domain);
    typeSide.className = 'domain-item-type' + (isActive ? ' active' : '');
    typeSide.textContent = isActive ? '●' : '○';
    item.appendChild(typeSide);

    // Main content area (like error-code-main)
    const main = document.createElement('div');
    main.className = 'domain-item-main';
    main.textContent = domain;
    main.title = domain;
    item.appendChild(main);

    // Remove button
    const remove = document.createElement('button');
    remove.className = 'btn-remove';
    remove.textContent = '✕';
    remove.title = 'Remove';
    remove.addEventListener('click', () => removeDomain(i));
    item.appendChild(remove);

    domainListEl.appendChild(item);
  });

  // Expand/collapse
  if (approvedDomains.length > MAX_VISIBLE) {
    expandBar.classList.add('visible');
    if (isExpanded) {
      domainListEl.classList.remove('collapsed');
      domainListEl.classList.add('expanded');
      expandBar.classList.add('expanded');
    } else {
      domainListEl.classList.add('collapsed');
      domainListEl.classList.remove('expanded');
      expandBar.classList.remove('expanded');
      // ~40px per item (32 min-height + 4 margin + border)
      domainListEl.style.setProperty('--collapsed-height', (MAX_VISIBLE * 40) + 'px');
    }
  } else {
    expandBar.classList.remove('visible');
    domainListEl.classList.remove('collapsed');
    domainListEl.classList.add('expanded');
  }
}

function matchesDomain(tabDomain, pattern) {
  // Exact match or prefix match (e.g. "localhost" matches "localhost:8001")
  if (tabDomain === pattern) return true;
  if (tabDomain.startsWith(pattern + ':')) return true;
  if (tabDomain.startsWith(pattern + '.')) return true;
  // Wildcard prefix: pattern "*.example.com" matches "sub.example.com"
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".example.com"
    return tabDomain.endsWith(suffix) || tabDomain === pattern.slice(2);
  }
  return false;
}

// ── Domain CRUD ──────────────────────────────────────────────────────

function addDomain(domain) {
  domain = domain.trim().toLowerCase();
  if (!domain) return;
  // Remove protocol/path if user pasted a URL
  try {
    const u = new URL(domain.includes('://') ? domain : 'http://' + domain);
    domain = u.host;
  } catch { /* use as-is */ }

  if (approvedDomains.includes(domain)) return;
  approvedDomains.unshift(domain); // add to top
  saveDomains();
  renderDomainList();
  // Notify background
  chrome.runtime.sendMessage({ action: 'domainsUpdated', approvedDomains });
}

function removeDomain(index) {
  approvedDomains.splice(index, 1);
  saveDomains();
  renderDomainList();
  chrome.runtime.sendMessage({ action: 'domainsUpdated', approvedDomains });
}

function saveDomains() {
  chrome.storage.local.set({ approvedDomains });
}

// ── Init ─────────────────────────────────────────────────────────────

// Load saved state
chrome.storage.local.get(['approvedDomains', 'autoEnableApproved'], (result) => {
  approvedDomains = result.approvedDomains || [];
  toggleAutoEnable.checked = result.autoEnableApproved !== false; // default on
  renderDomainList();
});

// Get current tab domain and pre-fill the input
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0] && tabs[0].url) {
    currentTabDomain = extractDomain(tabs[0].url);
    if (currentTabDomain && !approvedDomains.includes(currentTabDomain)) {
      domainInput.value = currentTabDomain;
    }
    renderDomainList(); // re-render to show active indicators
  }
});

// Fetch initial status from background
chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
  if (response) updateStatus(response);
});

// Listen for live status updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'statusUpdate') {
    updateStatus(message);
  }
});

// ── Event listeners ──────────────────────────────────────────────────

// Enable/disable toggle
toggleEnabled.addEventListener('change', () => {
  chrome.runtime.sendMessage({ action: 'toggle' }, (response) => {
    if (response) updateStatus(response);
  });
});

// Auto-enable toggle
toggleAutoEnable.addEventListener('change', () => {
  const autoEnableApproved = toggleAutoEnable.checked;
  chrome.storage.local.set({ autoEnableApproved });
  chrome.runtime.sendMessage({ action: 'setAutoEnable', autoEnableApproved });
});

// Add domain from input
btnAddDomain.addEventListener('click', () => {
  addDomain(domainInput.value);
  domainInput.value = '';
  domainInput.focus();
});
domainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addDomain(domainInput.value);
    domainInput.value = '';
  }
});

// Expand/collapse chevron
expandBar.addEventListener('click', () => {
  isExpanded = !isExpanded;
  renderDomainList();
});

// Reconnect
btnReconnect.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'reconnect' }, (response) => {
    if (response) updateStatus(response);
  });
});
