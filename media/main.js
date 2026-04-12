// @ts-check
/// <reference lib="dom" />

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       State
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    /** @type {import('../src/types').ErrorEntry[]} */
    let errors = [];
    /** @type {import('../src/types').WatcherConfig[]} */
    let watchers = [];
    /** @type {string | null} */
    let selectedWatcherId = null;
    /** @type {Record<string, string[]>} */
    let presets = {};
    /** @type {{ agent: string; autoTrigger: boolean; debounceMs: number; approvalMode: string }} */
    let settings = { agent: '', autoTrigger: false, debounceMs: 3000, approvalMode: 'confirm', autoDeleteSession: 'never', sessionMode: 'new' };
    /** @type {string} */
    let watcherSearchQuery = '';
    /** @type {Set<string>} */
    let collapsedSections = new Set();
    /** @type {Set<string>} */
    let pinnedWatcherIds = new Set();
    let sidebarHidden = false;
    let sashDragging = false;
    let sidebarWidth = 220;

    // ── Compose state ──
    /** @type {Set<string>} */
    let selectedErrorIds = new Set();
    /** @type {string} */
    let selectedMode = 'agent';
    /** @type {string} */
    let selectedModel = '';
    /** @type {Array<{id: string, label: string, icon: string, desc: string}>} */
    let chatModes = [];
    /** @type {Array<{id: string, label: string, icon: string, desc: string}>} */
    let customAgents = [];
    /** @type {Array<{id: string, name: string, vendor: string, family: string}>} */
    let availableModels = [];

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       DOM refs
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    const $ = (/** @type {string} */ id) => document.getElementById(id);

    const $viewpane = /** @type {HTMLElement} */ ($('viewpane'));
    const $feedContainer = /** @type {HTMLElement} */ ($('error-feed-container'));
    const $sash = /** @type {HTMLElement} */ ($('sash'));
    const $sidebar = /** @type {HTMLElement} */ ($('watchers-sidebar'));

    // Error Feed Title Bar
    const $feedTitleLabel = /** @type {HTMLElement} */ ($('feed-title-label'));
    const $feedTitleCount = /** @type {HTMLElement} */ ($('feed-title-count'));
    const $feedTitleClear = /** @type {HTMLElement} */ ($('feed-title-clear'));
    const $feedTitleShowSidebar = /** @type {HTMLElement} */ ($('feed-title-show-sidebar'));

    // Error Feed
    const $errorFeed = /** @type {HTMLElement} */ ($('error-feed'));
    const $emptyState = /** @type {HTMLElement} */ ($('empty-state'));

    // Compose Box
    const $composeBox = /** @type {HTMLElement} */ ($('compose-box'));
    const $composeChips = /** @type {HTMLElement} */ ($('compose-chips'));
    const $promptInput = /** @type {HTMLTextAreaElement} */ ($('prompt-input'));
    const $composeSendBtn = /** @type {HTMLElement} */ ($('compose-send-btn'));
    const $composeAttachBtn = /** @type {HTMLElement} */ ($('compose-attach-btn'));

    // Compose Pickers
    const $agentPickerBtn = /** @type {HTMLElement} */ ($('agent-picker-btn'));
    const $agentPickerIcon = /** @type {HTMLElement} */ ($('agent-picker-icon'));
    const $agentPickerLabel = /** @type {HTMLElement} */ ($('agent-picker-label'));
    const $agentPickerDropdown = /** @type {HTMLElement} */ ($('agent-picker-dropdown'));
    const $modelPickerBtn = /** @type {HTMLElement} */ ($('model-picker-btn'));
    const $modelPickerLabel = /** @type {HTMLElement} */ ($('model-picker-label'));
    const $modelPickerDropdown = /** @type {HTMLElement} */ ($('model-picker-dropdown'));

    // Workspace Picker
    const $workspacePickerBtn = /** @type {HTMLElement} */ ($('workspace-picker-btn'));
    const $workspacePickerLabel = /** @type {HTMLElement} */ ($('workspace-picker-label'));
    const $workspacePickerDropdown = /** @type {HTMLElement} */ ($('workspace-picker-dropdown'));

    // Approvals Picker
    const $approvalsPickerBtn = /** @type {HTMLElement} */ ($('approvals-picker-btn'));
    const $approvalsPickerLabel = /** @type {HTMLElement} */ ($('approvals-picker-label'));
    const $approvalsPickerDropdown = /** @type {HTMLElement} */ ($('approvals-picker-dropdown'));

    // Auto-delete Picker
    const $autodeletPickerBtn = /** @type {HTMLElement} */ ($('autodelete-picker-btn'));
    const $autodeletePickerLabel = /** @type {HTMLElement} */ ($('autodelete-picker-label'));
    const $autodeletePickerDropdown = /** @type {HTMLElement} */ ($('autodelete-picker-dropdown'));
    const $sessionPickerBtn = /** @type {HTMLElement} */ ($('session-picker-btn'));
    const $sessionPickerLabel = /** @type {HTMLElement} */ ($('session-picker-label'));
    const $sessionPickerDropdown = /** @type {HTMLElement} */ ($('session-picker-dropdown'));

    // Watchers Sidebar
    const $watcherSearchBar = /** @type {HTMLElement} */ ($('watcher-search-bar'));
    const $watcherSearchInput = /** @type {HTMLInputElement} */ ($('watcher-search-input'));
    const $watchersList = /** @type {HTMLElement} */ ($('watchers-list'));
    const $watchersEmpty = /** @type {HTMLElement} */ ($('watchers-empty'));

    // Overlays
    const $addOverlay = /** @type {HTMLElement} */ ($('add-watcher-overlay'));

    // Add-watcher form
    const $watcherForm = /** @type {HTMLFormElement} */ ($('watcher-form'));
    const $watcherNameInput = /** @type {HTMLInputElement} */ ($('watcher-name'));
    const $watcherType = /** @type {HTMLSelectElement} */ ($('watcher-type'));
    const $watcherPath = /** @type {HTMLInputElement} */ ($('watcher-path'));
    const $watcherPathLabel = /** @type {HTMLElement} */ ($('watcher-path-label'));
    const $watcherPreset = /** @type {HTMLSelectElement} */ ($('watcher-preset'));
    const $watcherPatterns = /** @type {HTMLTextAreaElement} */ ($('watcher-patterns'));

    // Context menu
    const $contextMenu = /** @type {HTMLElement} */ ($('context-menu'));

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Rendering
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    function render() {
        renderFeedTitle();
        renderErrors();
        renderWatchers();
        renderComposeChips();
        renderAgentPicker();
        renderModelPicker();
        renderWorkspacePicker();
        renderApprovalsPicker();
        renderAutodeletePicker();
        renderSessionPicker();
        checkLayout();
    }

    /* â”€â”€ Error Feed Title Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    function renderFeedTitle() {
        const pendingCount = errors.filter(e => e.status === 'pending').length;

        if (selectedWatcherId) {
            const w = watchers.find(w => w.id === selectedWatcherId);
            $feedTitleLabel.textContent = w ? w.name.toUpperCase() : 'UNKNOWN WATCHER';
            $feedTitleClear.style.display = '';
        } else {
            $feedTitleLabel.textContent = 'ALL ERRORS';
            $feedTitleClear.style.display = 'none';
        }

        if (pendingCount > 0) {
            $feedTitleCount.textContent = `${pendingCount} pending`;
            $feedTitleCount.classList.add('has-pending');
        } else {
            $feedTitleCount.textContent = `${errors.length} total`;
            $feedTitleCount.classList.remove('has-pending');
        }
    }

    /* â”€â”€ Error Feed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    function renderErrors() {
        const filtered = selectedWatcherId
            ? errors.filter(e => e.watcherId === selectedWatcherId)
            : errors;

        // Build map of currently rendered cards
        const existingItems = $errorFeed.querySelectorAll('.error-item-container');
        const existingMap = new Map();
        existingItems.forEach(el => existingMap.set(el.dataset.id, el));

        if (filtered.length === 0) {
            existingItems.forEach(el => el.remove());
            $emptyState.classList.add('visible');
            return;
        }

        $emptyState.classList.remove('visible');

        // Track which ids should remain
        const filteredIds = new Set(filtered.map(e => e.id));

        // Remove cards no longer in the filtered set
        existingItems.forEach(el => {
            if (!filteredIds.has(el.dataset.id)) el.remove();
        });

        // Insert / update cards
        let prevNode = null;
        for (const err of filtered) {
            const existing = existingMap.get(err.id);
            if (existing) {
                // Update occurrence badge in-place
                const badge = existing.querySelector('.error-occurrence-badge');
                const count = err.occurrences || 1;
                if (count > 1) {
                    if (badge) {
                        if (badge.textContent !== String(count)) {
                            badge.textContent = count;
                            badge.title = count + ' occurrences';
                            badge.classList.remove('pulse');
                            void badge.offsetWidth; // reflow to re-trigger
                            badge.classList.add('pulse');
                        }
                    } else {
                        // First duplicate — inject badge
                        const span = document.createElement('span');
                        span.className = 'error-occurrence-badge pulse';
                        span.title = count + ' occurrences';
                        span.textContent = count;
                        const source = existing.querySelector('.error-source');
                        if (source) source.after(span);
                    }
                }
                // Update status classes
                const isChip = selectedErrorIds.has(err.id);
                existing.className = `error-item-container ${err.status}${isChip ? ' chip-selected' : ''}`;
                // Update severity icon to reflect status
                const sevIcon = existing.querySelector('.severity-icon');
                if (sevIcon) {
                    const sevClass = err.stackTrace ? 'severity-error' : 'severity-warning';
                    const sevIconName = err.stackTrace ? 'codicon-error' : 'codicon-warning';
                    sevIcon.className = `severity-icon ${statusIconClass(err)}`;
                    sevIcon.innerHTML = statusIconHtml(err, sevIconName);
                }
                // Update inline status label
                const inlineStatus = existing.querySelector('.error-status-inline');
                if (err.status !== 'pending') {
                    if (inlineStatus) {
                        inlineStatus.className = `error-status-inline ${err.status}`;
                        inlineStatus.textContent = statusLabel(err.status);
                    } else {
                        const span = document.createElement('span');
                        span.className = `error-status-inline ${err.status}`;
                        span.textContent = statusLabel(err.status);
                        const ts = existing.querySelector('.error-timestamp');
                        if (ts) ts.after(span);
                    }
                } else if (inlineStatus) {
                    inlineStatus.remove();
                }
                prevNode = existing;
            } else {
                // New card — create with slide-in animation
                const card = createErrorItem(err);
                card.classList.add('error-new');
                card.addEventListener('animationend', () => card.classList.remove('error-new'), { once: true });
                if (prevNode && prevNode.nextSibling) {
                    $errorFeed.insertBefore(card, prevNode.nextSibling);
                } else {
                    $errorFeed.appendChild(card);
                }
                prevNode = card;
            }
        }
    }

    /** Returns the CSS class for the severity-icon div based on error status */
    function statusIconClass(err) {
        switch (err.status) {
            case 'sending': return 'status-sending';
            case 'sent':    return 'status-sent';
            case 'resolved': return 'status-resolved';
            default:
                return err.stackTrace ? 'severity-error' : 'severity-warning';
        }
    }

    /** Returns the inner HTML for the severity-icon based on status */
    function statusIconHtml(err, fallbackIcon) {
        switch (err.status) {
            case 'sending': return '<span class="codicon codicon-loading codicon-modifier-spin"></span>';
            case 'sent':    return '<span class="codicon codicon-arrow-right"></span>';
            case 'resolved': return '<span class="codicon codicon-pass-filled"></span>';
            default:        return `<span class="codicon ${fallbackIcon}"></span>`;
        }
    }

    /** Returns a plain-text label for the status */
    function statusLabel(status) {
        switch (status) {
            case 'sending': return 'sending';
            case 'sent':    return 'sent';
            case 'resolved': return 'fixed';
            default:        return status;
        }
    }

    /**
     * @param {import('../src/types').ErrorEntry} err
     * @returns {HTMLElement}
     */
    function createErrorItem(err) {
        const el = document.createElement('div');
        const isChipSelected = selectedErrorIds.has(err.id);
        el.className = `error-item-container ${err.status}${isChipSelected ? ' chip-selected' : ''}`;
        el.dataset.id = err.id;

        const severityClass = err.stackTrace ? 'severity-error' : 'severity-warning';
        const severityIcon = err.stackTrace ? 'codicon-error' : 'codicon-warning';
        const timeStr = formatRelativeTime(err.timestamp);
        const fileLinks = extractFileRefs(err);

        const checkboxChecked = isChipSelected ? ' checked' : '';

        // Count lines to determine if we need unfold
        const msgLines = err.message.split('\n').length;
        const hasOverflow = msgLines > 6;

        el.innerHTML = `
            <div class="error-header">
                <button class="error-select-check${checkboxChecked}" data-action="toggle-select" data-id="${err.id}" title="Select error">
                    <span class="codicon codicon-check"></span>
                </button>
                <div class="severity-icon ${statusIconClass(err)}">
                    ${statusIconHtml(err, severityIcon)}
                </div>
                <a class="error-source" data-action="filter-source" data-watcher-id="${err.watcherId}" title="Filter by ${esc(err.source)}">${esc(err.source)}</a>
                ${(err.occurrences || 1) > 1 ? `<span class="error-occurrence-badge" title="${err.occurrences} occurrences">${err.occurrences}</span>` : ''}
                <span class="error-timestamp">${timeStr}</span>
                ${err.status !== 'pending' ? `<span class="error-status-inline ${err.status}">${statusLabel(err.status)}</span>` : ''}
                <div class="error-header-right">
                    <div class="error-header-toolbar">
                        ${err.status === 'sent'
                            ? `<button class="icon-btn" data-action="resolve" data-id="${err.id}" title="Mark as fixed"><span class="codicon codicon-pass"></span></button>`
                            : ''}
                        <button class="icon-btn" data-action="dismiss" data-id="${err.id}" title="Dismiss"><span class="codicon codicon-close"></span></button>
                    </div>
                </div>
            </div>
            <div class="error-body">
                <div class="error-code-box${hasOverflow ? ' overflows' : ''}">
                    <button class="error-code-copy" data-action="copy" data-id="${err.id}" title="Copy"><span class="codicon codicon-copy"></span></button>
                    <div class="error-code-content">${esc(err.message)}</div>
                    <button class="error-code-unfold" data-action="toggle-code-fold" data-id="${err.id}">
                        <span class="codicon codicon-chevron-down"></span>
                    </button>
                </div>
                ${err.stackTrace ? `
                <div class="error-stack-trace collapsed">
                    <button class="stack-toggle">
                        <span class="codicon codicon-chevron-right"></span>
                        Show stack trace
                    </button>
                    <div class="stack-content">${esc(err.stackTrace)}</div>
                </div>` : ''}
                ${fileLinks.length > 0 ? `
                <div class="error-context">
                    ${fileLinks.map(f => `
                        <a class="error-context-file" data-file="${esc(f.file)}" data-line="${f.line || ''}">
                            <span class="codicon codicon-file-code"></span>
                            ${esc(f.file)}${f.line ? ':' + f.line : ''}
                        </a>
                    `).join('')}
                </div>` : ''}
            </div>`;

        return el;
    }

    /* â”€â”€ Watchers Sidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    function renderWatchers() {
        // Clear existing
        const existing = $watchersList.querySelectorAll('.watcher-section, .watcher-item');
        existing.forEach(el => el.remove());
        $watchersEmpty.classList.toggle('visible', watchers.length === 0);

        if (watchers.length === 0) return;

        // Filter by search query
        const filtered = watcherSearchQuery
            ? watchers.filter(w => w.name.toLowerCase().includes(watcherSearchQuery.toLowerCase()))
            : watchers;

        // Group watchers into sections
        const sections = groupWatchers(filtered);

        const frag = document.createDocumentFragment();

        /** @type {Record<string, string>} */
        const sectionIcons = {
            'Pinned': 'codicon-pinned',
            'Logs': 'codicon-output',
            'Processes': 'codicon-terminal',
            'Web Console': 'codicon-globe',
        };

        for (const [sectionName, sectionWatchers] of sections) {
            // Only skip empty Pinned section; always show Logs/Processes/Web
            if (sectionWatchers.length === 0 && sectionName === 'Pinned') continue;

            const sectionEl = document.createElement('div');
            sectionEl.className = `watcher-section${collapsedSections.has(sectionName) ? ' collapsed' : ''}`;
            sectionEl.dataset.section = sectionName;

            const icon = sectionIcons[sectionName] || 'codicon-list-unordered';

            sectionEl.innerHTML = `
                <div class="watcher-section-header">
                    <span class="codicon codicon-chevron-down watcher-section-chevron"></span>
                    <span class="codicon ${icon} watcher-section-icon"></span>
                    <span class="watcher-section-label">${esc(sectionName)}</span>
                    <span class="watcher-section-count">${sectionWatchers.length}</span>
                </div>
                <div class="watcher-section-list"></div>`;

            const listEl = sectionEl.querySelector('.watcher-section-list');

            if (sectionWatchers.length === 0) {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'watcher-section-empty';
                emptyEl.textContent = sectionName === 'Web Console' ? 'Chrome plugin — coming soon' : 'No watchers';
                listEl?.appendChild(emptyEl);
            } else {
                for (const w of sectionWatchers) {
                    listEl?.appendChild(createWatcherItem(w));
                }
            }

            frag.appendChild(sectionEl);
        }

        $watchersList.appendChild(frag);
    }

    /**
     * @param {import('../src/types').WatcherConfig[]} list
     * @returns {[string, import('../src/types').WatcherConfig[]][]}
     */
    function groupWatchers(list) {
        /** @type {Map<string, import('../src/types').WatcherConfig[]>} */
        const groups = new Map();

        // Pinned first
        const pinned = list.filter(w => pinnedWatcherIds.has(w.id));
        if (pinned.length > 0) {
            groups.set('Pinned', pinned);
        }

        // Always show all three sections in order
        groups.set('Logs', []);
        groups.set('Processes', []);
        groups.set('Web Console', []);

        const categorized = list.filter(w => !pinnedWatcherIds.has(w.id));
        for (const w of categorized) {
            const cat = getCategory(w);
            groups.get(cat)?.push(w);
        }

        return Array.from(groups.entries());
    }

    /**
     * @param {import('../src/types').WatcherConfig} w
     * @returns {string}
     */
    function getCategory(w) {
        if (w.type === 'file' || w.type === 'terminal') return 'Logs';
        if (w.type === 'process') return 'Processes';
        if (w.type === 'web') return 'Web Console';
        return 'Logs';
    }

    /**
     * @param {import('../src/types').WatcherConfig} w
     * @returns {HTMLElement}
     */
    function createWatcherItem(w) {
        const el = document.createElement('div');
        el.className = 'watcher-item';
        if (w.id === selectedWatcherId) el.classList.add('selected');
        if (!w.enabled) el.classList.add('disabled');
        el.dataset.id = w.id;

        const pendingCount = errors.filter(e => e.watcherId === w.id && e.status === 'pending').length;
        const sendingCount = errors.filter(e => e.watcherId === w.id && (e.status === 'sent' || e.status === 'sending')).length;

        let statusClass;
        if (!w.enabled) {
            statusClass = 'paused';
        } else if (sendingCount > 0) {
            statusClass = 'agent-working';
        } else if (pendingCount > 0) {
            statusClass = 'has-errors';
        } else {
            statusClass = 'active';
        }

        el.innerHTML = `
            <div class="watcher-line-1">
                <div class="watcher-status-dot ${statusClass}"></div>
                <div class="watcher-name">${esc(w.name)}</div>
                <div class="watcher-item-actions">
                    <button class="icon-btn" data-action="toggle-watcher" data-id="${w.id}" title="${w.enabled ? 'Pause' : 'Resume'}">
                        <span class="codicon ${w.enabled ? 'codicon-debug-pause' : 'codicon-play'}"></span>
                    </button>
                    <button class="icon-btn" data-action="remove-watcher" data-id="${w.id}" title="Remove">
                        <span class="codicon codicon-trash"></span>
                    </button>
                </div>
            </div>
            <div class="watcher-line-2">
                <div class="watcher-path">${esc(w.path)}</div>
                <span class="watcher-error-count ${pendingCount === 0 ? 'zero' : ''}">${pendingCount} error${pendingCount !== 1 ? 's' : ''}</span>
            </div>`;

        // Click to select / filter
        el.addEventListener('click', (e) => {
            if (/** @type {HTMLElement} */ (e.target).closest('[data-action]')) return;
            const newId = w.id === selectedWatcherId ? null : w.id;
            vscode.postMessage({ type: 'selectWatcher', id: newId });
        });

        // Right-click context menu
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, w);
        });

        return el;
    }

    /* â”€â”€ Control Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    /* ── Compose Box Rendering ─────────────────────────────────────── */

    function renderComposeChips() {
        if (!$composeChips) return;
        $composeChips.innerHTML = '';

        for (const id of selectedErrorIds) {
            const err = errors.find(e => e.id === id);
            if (!err) { selectedErrorIds.delete(id); continue; }

            const chip = document.createElement('div');
            chip.className = 'compose-chip';
            chip.innerHTML = `
                <span class="codicon codicon-error"></span>
                <span class="compose-chip-label">${esc(err.source)}: ${esc(err.message.slice(0, 60))}${err.message.length > 60 ? '…' : ''}</span>
                <button class="compose-chip-close" data-chip-id="${err.id}" title="Remove">
                    <span class="codicon codicon-close"></span>
                </button>`;
            $composeChips.appendChild(chip);
        }
    }

    function renderAgentPicker() {
        if (!$agentPickerDropdown) return;
        $agentPickerDropdown.innerHTML = '';

        // Modes section
        if (chatModes.length > 0) {
            const modeHeader = document.createElement('div');
            modeHeader.className = 'compose-picker-section';
            modeHeader.textContent = 'Mode';
            $agentPickerDropdown.appendChild(modeHeader);

            for (const m of chatModes) {
                const opt = document.createElement('div');
                opt.className = `compose-picker-option${m.id === selectedMode ? ' active' : ''}`;
                opt.dataset.mode = m.id;
                opt.innerHTML = `<span class="codicon ${m.icon}"></span><span class="compose-picker-option-label">${esc(m.label)}</span>`;
                $agentPickerDropdown.appendChild(opt);
            }
        }

        // Custom agents section
        if (customAgents.length > 0) {
            const sep = document.createElement('div');
            sep.className = 'compose-picker-separator';
            $agentPickerDropdown.appendChild(sep);

            for (const a of customAgents) {
                const opt = document.createElement('div');
                opt.className = `compose-picker-option${a.id === selectedMode ? ' active' : ''}`;
                opt.dataset.mode = a.id;
                opt.innerHTML = `<span class="codicon ${a.icon}"></span><span class="compose-picker-option-label">${esc(a.label)}</span><span class="compose-picker-option-meta">${esc(a.desc)}</span>`;
                $agentPickerDropdown.appendChild(opt);
            }
        }

        // Update button label
        const allItems = [...chatModes, ...customAgents];
        const current = allItems.find(i => i.id === selectedMode);
        if (current) {
            $agentPickerLabel.textContent = current.label;
            if ($agentPickerIcon) $agentPickerIcon.className = 'codicon ' + current.icon;
        }
    }

    function renderModelPicker() {
        if (!$modelPickerDropdown) return;
        $modelPickerDropdown.innerHTML = '';

        // Auto option
        const autoOpt = document.createElement('div');
        autoOpt.className = `compose-picker-option${selectedModel === '' ? ' active' : ''}`;
        autoOpt.dataset.model = '';
        autoOpt.innerHTML = `<span class="compose-picker-option-label">Auto</span>`;
        $modelPickerDropdown.appendChild(autoOpt);

        if (availableModels.length > 0) {
            const sep = document.createElement('div');
            sep.className = 'compose-picker-separator';
            $modelPickerDropdown.appendChild(sep);

            for (const m of availableModels) {
                const opt = document.createElement('div');
                opt.className = `compose-picker-option${m.id === selectedModel ? ' active' : ''}`;
                opt.dataset.model = m.id;
                opt.innerHTML = `<span class="compose-picker-option-label">${esc(m.name)}</span>`;
                $modelPickerDropdown.appendChild(opt);
            }
        }

        // Update button label
        if (selectedModel) {
            const m = availableModels.find(m => m.id === selectedModel);
            $modelPickerLabel.textContent = m ? m.name : selectedModel;
        } else {
            $modelPickerLabel.textContent = 'Auto';
        }
    }

    /* ── Workspace (participant) Picker ────────────────────────────── */

    const workspaceOptions = [
        { id: '', label: 'Default', icon: 'codicon-comment' },
        { id: '@workspace', label: '@workspace', icon: 'codicon-folder' },
        { id: '@terminal', label: '@terminal', icon: 'codicon-terminal' },
        { id: '@vscode', label: '@vscode', icon: 'codicon-settings-gear' },
    ];

    function renderWorkspacePicker() {
        if (!$workspacePickerDropdown) return;
        $workspacePickerDropdown.innerHTML = '';

        for (const w of workspaceOptions) {
            const opt = document.createElement('div');
            opt.className = `compose-picker-option${w.id === settings.agent ? ' active' : ''}`;
            opt.dataset.workspace = w.id;
            opt.innerHTML = `<span class="codicon ${w.icon}"></span><span class="compose-picker-option-label">${esc(w.label)}</span>`;
            $workspacePickerDropdown.appendChild(opt);
        }

        const current = workspaceOptions.find(w => w.id === settings.agent) || workspaceOptions[1];
        if ($workspacePickerLabel) $workspacePickerLabel.textContent = current.label;
    }

    /* ── Approvals Picker ──────────────────────────────────────────── */

    const approvalsOptions = [
        { id: 'confirm', label: 'Confirm', icon: 'codicon-shield', desc: 'Ask before applying changes' },
        { id: 'auto', label: 'Auto-approve', icon: 'codicon-check-all', desc: 'Apply changes automatically' },
    ];

    function renderApprovalsPicker() {
        if (!$approvalsPickerDropdown) return;
        $approvalsPickerDropdown.innerHTML = '';

        for (const a of approvalsOptions) {
            const opt = document.createElement('div');
            opt.className = `compose-picker-option${a.id === settings.approvalMode ? ' active' : ''}`;
            opt.dataset.approval = a.id;
            opt.innerHTML = `<span class="codicon ${a.icon}"></span><span class="compose-picker-option-label">${esc(a.label)}</span><span class="compose-picker-option-meta">${esc(a.desc)}</span>`;
            $approvalsPickerDropdown.appendChild(opt);
        }

        const current = approvalsOptions.find(a => a.id === settings.approvalMode) || approvalsOptions[0];
        if ($approvalsPickerLabel) $approvalsPickerLabel.textContent = current.label;
    }

    /* ── Auto-delete Sessions Picker ────────────────────────────────── */

    const autodeleteOptions = [
        { id: 'never', label: 'Never', icon: 'codicon-circle-slash', desc: 'Keep all sessions' },
        { id: 'done', label: 'When done', icon: 'codicon-check', desc: 'Delete session once resolved' },
        { id: '5min', label: 'After 5 min', icon: 'codicon-clock', desc: 'Delete 5 min after resolution' },
    ];

    function renderAutodeletePicker() {
        if (!$autodeletePickerDropdown) return;
        $autodeletePickerDropdown.innerHTML = '';

        for (const a of autodeleteOptions) {
            const opt = document.createElement('div');
            opt.className = `compose-picker-option${a.id === settings.autoDeleteSession ? ' active' : ''}`;
            opt.dataset.autodelete = a.id;
            opt.innerHTML = `<span class="codicon ${a.icon}"></span><span class="compose-picker-option-label">${esc(a.label)}</span><span class="compose-picker-option-meta">${esc(a.desc)}</span>`;
            $autodeletePickerDropdown.appendChild(opt);
        }

        const current = autodeleteOptions.find(a => a.id === settings.autoDeleteSession) || autodeleteOptions[0];
        if ($autodeletePickerLabel) $autodeletePickerLabel.textContent = current.label;
    }

    /* ── Session Mode Picker ─────────────────────────────────────── */

    const sessionOptions = [
        { id: 'new', label: 'New session', icon: 'codicon-window', desc: 'Open a new chat session' },
        { id: 'active', label: 'Active session', icon: 'codicon-comment-discussion', desc: 'Send into the current chat' },
    ];

    function renderSessionPicker() {
        if (!$sessionPickerDropdown) return;
        $sessionPickerDropdown.innerHTML = '';

        for (const s of sessionOptions) {
            const opt = document.createElement('div');
            opt.className = `compose-picker-option${s.id === settings.sessionMode ? ' active' : ''}`;
            opt.dataset.session = s.id;
            opt.innerHTML = `<span class="codicon ${s.icon}"></span><span class="compose-picker-option-label">${esc(s.label)}</span><span class="compose-picker-option-meta">${esc(s.desc)}</span>`;
            $sessionPickerDropdown.appendChild(opt);
        }

        const current = sessionOptions.find(s => s.id === settings.sessionMode) || sessionOptions[0];
        if ($sessionPickerLabel) $sessionPickerLabel.textContent = current.label;
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Layout (responsive + sash resize)
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    function checkLayout() {
        const width = $viewpane.offsetWidth;
        if (width < 400) {
            $viewpane.classList.add('single-column');
        } else {
            $viewpane.classList.remove('single-column');
        }
    }

    // Sash drag resize
    $sash.addEventListener('mousedown', (e) => {
        e.preventDefault();
        sashDragging = true;
        $sash.classList.add('active');
        document.addEventListener('mousemove', onSashDrag);
        document.addEventListener('mouseup', onSashDragEnd);
    });

    function onSashDrag(/** @type {MouseEvent} */ e) {
        if (!sashDragging) return;
        const vpRect = $viewpane.getBoundingClientRect();
        const newWidth = vpRect.right - e.clientX;
        sidebarWidth = Math.max(180, Math.min(400, newWidth));
        $sidebar.style.width = sidebarWidth + 'px';
    }

    function onSashDragEnd() {
        sashDragging = false;
        $sash.classList.remove('active');
        document.removeEventListener('mousemove', onSashDrag);
        document.removeEventListener('mouseup', onSashDragEnd);
    }

    new ResizeObserver(() => checkLayout()).observe($viewpane);

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Context Menu
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    /**
     * @param {number} x
     * @param {number} y
     * @param {import('../src/types').WatcherConfig} w
     */
    function showContextMenu(x, y, w) {
        const isPinned = pinnedWatcherIds.has(w.id);

        $contextMenu.innerHTML = `
            <div class="context-menu-item" data-ctx-action="toggle" data-id="${w.id}">
                <span class="codicon ${w.enabled ? 'codicon-debug-pause' : 'codicon-play'}"></span>
                ${w.enabled ? 'Pause' : 'Resume'}
            </div>
            <div class="context-menu-item" data-ctx-action="pin" data-id="${w.id}">
                <span class="codicon ${isPinned ? 'codicon-pinned' : 'codicon-pin'}"></span>
                ${isPinned ? 'Unpin' : 'Pin'}
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-ctx-action="open-log" data-id="${w.id}">
                <span class="codicon codicon-file-code"></span>
                Open Log File
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-ctx-action="remove" data-id="${w.id}">
                <span class="codicon codicon-trash"></span>
                Remove
            </div>`;

        $contextMenu.style.left = x + 'px';
        $contextMenu.style.top = y + 'px';
        $contextMenu.classList.add('visible');
    }

    function hideContextMenu() {
        $contextMenu.classList.remove('visible');
    }

    document.addEventListener('click', () => hideContextMenu());

    $contextMenu.addEventListener('click', (e) => {
        const item = /** @type {HTMLElement} */ (e.target).closest('[data-ctx-action]');
        if (!item) return;

        const action = item.getAttribute('data-ctx-action');
        const id = item.getAttribute('data-id');

        switch (action) {
            case 'toggle':
                vscode.postMessage({ type: 'toggleWatcher', id });
                break;
            case 'pin': {
                if (pinnedWatcherIds.has(id)) {
                    pinnedWatcherIds.delete(id);
                } else {
                    pinnedWatcherIds.add(id);
                }
                vscode.postMessage({ type: 'updatePinned', ids: Array.from(pinnedWatcherIds) });
                renderWatchers();
                break;
            }
            case 'open-log':
                vscode.postMessage({ type: 'openLogFile', id });
                break;
            case 'remove':
                vscode.postMessage({ type: 'removeWatcher', id });
                break;
            case 'activate-all-section': {
                const section = item.getAttribute('data-section');
                const sectionWatchers = watchers.filter(w => getCategory(w) === section && !w.enabled);
                for (const w of sectionWatchers) {
                    vscode.postMessage({ type: 'toggleWatcher', id: w.id });
                }
                break;
            }
            case 'pause-all-section': {
                const section = item.getAttribute('data-section');
                const sectionWatchers = watchers.filter(w => getCategory(w) === section && w.enabled);
                for (const w of sectionWatchers) {
                    vscode.postMessage({ type: 'toggleWatcher', id: w.id });
                }
                break;
            }
        }
        hideContextMenu();
    });

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Event Handlers â€” Error Feed
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    $errorFeed.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);

        // Stack trace toggle
        const stackToggle = target.closest('.stack-toggle');
        if (stackToggle) {
            const container = stackToggle.closest('.error-stack-trace');
            if (container) {
                const isCollapsed = container.classList.toggle('collapsed');
                const icon = stackToggle.querySelector('.codicon');
                if (icon) {
                    icon.className = isCollapsed ? 'codicon codicon-chevron-right' : 'codicon codicon-chevron-down';
                }
                stackToggle.childNodes[stackToggle.childNodes.length - 1].textContent =
                    isCollapsed ? ' Show stack trace' : ' Hide stack trace';
            }
            return;
        }

        // File reference click
        const fileRef = target.closest('.error-context-file');
        if (fileRef) {
            const file = fileRef.getAttribute('data-file');
            const line = fileRef.getAttribute('data-line');
            if (file) {
                vscode.postMessage({ type: 'openFile', file, line: line ? parseInt(line, 10) : undefined });
            }
            return;
        }

        // Action button click
        const btn = target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        if (!id && action !== 'filter-source') return;

        switch (action) {
            case 'toggle-select':
                if (selectedErrorIds.has(id)) {
                    selectedErrorIds.delete(id);
                } else {
                    selectedErrorIds.add(id);
                }
                renderComposeChips();
                renderErrors();
                break;
            case 'send':
                vscode.postMessage({
                    type: 'sendError', id,
                    guidingPrompt: $promptInput?.value?.trim() || '',
                    mode: selectedMode || undefined,
                    model: selectedModel || undefined
                });
                break;
            case 'resolve':
                vscode.postMessage({ type: 'resolveError', id });
                break;
            case 'copy': {
                const err = errors.find(e => e.id === id);
                if (err) {
                    vscode.postMessage({ type: 'copyError', id });
                }
                break;
            }
            case 'toggle-code-fold': {
                const codeBox = btn.closest('.error-code-box');
                if (codeBox) codeBox.classList.toggle('expanded');
                break;
            }
            case 'dismiss':
                selectedErrorIds.delete(id);
                vscode.postMessage({ type: 'dismissError', id });
                break;
            case 'filter-source': {
                const watcherId = btn.getAttribute('data-watcher-id');
                if (watcherId) {
                    const newId = watcherId === selectedWatcherId ? null : watcherId;
                    vscode.postMessage({ type: 'selectWatcher', id: newId });
                }
                break;
            }
        }
    });

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Event Handlers â€” Watchers Sidebar
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    // Section collapse
    $watchersList.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        const sectionHeader = target.closest('.watcher-section-header');
        if (sectionHeader) {
            const section = sectionHeader.closest('.watcher-section');
            if (section) {
                const name = section.getAttribute('data-section') || '';
                section.classList.toggle('collapsed');
                if (section.classList.contains('collapsed')) {
                    collapsedSections.add(name);
                } else {
                    collapsedSections.delete(name);
                }
            }
            return;
        }

        // Watcher action buttons
        const btn = target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        if (!id) return;

        switch (action) {
            case 'toggle-watcher':
                vscode.postMessage({ type: 'toggleWatcher', id });
                break;
            case 'remove-watcher':
                vscode.postMessage({ type: 'removeWatcher', id });
                break;
        }
    });

    // Section header right-click — Activate all / Pause all
    $watchersList.addEventListener('contextmenu', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        const sectionHeader = target.closest('.watcher-section-header');
        if (!sectionHeader) return;

        e.preventDefault();
        const sectionEl = sectionHeader.closest('.watcher-section');
        if (!sectionEl) return;
        const sectionName = sectionEl.getAttribute('data-section') || '';

        $contextMenu.innerHTML = `
            <div class="context-menu-item" data-ctx-action="activate-all-section" data-section="${esc(sectionName)}">
                <span class="codicon codicon-play"></span>
                Activate all
            </div>
            <div class="context-menu-item" data-ctx-action="pause-all-section" data-section="${esc(sectionName)}">
                <span class="codicon codicon-debug-pause"></span>
                Pause all
            </div>`;

        $contextMenu.style.left = e.clientX + 'px';
        $contextMenu.style.top = e.clientY + 'px';
        $contextMenu.classList.add('visible');
    });

    // Toolbar: refresh
    $('watchers-refresh-btn')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'scanWorkspace' });
    });

    // Toolbar: search toggle
    $('watchers-search-btn')?.addEventListener('click', () => {
        const isHidden = $watcherSearchBar.classList.toggle('hidden');
        if (!isHidden) {
            $watcherSearchInput.focus();
        } else {
            watcherSearchQuery = '';
            $watcherSearchInput.value = '';
            renderWatchers();
        }
    });

    // Search input
    $watcherSearchInput?.addEventListener('input', () => {
        watcherSearchQuery = $watcherSearchInput.value;
        renderWatchers();
    });

    // Toolbar: hide sidebar
    $('watchers-hide-btn')?.addEventListener('click', () => {
        sidebarHidden = true;
        $sidebar.classList.add('hidden');
        syncSidebarToggle();
    });

    function syncSidebarToggle() {
        if ($feedTitleShowSidebar) {
            $feedTitleShowSidebar.style.display = sidebarHidden ? '' : 'none';
        }
    }

    // "Add Watcher" button
    $('watchers-new-btn')?.addEventListener('click', () => {
        resetAddForm();
        $addOverlay.classList.add('visible');
    });

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Event Handlers â€” Error Feed Title Bar
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    $('error-feed-title')?.addEventListener('click', (e) => {
        if (/** @type {HTMLElement} */ (e.target).closest('[data-action]')) return;
        if (/** @type {HTMLElement} */ (e.target).closest('#feed-title-show-sidebar')) return;
        // Toggle sidebar visibility if hidden
        if (sidebarHidden) {
            sidebarHidden = false;
            $sidebar.classList.remove('hidden');
            syncSidebarToggle();
        }
    });

    $feedTitleShowSidebar?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebarHidden = false;
        $sidebar.classList.remove('hidden');
        syncSidebarToggle();
    });

    $feedTitleClear?.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'selectWatcher', id: null });
    });

    /* ── Compose Box Event Handlers ──────────────────────────────── */

    function closeAllPickers() {
        $agentPickerDropdown?.classList.remove('open');
        $modelPickerDropdown?.classList.remove('open');
        $workspacePickerDropdown?.classList.remove('open');
        $approvalsPickerDropdown?.classList.remove('open');
        $autodeletePickerDropdown?.classList.remove('open');
        $sessionPickerDropdown?.classList.remove('open');
    }

    // Send button
    $composeSendBtn?.addEventListener('click', () => {
        doSend();
    });

    // Attach button — select all pending errors
    $composeAttachBtn?.addEventListener('click', () => {
        const pending = errors.filter(e => e.status === 'pending');
        if (pending.length === 0) return;
        for (const e of pending) selectedErrorIds.add(e.id);
        renderComposeChips();
        renderErrors();
    });

    // Chip dismiss
    $composeChips?.addEventListener('click', (e) => {
        const closeBtn = /** @type {HTMLElement} */ (e.target).closest('.compose-chip-close');
        if (!closeBtn) return;
        const id = closeBtn.getAttribute('data-chip-id');
        if (id) {
            selectedErrorIds.delete(id);
            renderComposeChips();
            renderErrors();
        }
    });

    // Agent picker
    $agentPickerBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = $agentPickerDropdown.classList.contains('open');
        closeAllPickers();
        if (!isOpen) $agentPickerDropdown.classList.add('open');
    });

    $agentPickerDropdown?.addEventListener('click', (e) => {
        e.stopPropagation();
        const opt = /** @type {HTMLElement} */ (e.target).closest('.compose-picker-option');
        if (!opt) return;
        const mode = opt.dataset.mode;
        if (mode !== undefined) {
            selectedMode = mode;
            vscode.postMessage({ type: 'updateSetting', key: 'chatMode', value: mode });
            renderAgentPicker();
        }
        closeAllPickers();
    });

    // Model picker
    $modelPickerBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = $modelPickerDropdown.classList.contains('open');
        closeAllPickers();
        if (!isOpen) $modelPickerDropdown.classList.add('open');
    });

    $modelPickerDropdown?.addEventListener('click', (e) => {
        e.stopPropagation();
        const opt = /** @type {HTMLElement} */ (e.target).closest('.compose-picker-option');
        if (!opt) return;
        const model = opt.dataset.model;
        if (model !== undefined) {
            selectedModel = model;
            vscode.postMessage({ type: 'updateSetting', key: 'chatModel', value: model });
            renderModelPicker();
        }
        closeAllPickers();
    });

    // Workspace picker
    $workspacePickerBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = $workspacePickerDropdown.classList.contains('open');
        closeAllPickers();
        if (!isOpen) $workspacePickerDropdown.classList.add('open');
    });

    $workspacePickerDropdown?.addEventListener('click', (e) => {
        e.stopPropagation();
        const opt = /** @type {HTMLElement} */ (e.target).closest('.compose-picker-option');
        if (!opt) return;
        const workspace = opt.dataset.workspace;
        if (workspace !== undefined) {
            settings.agent = workspace;
            vscode.postMessage({ type: 'updateSetting', key: 'agent', value: workspace });
            renderWorkspacePicker();
        }
        closeAllPickers();
    });

    // Approvals picker
    $approvalsPickerBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = $approvalsPickerDropdown.classList.contains('open');
        closeAllPickers();
        if (!isOpen) $approvalsPickerDropdown.classList.add('open');
    });

    $approvalsPickerDropdown?.addEventListener('click', (e) => {
        e.stopPropagation();
        const opt = /** @type {HTMLElement} */ (e.target).closest('.compose-picker-option');
        if (!opt) return;
        const approval = opt.dataset.approval;
        if (approval !== undefined) {
            settings.approvalMode = approval;
            vscode.postMessage({ type: 'updateSetting', key: 'approvalMode', value: approval });
            renderApprovalsPicker();
        }
        closeAllPickers();
    });

    // Auto-delete picker
    $autodeletPickerBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = $autodeletePickerDropdown.classList.contains('open');
        closeAllPickers();
        if (!isOpen) $autodeletePickerDropdown.classList.add('open');
    });

    $autodeletePickerDropdown?.addEventListener('click', (e) => {
        e.stopPropagation();
        const opt = /** @type {HTMLElement} */ (e.target).closest('.compose-picker-option');
        if (!opt) return;
        const autodelete = opt.dataset.autodelete;
        if (autodelete !== undefined) {
            settings.autoDeleteSession = autodelete;
            vscode.postMessage({ type: 'updateSetting', key: 'autoDeleteSession', value: autodelete });
            renderAutodeletePicker();
        }
        closeAllPickers();
    });

    // Session mode picker
    $sessionPickerBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = $sessionPickerDropdown.classList.contains('open');
        closeAllPickers();
        if (!isOpen) $sessionPickerDropdown.classList.add('open');
    });

    $sessionPickerDropdown?.addEventListener('click', (e) => {
        e.stopPropagation();
        const opt = /** @type {HTMLElement} */ (e.target).closest('.compose-picker-option');
        if (!opt) return;
        const session = opt.dataset.session;
        if (session !== undefined) {
            settings.sessionMode = session;
            vscode.postMessage({ type: 'updateSetting', key: 'sessionMode', value: session });
            renderSessionPicker();
        }
        closeAllPickers();
    });

    // Close pickers on outside click
    document.addEventListener('click', () => {
        closeAllPickers();
    });

    // Auto-grow textarea
    $promptInput?.addEventListener('input', () => {
        $promptInput.style.height = 'auto';
        $promptInput.style.height = Math.min($promptInput.scrollHeight, 120) + 'px';
    });

    // Ctrl+Enter sends
    $promptInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            doSend();
        }
    });

    function doSend() {
        const guidingPrompt = $promptInput?.value?.trim() || '';
        const mode = selectedMode || undefined;
        const model = selectedModel || undefined;
        const newSession = settings.sessionMode !== 'active';

        if (selectedErrorIds.size > 0) {
            vscode.postMessage({
                type: 'sendSelectedErrors',
                ids: Array.from(selectedErrorIds),
                guidingPrompt,
                mode,
                model,
                newSession
            });
            selectedErrorIds.clear();
            if ($promptInput) $promptInput.value = '';
            renderComposeChips();
            renderErrors();
        } else {
            vscode.postMessage({ type: 'sendAllPending', guidingPrompt, mode, model, newSession });
            if ($promptInput) $promptInput.value = '';
        }
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Event Handlers â€” Empty State
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    $('empty-scan-btn')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'scanWorkspace' });
    });

    $('empty-add-btn')?.addEventListener('click', () => {
        resetAddForm();
        $addOverlay.classList.add('visible');
    });

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Event Handlers â€” Add Watcher Overlay
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    $('close-add-watcher')?.addEventListener('click', () => {
        $addOverlay.classList.remove('visible');
    });

    $('cancel-add-watcher')?.addEventListener('click', () => {
        $addOverlay.classList.remove('visible');
    });

    $addOverlay?.addEventListener('click', (e) => {
        if (e.target === $addOverlay) $addOverlay.classList.remove('visible');
    });

    // Escape key closes overlay
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && $addOverlay.classList.contains('visible')) {
            $addOverlay.classList.remove('visible');
        }
    });

    $watcherType?.addEventListener('change', () => {
        const t = $watcherType.value;
        if (t === 'process') {
            $watcherPathLabel.textContent = 'Terminal Name Pattern';
            $watcherPath.placeholder = 'e.g. Cloud* or Studio*';
        } else if (t === 'web') {
            $watcherPathLabel.textContent = 'URL Pattern';
            $watcherPath.placeholder = 'e.g. localhost:* or *.bitinglip.com';
        } else {
            $watcherPathLabel.textContent = 'File Path';
            $watcherPath.placeholder = 'e.g. logs/app.log';
        }
    });

    $watcherPreset?.addEventListener('change', () => {
        const key = $watcherPreset.value;
        if (key && presets[key]) {
            $watcherPatterns.value = presets[key].join('\n');
        }
    });

    $watcherForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $watcherNameInput.value.trim();
        const type = $watcherType.value;
        const path = $watcherPath.value.trim();
        const patterns = $watcherPatterns.value.split('\n').map(l => l.trim()).filter(Boolean);

        if (!name || !path) return;

        vscode.postMessage({
            type: 'addWatcher',
            config: { name, type, path, errorPatterns: patterns },
        });

        $addOverlay.classList.remove('visible');
    });

    function resetAddForm() {
        $watcherNameInput.value = '';
        $watcherType.value = 'file';
        $watcherPath.value = '';
        $watcherPathLabel.textContent = 'File Path';
        $watcherPath.placeholder = 'e.g. logs/app.log';
        $watcherPreset.value = '';
        $watcherPatterns.value = '';
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Message Handling (from extension)
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
            case 'state': {
                const data = msg.data;
                errors = data.errors || [];
                watchers = data.watchers || [];
                selectedWatcherId = data.selectedWatcherId;
                settings.agent = data.agent || '';
                settings.autoTrigger = data.autoTrigger || false;
                settings.debounceMs = data.debounceMs || 3000;
                settings.approvalMode = data.approvalMode || 'confirm';
                settings.autoDeleteSession = data.autoDeleteSession || 'never';
                settings.sessionMode = data.sessionMode || 'new';
                if (data.chatMode) selectedMode = data.chatMode;
                if (data.chatModel !== undefined) selectedModel = data.chatModel;
                if (data.pinnedWatcherIds) {
                    pinnedWatcherIds = new Set(data.pinnedWatcherIds);
                }
                render();
                break;
            }
            case 'presets': {
                presets = msg.data || {};
                populatePresets();
                break;
            }
            case 'showAddWatcher': {
                resetAddForm();
                $addOverlay.classList.add('visible');
                break;
            }
            case 'toggleSidebar': {
                sidebarHidden = !sidebarHidden;
                $sidebar.classList.toggle('hidden', sidebarHidden);
                syncSidebarToggle();
                break;
            }
            case 'agents': {
                const data = msg.data || {};
                chatModes = data.modes || [];
                customAgents = data.agents || [];
                if (!selectedMode && chatModes.length > 0) {
                    selectedMode = chatModes[0].id;
                }
                renderAgentPicker();
                break;
            }
            case 'models': {
                availableModels = msg.data || [];
                renderModelPicker();
                break;
            }
        }
    });

    function populatePresets() {
        while ($watcherPreset.options.length > 1) {
            $watcherPreset.remove(1);
        }
        for (const key of Object.keys(presets)) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = key;
            $watcherPreset.appendChild(opt);
        }
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Helpers
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    /**
     * @param {number} ts
     * @returns {string}
     */
    function formatRelativeTime(ts) {
        const seconds = Math.floor((Date.now() - ts) / 1000);
        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return new Date(ts).toLocaleDateString();
    }

    /**
     * @param {string} str
     * @returns {string}
     */
    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * @param {import('../src/types').ErrorEntry} err
     * @returns {{ file: string; line?: number }[]}
     */
    function extractFileRefs(err) {
        const refs = [];
        if (err.file) {
            refs.push({ file: err.file, line: err.line });
        }
        // Also try to extract from stack trace
        if (err.stackTrace) {
            // .NET: in <file>:line <number>
            const dotnet = /in (.+):line (\d+)/g;
            let m;
            while ((m = dotnet.exec(err.stackTrace)) !== null) {
                refs.push({ file: m[1], line: parseInt(m[2], 10) });
            }
            // Node/Python: (<file>:<line>:<col>)
            const node = /\(([^)]+):(\d+):\d+\)/g;
            while ((m = node.exec(err.stackTrace)) !== null) {
                refs.push({ file: m[1], line: parseInt(m[2], 10) });
            }
        }
        // Deduplicate
        const seen = new Set();
        return refs.filter(r => {
            const key = `${r.file}:${r.line || 0}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       Init
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    vscode.postMessage({ type: 'ready' });
})();
// @ts-check
/// <reference lib="dom" />
