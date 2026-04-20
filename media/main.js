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
    // Severity filter state (global = watcher sidebar, local = error feed header)
    let globalFilterErrors = true;
    let globalFilterWarnings = true;
    let localFilterErrors = true;
    let localFilterWarnings = true;
    let sidebarHidden = false;
    let sashDragging = false;
    let sidebarWidth = 220;
    /** @type {Set<string>} group keys that are expanded to show member processes */
    let expandedGroups = new Set();

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

    /* ── Status Config (single source of truth) ── */
    const STATUS = {
        todo: {
            warning:  { icon: 'codicon-warning',        cls: 'status-warning' },
            error:    { icon: 'codicon-error',           cls: 'status-error' },
            sent:     { icon: 'codicon-arrow-circle-up', cls: 'status-sent' },
            working:  { icon: 'codicon-copilot',         cls: 'status-working' },
            attention:{ icon: 'codicon-copilot',         cls: 'status-attention' },
            resolved: { icon: 'codicon-pass',            cls: 'status-resolved' },
            pending:  { icon: 'codicon-circle',          cls: 'status-pending' },
        },
        errorFeed: {
            warning:  { icon: 'codicon-warning',         cls: 'status-warning' },
            error:    { icon: 'codicon-error',            cls: 'status-error' },
            sent:     { icon: 'codicon-arrow-circle-up',  cls: 'status-sent' },
            working:  { icon: 'codicon-copilot',          cls: 'status-working' },
            attention:{ icon: 'codicon-copilot',          cls: 'status-attention' },
            resolved: { icon: 'codicon-pass',             cls: 'status-resolved' },
        },
        watcher: {
            paused:    { icon: 'codicon-circle-small-filled',  cls: 'status-paused' },
            idle:      { icon: 'codicon-record-small',         cls: 'status-active' },
            warning:   { icon: 'codicon-warning',              cls: 'status-warning' },
            error:     { icon: 'codicon-error',                cls: 'status-error' },
            working:   { icon: 'codicon-session-in-progress',  cls: 'status-active' },
            connError: { icon: 'codicon-circle-slash',         cls: 'status-error' },
        },
    };


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

    // Todo List
    const $todoList = /** @type {HTMLElement} */ ($('todo-list'));
    const $todoListHeader = /** @type {HTMLElement} */ ($('todo-list-header'));
    const $todoListChevron = /** @type {HTMLElement} */ ($('todo-list-chevron'));
    const $todoListTitle = /** @type {HTMLElement} */ ($('todo-list-title'));
    const $todoListCount = /** @type {HTMLElement} */ ($('todo-list-count'));
    const $todoListItems = /** @type {HTMLElement} */ ($('todo-list-items'));
    const $todoListClear = /** @type {HTMLElement} */ ($('todo-list-clear'));
    const $todoListCollapsedPreview = /** @type {HTMLElement} */ ($('todo-list-collapsed-preview'));
    let todoCollapsed = true;
    /** @type {Map<string, number>} resolved error id → timeout handle */
    const resolvedTimers = new Map();

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

    // Global filter bar (watcher sidebar bottom)
    const $filterBar = /** @type {HTMLElement} */ ($('watchers-filter-bar'));
    const $filterToggleErrors = /** @type {HTMLElement} */ ($('filter-toggle-errors'));
    const $filterToggleWarnings = /** @type {HTMLElement} */ ($('filter-toggle-warnings'));
    const $filterCountErrors = /** @type {HTMLElement} */ ($('filter-count-errors'));
    const $filterCountWarnings = /** @type {HTMLElement} */ ($('filter-count-warnings'));

    // Feed title count elements
    const $feedCountWarnings = /** @type {HTMLElement} */ ($('feed-count-warnings'));
    const $feedCountErrors = /** @type {HTMLElement} */ ($('feed-count-errors'));
    const $feedTitleDelete = /** @type {HTMLElement} */ ($('feed-title-delete'));

    // Error feed sections
    const FEED_SECTIONS = [
        { key: 'solved', label: 'Solved', statuses: ['resolved'] },
        { key: 'new',    label: 'New',    statuses: ['pending'] },
        { key: 'active', label: 'Active', statuses: ['sent', 'sending', 'working', 'attention', 'error'] },
    ];
    const feedSectionCollapsed = { new: false, active: false, solved: true };
    /** @type {Map<string, string>} error id → section key (for move animations) */
    let prevErrorSections = new Map();

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

    function renderFilterBar() {
        // Global counts (all watchers)
        const allWarnings = errors.filter(e => e.severity === 'warning').length;
        const allErrors = errors.filter(e => !e.severity || e.severity === 'error').length;
        $filterCountErrors.textContent = String(allErrors);
        $filterCountWarnings.textContent = String(allWarnings);

        // Visual toggle state
        $filterToggleErrors.classList.toggle('active', globalFilterErrors);
        $filterToggleErrors.classList.toggle('inactive', !globalFilterErrors);
        $filterToggleWarnings.classList.toggle('active', globalFilterWarnings);
        $filterToggleWarnings.classList.toggle('inactive', !globalFilterWarnings);
    }

    function render() {
        renderFeedTitle();
        renderFilterBar();
        renderTodoList();
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
        if (selectedWatcherId) {
            const w = watchers.find(w => w.id === selectedWatcherId);
            $feedTitleLabel.textContent = w ? w.name.toUpperCase() : 'UNKNOWN WATCHER';
            if ($feedTitleClear) $feedTitleClear.style.display = '';
        } else {
            $feedTitleLabel.textContent = 'ALL ERRORS';
            if ($feedTitleClear) $feedTitleClear.style.display = 'none';
        }

        // Local filter toggle visual state
        $feedCountWarnings.classList.toggle('inactive', !localFilterWarnings);
        $feedCountErrors.classList.toggle('inactive', !localFilterErrors);

        // Show/hide feed-level trash icon
        const filtered = getFilteredErrors();
        if ($feedTitleDelete) {
            $feedTitleDelete.style.display = filtered.length ? '' : 'none';
        }
    }

    /* â”€â”€ Error Feed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

        /* -- Todo List ------------------------------------------------- */

    function renderTodoList() {
        if (!$todoList || !$todoListItems) return;

        const allActive = watchers.filter(w => w.enabled !== false);
        const relevantWatchers = selectedWatcherId
            ? allActive.filter(w => w.id === selectedWatcherId)
            : allActive;

        /** @type {Array<{id: string, icon: string, iconClass: string, label: string}>} */
        const items = [];

        // 1. Active watcher = "Watching" row (scoped to selection)
        if (relevantWatchers.length > 0) {
            const label = relevantWatchers.length === 1
                ? `Watching ${relevantWatchers[0].name}`
                : `Watching ${relevantWatchers.length} sources`;
            items.push({ id: '_watching', icon: STATUS.watcher.working.icon, iconClass: STATUS.watcher.working.cls, label });
        }

        // 2. Errors by status (scoped to selection)
        const todoFilterIds = getSelectedFilterIds();
        const filtered = todoFilterIds.length > 0
            ? errors.filter(e => todoFilterIds.includes(e.watcherId))
            : errors;

        for (const err of filtered) {
            const short = (err.message || err.source || err.id).substring(0, 80);

            if (err.status === 'resolved') {
                const s = STATUS.todo.resolved;
                items.push({ id: err.id, icon: s.icon, iconClass: s.cls, label: short });
                if (!resolvedTimers.has(err.id)) {
                    const handle = window.setTimeout(() => {
                        resolvedTimers.delete(err.id);
                        renderTodoList();
                    }, 5 * 60 * 1000);
                    resolvedTimers.set(err.id, handle);
                }
            } else if (err.status === 'working') {
                const s = STATUS.todo.working;
                items.push({ id: err.id, icon: s.icon, iconClass: s.cls, label: short });
            } else if (err.status === 'attention') {
                const s = STATUS.todo.attention;
                items.push({ id: err.id, icon: s.icon, iconClass: s.cls, label: short });
            } else if (err.status === 'error') {
                const s = STATUS.todo.error;
                items.push({ id: err.id, icon: s.icon, iconClass: s.cls, label: short });
            } else if (err.status === 'sent' || err.status === 'sending') {
                const s = STATUS.todo.sent;
                items.push({ id: err.id, icon: s.icon, iconClass: s.cls, label: short });
            } else {
                const s = err.severity === 'error' ? STATUS.todo.error : STATUS.todo.warning;
                items.push({ id: err.id, icon: s.icon, iconClass: s.cls, label: short });
            }
        }

        // Clean up timers for errors no longer resolved
        const resolvedIds = new Set(filtered.filter(e => e.status === 'resolved').map(e => e.id));
        for (const [id, handle] of resolvedTimers) {
            if (!resolvedIds.has(id)) {
                clearTimeout(handle);
                resolvedTimers.delete(id);
            }
        }

        // Filter out expired resolved items
        const displayItems = items.filter(item => {
            if (item.iconClass === STATUS.todo.resolved.cls && !resolvedTimers.has(item.id)) return false;
            return true;
        });

        if (displayItems.length === 0) {
            $todoList.classList.add('hidden');
            return;
        }
        $todoList.classList.remove('hidden');

        // Completion count: resolved out of total error items (exclude session item)
        const errorItems = displayItems.filter(i => i.id !== '_watching');
        const doneCount = errorItems.filter(i => i.iconClass === STATUS.todo.resolved.cls).length;
        $todoListCount.textContent = doneCount > 0
            ? `(${doneCount}/${errorItems.length})`
            : `(${errorItems.length})`;

        // Collapsed preview: show session item inline
        const sessionItem = displayItems.find(i => i.id === '_watching');
        if ($todoListCollapsedPreview) {
            if (sessionItem) {
                $todoListCollapsedPreview.innerHTML =
                    `<span class="todo-preview-icon ${sessionItem.iconClass}"><span class="codicon ${sessionItem.icon}"></span></span>` +
                    `<span>${esc(sessionItem.label)}</span>`;
            } else {
                const first = displayItems[0];
                $todoListCollapsedPreview.innerHTML =
                    `<span class="todo-preview-icon ${first.iconClass}"><span class="codicon ${first.icon}"></span></span>` +
                    `<span>${esc(first.label)}</span>`;
            }
        }

        if (todoCollapsed) {
            $todoList.classList.add('collapsed');
        } else {
            $todoList.classList.remove('collapsed');
        }

        $todoListItems.innerHTML = displayItems.map(item => {
            const clickable = item.id !== '_watching' && ['sent', 'working', 'attention', 'error'].includes(
                (errors.find(e => e.id === item.id) || {}).status || '');
            return `
            <div class="todo-item${clickable ? ' clickable' : ''}" data-id="${esc(item.id)}">
                <span class="todo-item-icon ${item.iconClass}"><span class="codicon ${item.icon}"></span></span>
                <span class="todo-item-label">${esc(item.label)}</span>
            </div>`;
        }).join('');
    }

    // Todo item click — open the agent session for this error
    $todoListItems?.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        const todoItem = target.closest('.todo-item.clickable');
        if (!todoItem) return;
        const id = todoItem.getAttribute('data-id');
        if (id) {
            vscode.postMessage({ type: 'openAgentSession', id });
        }
    });

    $todoListHeader?.addEventListener('click', (e) => {
        if (e.target.closest('.todo-list-clear')) return;
        todoCollapsed = !todoCollapsed;
        renderTodoList();
    });

    $todoListClear?.addEventListener('click', (e) => {
        e.stopPropagation();
        // Clear all resolved/sent/pending errors but keep watching (session) items
        for (const [id, handle] of resolvedTimers) {
            clearTimeout(handle);
        }
        resolvedTimers.clear();
        renderTodoList();
    });

    /** Returns filtered errors based on watcher selection + severity filters */
    function getFilteredErrors() {
        const filterIds = getSelectedFilterIds();
        let filtered = filterIds.length > 0
            ? errors.filter(e => filterIds.includes(e.watcherId))
            : errors;
        filtered = filtered.filter(e => {
            const sev = e.severity || 'error';
            if (sev === 'error' && (!globalFilterErrors || !localFilterErrors)) return false;
            if (sev === 'warning' && (!globalFilterWarnings || !localFilterWarnings)) return false;
            return true;
        });
        return filtered;
    }

    function renderErrors() {
        const filtered = getFilteredErrors();

        // ── Bucket errors into sections ──
        /** @type {Record<string, typeof errors>} */
        const buckets = {};
        for (const sec of FEED_SECTIONS) buckets[sec.key] = [];

        for (const err of filtered) {
            const sec = FEED_SECTIONS.find(s => s.statuses.includes(err.status || 'pending'));
            buckets[(sec || FEED_SECTIONS[0]).key].push(err);
        }

        // ── Remove old top-level cards (leftover from pre-section render) ──
        $errorFeed.querySelectorAll(':scope > .error-item-container').forEach(el => el.remove());

        // ── Empty state ──
        if (filtered.length === 0) {
            // Remove section containers
            $errorFeed.querySelectorAll('.error-feed-section').forEach(el => el.remove());
            $emptyState.classList.add('visible');
            prevErrorSections.clear();
            return;
        }
        $emptyState.classList.remove('visible');

        // ── Build / update each section ──
        /** @type {Map<string, string>} new map of error id → section key */
        const newSectionMap = new Map();

        for (const sec of FEED_SECTIONS) {
            const sectionErrors = buckets[sec.key];

            // Counts per severity
            const errCount = sectionErrors.filter(e => (e.severity || 'error') === 'error').length;
            const warnCount = sectionErrors.filter(e => e.severity === 'warning').length;

            // Find or create section container
            let $section = $errorFeed.querySelector(`.error-feed-section[data-section="${sec.key}"]`);
            if (!$section) {
                $section = document.createElement('div');
                $section.className = 'error-feed-section';
                $section.dataset.section = sec.key;
                if (feedSectionCollapsed[sec.key]) $section.classList.add('collapsed');
                $section.innerHTML = `
                    <div class="error-feed-section-header" data-action="toggle-section" data-section="${sec.key}">
                        <span class="error-feed-section-chevron"><span class="codicon codicon-chevron-down"></span></span>
                        <span class="error-feed-section-label">${sec.label}</span>
                        <span class="error-feed-section-counts"></span>
                    </div>
                    <div class="error-feed-section-list"></div>`;
                $errorFeed.appendChild($section);
            }

            // Update counts
            const $counts = $section.querySelector('.error-feed-section-counts');
            if ($counts) {
                let countsHtml = '';
                if (errCount > 0)  countsHtml += `<span class="error-feed-section-count count-err"><span class="codicon codicon-error"></span> ${errCount}</span>`;
                if (warnCount > 0) countsHtml += `<span class="error-feed-section-count count-warn"><span class="codicon codicon-warning"></span> ${warnCount}</span>`;
                $counts.innerHTML = countsHtml;
            }

            // Hide section if empty
            $section.style.display = sectionErrors.length === 0 ? 'none' : '';

            // ── Reconcile cards inside section list ──
            const $list = $section.querySelector('.error-feed-section-list');
            const existingCards = $list.querySelectorAll('.error-item-container');
            const existingMap = new Map();
            existingCards.forEach(el => existingMap.set(el.dataset.id, el));

            const wantedIds = new Set(sectionErrors.map(e => e.id));

            // Remove cards no longer in this section
            existingCards.forEach(el => {
                if (!wantedIds.has(el.dataset.id)) el.remove();
            });

            // Insert / update cards in order
            let prevNode = null;
            for (const err of sectionErrors) {
                newSectionMap.set(err.id, sec.key);
                const existing = existingMap.get(err.id);
                if (existing) {
                    updateErrorCard(existing, err);
                    // Ensure correct order
                    if (prevNode && prevNode.nextSibling !== existing) {
                        prevNode.after(existing);
                    }
                    prevNode = existing;
                } else {
                    const card = createErrorItem(err);
                    // Animate: slide-in for genuinely new, fade for section-move
                    const prevSec = prevErrorSections.get(err.id);
                    if (prevSec && prevSec !== sec.key) {
                        card.classList.add('error-new');
                    } else if (!prevSec) {
                        card.classList.add('error-new');
                    }
                    card.addEventListener('animationend', () => card.classList.remove('error-new'), { once: true });

                    if (prevNode && prevNode.nextSibling) {
                        $list.insertBefore(card, prevNode.nextSibling);
                    } else if (prevNode) {
                        prevNode.after(card);
                    } else {
                        $list.prepend(card);
                    }

                    // Detect real overflow after DOM insertion
                    requestAnimationFrame(() => {
                        const content = card.querySelector('.error-code-content');
                        const box = card.querySelector('.error-code-box');
                        if (content && box && content.scrollHeight > content.clientHeight) {
                            box.classList.add('overflows');
                        }
                    });
                    prevNode = card;
                }
            }
        }

        // Remove sections that no longer exist in config (safety)
        $errorFeed.querySelectorAll('.error-feed-section').forEach(el => {
            if (!FEED_SECTIONS.some(s => s.key === el.dataset.section)) el.remove();
        });

        prevErrorSections = newSectionMap;
    }

    /** Update an existing error card in-place */
    function updateErrorCard(card, err) {
        const isChip = selectedErrorIds.has(err.id);
        card.className = `error-item-container ${err.status}${isChip ? ' chip-selected' : ''}`;

        // Update the .error-code-type sidebar (always severity icon, never status)
        const typeEl = card.querySelector('.error-code-type');
        if (typeEl) {
            const sevClass = err.severity === 'error' ? 'severity-error' : 'severity-warning';
            typeEl.className = `error-code-type ${sevClass}`;
            const typeIconSpan = typeEl.querySelector('.codicon');
            if (typeIconSpan) {
                typeIconSpan.className = `codicon ${err.severity === 'error' ? 'codicon-error' : 'codicon-warning'}`;
            }
        }

        // Update the header status icon (this one tracks status)
        const headerStatusIcon = card.querySelector('.error-status-icon');
        if (headerStatusIcon) {
            headerStatusIcon.className = `error-status-icon ${statusIconClass(err)}`;
            const iconSpan = headerStatusIcon.querySelector('.codicon');
            if (iconSpan) {
                iconSpan.className = `codicon ${statusIconForType(err)}`;
            }
        }

        // Update occurrence count
        const countEl = card.querySelector('.error-code-type-count');
        if (countEl) {
            const count = err.occurrences || 1;
            if (count > 1) {
                if (countEl.textContent !== String(count)) {
                    countEl.textContent = count;
                    countEl.classList.remove('pulse');
                    void countEl.offsetWidth;
                    countEl.classList.add('pulse');
                }
                countEl.style.display = '';
            } else {
                countEl.style.display = 'none';
            }
        }

        // Update .error-source status class
        const source = card.querySelector('.error-source');
        if (source) {
            source.className = source.className.replace(/\bstatus-\S+/g, '');
            source.classList.add('error-source', statusIconClass(err));
        }

        // Update inline status label
        const inlineStatus = card.querySelector('.error-status-inline');
        if (err.status !== 'pending') {
            if (inlineStatus) {
                inlineStatus.className = `error-status-inline ${err.status}`;
                inlineStatus.textContent = statusLabel(err.status);
            } else {
                const span = document.createElement('span');
                span.className = `error-status-inline ${err.status}`;
                span.textContent = statusLabel(err.status);
                const ts = card.querySelector('.error-timestamp');
                if (ts) ts.after(span);
            }
        } else if (inlineStatus) {
            inlineStatus.remove();
        }
    }

    /** Returns the CSS class for the type sidebar based on error status */
    function statusIconClass(err) {
        switch (err.status) {
            case 'sending': return STATUS.errorFeed.sent.cls;
            case 'sent':    return STATUS.errorFeed.sent.cls;
            case 'working': return STATUS.errorFeed.working.cls;
            case 'attention': return STATUS.errorFeed.attention.cls;
            case 'resolved': return STATUS.errorFeed.resolved.cls;
            default:
                return err.severity === 'error' ? STATUS.errorFeed.error.cls : STATUS.errorFeed.warning.cls;
        }
    }

    /** Returns the codicon name for the type sidebar */
    function statusIconForType(err) {
        switch (err.status) {
            case 'sending': return 'codicon-loading codicon-modifier-spin';
            case 'sent':    return STATUS.errorFeed.sent.icon;
            case 'working': return STATUS.errorFeed.working.icon;
            case 'attention': return STATUS.errorFeed.attention.icon;
            case 'resolved': return STATUS.errorFeed.resolved.icon;
            default:
                return err.severity === 'error' ? 'codicon-error' : 'codicon-warning';
        }
    }

    /** Returns the inner HTML for the severity-icon based on status */
    function statusIconHtml(err, fallbackIcon) {
        switch (err.status) {
            case 'sending': return '<span class="codicon codicon-loading codicon-modifier-spin"></span>';
            case 'sent':    return `<span class="codicon ${STATUS.errorFeed.sent.icon}"></span>`;
            case 'working': return `<span class="codicon ${STATUS.errorFeed.working.icon}"></span>`;
            case 'attention': return `<span class="codicon ${STATUS.errorFeed.attention.icon}"></span>`;
            case 'resolved': return `<span class="codicon ${STATUS.errorFeed.resolved.icon}"></span>`;
            default:        return `<span class="codicon ${fallbackIcon}"></span>`;
        }
    }

    /** Returns a plain-text label for the status */
    function statusLabel(status) {
        switch (status) {
            case 'sending': return 'sending';
            case 'sent':    return 'sent';
            case 'working': return 'working';
            case 'attention': return 'attention';
            case 'error':   return 'error';
            case 'resolved': return 'fixed';
            default:        return status;
        }
    }

    /** Delete all errors in a given section */
    function deleteSectionErrors(sectionKey) {
        const sec = FEED_SECTIONS.find(s => s.key === sectionKey);
        if (!sec) return;
        const toRemove = errors.filter(e => sec.statuses.includes(e.status || 'pending')).map(e => e.id);
        if (toRemove.length === 0) return;
        toRemove.forEach(id => {
            vscode.postMessage({ type: 'dismissError', errorId: id });
        });
    }

    /** Delete all currently visible (filtered) errors */
    function deleteVisibleErrors() {
        const filtered = getFilteredErrors();
        if (filtered.length === 0) return;
        filtered.forEach(err => {
            vscode.postMessage({ type: 'dismissError', errorId: err.id });
        });
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

        const severityClass = err.severity === 'error' ? 'severity-error' : 'severity-warning';
        const severityIcon = err.severity === 'error' ? 'codicon-error' : 'codicon-warning';
        const timeStr = formatRelativeTime(err.timestamp);
        const fileLinks = extractFileRefs(err);
        const checkboxChecked = isChipSelected ? ' checked' : '';
        const hasOverflow = err.message.split('\n').length > 6;
        const count = err.occurrences || 1;

        el.innerHTML = `
            <div class="error-header">
                <button class="error-select-check${checkboxChecked}" data-action="toggle-select" data-id="${err.id}" title="Select error">
                    <span class="codicon codicon-check"></span>
                </button>
                <span class="error-status-icon ${statusIconClass(err)}"><span class="codicon ${statusIconForType(err)}"></span></span>
                <a class="error-source ${statusIconClass(err)}" data-action="filter-source" data-watcher-id="${err.watcherId}" title="Filter by ${esc(err.source)}">${esc(err.source)}</a>
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
                    <div class="error-code-type ${severityClass}">
                        <span class="codicon ${severityIcon}"></span>
                        <span class="error-code-type-count" style="${count > 1 ? '' : 'display:none'}">${count}</span>
                    </div>
                    <div class="error-code-main">
                        <button class="error-code-copy" data-action="copy" data-id="${err.id}" title="Copy"><span class="codicon codicon-copy"></span></button>
                        <div class="error-code-content">${esc(err.message)}</div>
                        <button class="error-code-unfold" data-action="toggle-code-fold" data-id="${err.id}">
                            <span class="codicon codicon-chevron-down"></span>
                        </button>
                    </div>
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
                    ${fileLinks.map(f => {
                        const basename = f.file.replace(/^.*[\\/]/, '');
                        return `<a class="error-context-file" data-file="${esc(f.file)}" data-line="${f.line || ''}" title="${esc(f.file)}${f.line ? ':' + f.line : ''}">
                            ${f.line ? `<span class="error-context-line-col">${f.line}</span>` : ''}<span class="error-context-name"><span class="error-context-path">${esc(basename)}</span></span>
                        </a>`;
                    }).join('')}
                </div>` : ''}
            </div>`;

        return el;
    }

    /* â”€â”€ Watchers Sidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    
    /**
     * Build the line-2 HTML for a process watcher showing its log state.
     * @param {import('../src/types').WatcherConfig} w
     * @returns {string}
     */
    function processLine2(w) {
        const pidStr = w.pid ? `PID ${w.pid}` : 'not running';
        if (!w.logFile) {
            return `<span class="process-log-none">${pidStr} &middot; no log output</span>`;
        }
        const logName = w.logFile.replace(/\\/g, '/').split('/').pop() || w.logFile;
        if (w.logFileExists) {
            return `<span class="process-log-linked">${pidStr} &middot; ${esc(logName)}</span>`;
        }
        return `<span class="process-log-waiting">${pidStr} &middot; waiting for ${esc(logName)}</span>`;
    }

    /**
     * Group process watchers by shared logFile.
     * @param {import('../src/types').WatcherConfig[]} processWatchers
     * @returns {{ groups: Array<{groupKey: string, logFile: string, members: import('../src/types').WatcherConfig[]}>, ungrouped: import('../src/types').WatcherConfig[] }}
     */
    function groupProcessesByLog(processWatchers) {
        /** @type {Map<string, import('../src/types').WatcherConfig[]>} */
        const byLog = new Map();
        /** @type {import('../src/types').WatcherConfig[]} */
        const noLog = [];

        for (const w of processWatchers) {
            if (w.logFile) {
                const key = w.logFile.toLowerCase().replace(/\\/g, '/');
                if (!byLog.has(key)) byLog.set(key, []);
                byLog.get(key).push(w);
            } else {
                noLog.push(w);
            }
        }

        const groups = [];
        const ungrouped = [...noLog];

        for (const [key, members] of byLog.entries()) {
            if (members.length > 1) {
                const logFile = members[0].logFile;
                groups.push({ groupKey: `group:${key}`, logFile, members });
            } else {
                ungrouped.push(members[0]);
            }
        }

        return { groups, ungrouped };
    }

    /**
     * Resolve selectedWatcherId into an array of watcher IDs for error filtering.
     * If a group key is selected, returns all member IDs.
     * @returns {string[]}
     */
    function getSelectedFilterIds() {
        if (!selectedWatcherId) return [];
        if (selectedWatcherId.startsWith('group:')) {
            const processWatchers = watchers.filter(w => w.type === 'process' && !w.archived);
            const { groups } = groupProcessesByLog(processWatchers);
            const g = groups.find(g => g.groupKey === selectedWatcherId);
            return g ? g.members.map(m => m.id) : [];
        }
        return [selectedWatcherId];
    }

    /**
     * Create a group watcher card for multiple processes sharing a log file.
     * @param {{ groupKey: string, logFile: string, members: import('../src/types').WatcherConfig[] }} group
     * @returns {HTMLElement}
     */
    function createWatcherGroupItem(group) {
        const el = document.createElement('div');
        const isSelected = selectedWatcherId === group.groupKey;
        const isExpanded = expandedGroups.has(group.groupKey);
        el.className = `watcher-item watcher-group-item${isSelected ? ' selected' : ''}`;
        el.dataset.groupKey = group.groupKey;

        const memberIds = new Set(group.members.map(m => m.id));
        const groupErrors = errors.filter(e => memberIds.has(e.watcherId));
        const errCount = groupErrors.filter(e => e.status === 'pending' && (e.severity === 'error' || !e.severity)).length;
        const warnCount = groupErrors.filter(e => e.status === 'pending' && e.severity === 'warning').length;
        const anyEnabled = group.members.some(m => m.enabled);

        const logName = (group.logFile || '').replace(/\\/g, '/').split('/').pop() || 'Unknown';
        const title = logName.replace(/\.log$/i, '').split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

        const memberLabel = group.members.map(m => m.name).join(', ');

        const hasErrors = groupErrors.some(e => e.status === 'pending' && e.severity === 'error');
        const hasWarnings = groupErrors.some(e => e.status === 'pending' && e.severity === 'warning');
        let statusDef;
        if (!anyEnabled) statusDef = STATUS.watcher.paused;
        else if (hasErrors) statusDef = STATUS.watcher.error;
        else if (hasWarnings) statusDef = STATUS.watcher.warning;
        else statusDef = STATUS.watcher.idle;

        el.innerHTML = `
            <div class="watcher-line-1">
                <span class="watcher-status-icon ${statusDef.cls}"><span class="codicon ${statusDef.icon}"></span></span>
                <div class="watcher-name">${esc(title)}</div>
                <div class="watcher-item-actions">
                    <button class="icon-btn" data-action="toggle-group" data-group-key="${group.groupKey}" title="${anyEnabled ? 'Pause all' : 'Resume'}">
                        <span class="codicon ${anyEnabled ? 'codicon-debug-pause' : 'codicon-play'}"></span>
                    </button>
                    <button class="icon-btn" data-action="expand-group" data-group-key="${group.groupKey}" title="${isExpanded ? 'Collapse' : 'Expand'}">
                        <span class="codicon ${isExpanded ? 'codicon-chevron-up' : 'codicon-chevron-down'}"></span>
                    </button>
                </div>
            </div>
            <div class="watcher-line-2">
                <span class="watcher-group-badge">${group.members.length}</span> ${esc(memberLabel)}
            </div>
            <div class="watcher-line-3 ${errCount === 0 && warnCount === 0 ? 'zero' : ''}">
                ${warnCount > 0 ? '<span class="watcher-count-warn"><span class="codicon codicon-warning"></span> ' + warnCount + '</span>' : ''}
                ${errCount > 0 ? '<span class="watcher-count-err"><span class="codicon codicon-error"></span> ' + errCount + '</span>' : ''}
            </div>`;

        if (isExpanded) {
            const membersDiv = document.createElement('div');
            membersDiv.className = 'watcher-group-members';
            for (const m of group.members) {
                const mEl = document.createElement('div');
                mEl.className = 'watcher-group-member';
                mEl.innerHTML = `
                    <span class="codicon ${m.enabled ? 'codicon-circle-filled' : 'codicon-circle-outline'}"></span>
                    <span class="watcher-group-member-name">${esc(m.name)}</span>
                    <span class="watcher-group-member-pid">${m.pid ? 'PID ' + m.pid : ''}</span>`;
                membersDiv.appendChild(mEl);
            }
            el.appendChild(membersDiv);
        }

        el.addEventListener('click', (e) => {
            if (/** @type {HTMLElement} */ (e.target).closest('[data-action]')) return;
            const newId = group.groupKey === selectedWatcherId ? null : group.groupKey;
            vscode.postMessage({ type: 'selectWatcher', id: newId });
        });

        return el;
    }

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
            'Processes': 'codicon-terminal',
            'Terminals': 'codicon-terminal-cmd',
            'Web Console': 'codicon-globe',
            'Logs': 'codicon-output',
            'Archived': 'codicon-archive',
        };

        for (const [sectionName, sectionWatchers] of sections) {
            // Skip empty Pinned and Archived sections; always show Processes/Web/Logs
            if (sectionWatchers.length === 0 && (sectionName === 'Pinned' || sectionName === 'Archived')) continue;

            const sectionEl = document.createElement('div');
            sectionEl.className = `watcher-section${collapsedSections.has(sectionName) ? ' collapsed' : ''}`;
            sectionEl.dataset.section = sectionName;

            const icon = sectionIcons[sectionName] || 'codicon-list-unordered';

            // For Processes, count visible items (groups + ungrouped) instead of raw watcher count
            let displayCount = sectionWatchers.length;
            let pGroups, ungrouped;
            if (sectionName === 'Processes' && sectionWatchers.length > 0) {
                ({ groups: pGroups, ungrouped } = groupProcessesByLog(sectionWatchers));
                displayCount = pGroups.length + ungrouped.length;
            }

            sectionEl.innerHTML = `
                <div class="watcher-section-header">
                    <span class="watcher-section-label">${esc(sectionName)}</span>
                    <span class="watcher-section-count">${displayCount}</span>
                </div>
                <div class="watcher-section-list"></div>`;

            const listEl = sectionEl.querySelector('.watcher-section-list');

            if (sectionWatchers.length === 0) {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'watcher-section-empty';
                emptyEl.textContent = sectionName === 'Web Console' ? 'No browsers connected' : 'No watchers';
                listEl?.appendChild(emptyEl);
            } else if (sectionName === 'Processes') {
                // Groups already computed above for the count
                for (const g of pGroups) {
                    listEl?.appendChild(createWatcherGroupItem(g));
                }
                for (const w of ungrouped) {
                    listEl?.appendChild(createWatcherItem(w));
                }
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

        // Pinned first (only if any)
        const pinned = list.filter(w => pinnedWatcherIds.has(w.id) && !w.archived);
        if (pinned.length > 0) {
            groups.set('Pinned', pinned);
        }

        // Sections in order: Web Console, Terminals, Processes, Logs
        groups.set('Web Console', []);
        groups.set('Terminals', []);
        groups.set('Processes', []);
        groups.set('Logs', []);

        const nonSpecial = list.filter(w => !pinnedWatcherIds.has(w.id) && !w.archived);
        for (const w of nonSpecial) {
            const cat = getCategory(w);
            groups.get(cat)?.push(w);
        }

        // Archived last (only if any)
        const archived = list.filter(w => w.archived);
        if (archived.length > 0) {
            groups.set('Archived', archived);
        }

        return Array.from(groups.entries());
    }

    /**
     * @param {import('../src/types').WatcherConfig} w
     * @returns {string}
     */
    function getCategory(w) {
        if (w.type === 'terminal') return 'Terminals';
        if (w.type === 'file') return 'Logs';
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

        const watcherErrors = errors.filter(e => e.watcherId === w.id);
        const pendingCount = watcherErrors.filter(e => e.status === 'pending').length;
        const sendingCount = watcherErrors.filter(e => e.status === 'sent' || e.status === 'sending').length;
        const hasErrors = watcherErrors.some(e => e.status === 'pending' && e.severity === 'error');
        const hasWarnings = watcherErrors.some(e => e.status === 'pending' && e.severity === 'warning');
        const watcherErrorsCount = watcherErrors.filter(e => e.status === 'pending' && (e.severity === 'error' || !e.severity)).length;
        const watcherWarnings = watcherErrors.filter(e => e.status === 'pending' && e.severity === 'warning').length;

        let statusDef;
        if (!w.enabled) {
            statusDef = STATUS.watcher.paused;
        } else if (sendingCount > 0) {
            statusDef = STATUS.watcher.working;
        } else if (hasErrors) {
            statusDef = STATUS.watcher.error;
        } else if (hasWarnings) {
            statusDef = STATUS.watcher.warning;
        } else {
            statusDef = STATUS.watcher.idle;
        }

        el.innerHTML = `
            <div class="watcher-line-1">
                <span class="watcher-status-icon ${statusDef.cls}"><span class="codicon ${statusDef.icon}"></span></span>
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
                <div class="watcher-path">${w.type === 'process' ? processLine2(w) : esc(w.path)}</div>
            </div>
            <div class="watcher-line-3 ${pendingCount === 0 ? 'zero' : ''}">${watcherWarnings > 0 ? '<span class="watcher-count-warn"><span class="codicon codicon-warning"></span> ' + watcherWarnings + '</span>' : ''}${watcherErrorsCount > 0 ? '<span class="watcher-count-err"><span class="codicon codicon-error"></span> ' + watcherErrorsCount + '</span>' : ''}</div>`;

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
                opt.innerHTML = `<span class="compose-picker-icon-spacer"></span><span class="compose-picker-option-label">${esc(a.label)}</span>`;
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

            // Deduplicate by model name — prefer 'copilot' vendor when names collide
            const deduped = new Map();
            for (const m of availableModels) {
                const key = m.name.toLowerCase();
                const existing = deduped.get(key);
                if (!existing || m.vendor === 'copilot') {
                    deduped.set(key, m);
                }
            }
            const uniqueModels = [...deduped.values()];

            // Group by vendor
            const grouped = {};
            for (const m of uniqueModels) {
                const v = m.vendor || 'Other';
                if (!grouped[v]) grouped[v] = [];
                grouped[v].push(m);
            }

            for (const [vendor, models] of Object.entries(grouped)) {
                const section = document.createElement('div');
                section.className = 'compose-picker-section';
                section.textContent = vendor;
                $modelPickerDropdown.appendChild(section);

                for (const m of models) {
                    const opt = document.createElement('div');
                    opt.className = `compose-picker-option${m.id === selectedModel ? ' active' : ''}`;
                    opt.dataset.model = m.id;
                    const ctx = m.maxInputTokens ? formatTokenCount(m.maxInputTokens) : '';
                    const vendorMeta = m.vendor ? `<span class="compose-picker-option-meta">${esc(m.vendor)}</span>` : '';
                    opt.innerHTML = `<span class="compose-picker-option-label">${esc(m.name)}</span>`
                        + (ctx ? `<span class="compose-picker-option-meta">${ctx}</span>` : '')
                        + vendorMeta;
                    $modelPickerDropdown.appendChild(opt);
                }
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
        { id: '@workspace', label: 'Workspace', icon: 'codicon-folder' },
        { id: '@terminal', label: 'Terminal', icon: 'codicon-terminal' },
        { id: '@vscode', label: 'Vscode', icon: 'codicon-settings-gear' },
    ];

    function renderWorkspacePicker() {
        if (!$workspacePickerDropdown) return;
        $workspacePickerDropdown.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'compose-picker-section';
        header.textContent = 'Where watchers are active';
        $workspacePickerDropdown.appendChild(header);

        for (const w of workspaceOptions) {
            const opt = document.createElement('div');
            opt.className = `compose-picker-option${w.id === settings.agent ? ' active' : ''}`;
            opt.dataset.workspace = w.id;
            opt.innerHTML = `<span class="codicon ${w.icon}"></span><span class="compose-picker-option-label">${esc(w.label)}</span>`;
            $workspacePickerDropdown.appendChild(opt);
        }

        const current = workspaceOptions.find(w => w.id === settings.agent) || workspaceOptions[0];
        if ($workspacePickerLabel) $workspacePickerLabel.textContent = current.label;
    }

    /* ── Approvals Picker ──────────────────────────────────────────── */

    const approvalsOptions = [
        { id: 'confirm', label: 'Confirm first', icon: 'codicon-shield' },
        { id: 'auto', label: 'Autoapprove', icon: 'codicon-check-all' },
    ];

    function renderApprovalsPicker() {
        if (!$approvalsPickerDropdown) return;
        $approvalsPickerDropdown.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'compose-picker-section';
        header.textContent = 'Route jobs to agent';
        $approvalsPickerDropdown.appendChild(header);

        for (const a of approvalsOptions) {
            const opt = document.createElement('div');
            opt.className = `compose-picker-option${a.id === settings.approvalMode ? ' active' : ''}`;
            opt.dataset.approval = a.id;
            opt.innerHTML = `<span class="codicon ${a.icon}"></span><span class="compose-picker-option-label">${esc(a.label)}</span>`;
            $approvalsPickerDropdown.appendChild(opt);
        }

        const current = approvalsOptions.find(a => a.id === settings.approvalMode) || approvalsOptions[0];
        if ($approvalsPickerLabel) $approvalsPickerLabel.textContent = current.label;
    }

    /* ── Auto-delete Sessions Picker ────────────────────────────────── */

    const autodeleteOptions = [
        { id: 'never', label: 'Never', icon: 'codicon-circle-slash' },
        { id: 'done', label: 'Once resolved', icon: 'codicon-check' },
        { id: '5min', label: 'After 5 minutes', icon: 'codicon-clock' },
    ];

    function renderAutodeletePicker() {
        if (!$autodeletePickerDropdown) return;
        $autodeletePickerDropdown.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'compose-picker-section';
        header.textContent = 'Delete resolved sessions';
        $autodeletePickerDropdown.appendChild(header);

        for (const a of autodeleteOptions) {
            const opt = document.createElement('div');
            opt.className = `compose-picker-option${a.id === settings.autoDeleteSession ? ' active' : ''}`;
            opt.dataset.autodelete = a.id;
            opt.innerHTML = `<span class="codicon ${a.icon}"></span><span class="compose-picker-option-label">${esc(a.label)}</span>`;
            $autodeletePickerDropdown.appendChild(opt);
        }

        const current = autodeleteOptions.find(a => a.id === settings.autoDeleteSession) || autodeleteOptions[0];
        if ($autodeletePickerLabel) $autodeletePickerLabel.textContent = current.label;
    }

    /* ── Session Mode Picker ─────────────────────────────────────── */

    const sessionOptions = [
        { id: 'active', label: 'Active session', icon: 'codicon-comment-discussion' },
        { id: 'new', label: 'New session per job', icon: 'codicon-window' },
    ];

    function renderSessionPicker() {
        if (!$sessionPickerDropdown) return;
        $sessionPickerDropdown.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'compose-picker-section';
        header.textContent = 'Route jobs to session';
        $sessionPickerDropdown.appendChild(header);

        for (const s of sessionOptions) {
            const opt = document.createElement('div');
            opt.className = `compose-picker-option${s.id === settings.sessionMode ? ' active' : ''}`;
            opt.dataset.session = s.id;
            opt.innerHTML = `<span class="codicon ${s.icon}"></span><span class="compose-picker-option-label">${esc(s.label)}</span>`;
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
        const isArchived = !!w.archived;

        $contextMenu.innerHTML = `
            <div class="context-menu-item" data-ctx-action="toggle" data-id="${w.id}">
                <span class="codicon ${w.enabled ? 'codicon-debug-pause' : 'codicon-play'}"></span>
                ${w.enabled ? 'Pause' : 'Resume'}
            </div>
            <div class="context-menu-item" data-ctx-action="pin" data-id="${w.id}">
                <span class="codicon ${isPinned ? 'codicon-pinned' : 'codicon-pin'}"></span>
                ${isPinned ? 'Unpin' : 'Pin'}
            </div>
            <div class="context-menu-item" data-ctx-action="archive" data-id="${w.id}">
                <span class="codicon codicon-archive"></span>
                ${isArchived ? 'Unarchive' : 'Archive'}
            </div>
            <div class="context-menu-separator"></div>
            ${w.type !== 'web' ? `<div class="context-menu-item" data-ctx-action="open-log" data-id="${w.id}">
                <span class="codicon codicon-file-code"></span>
                ${w.type === 'process' ? 'Open Log Files' : 'Open Log File'}
            </div>` : ''}
            ${w.type === 'process' && !w.logFile ? `<div class="context-menu-item" data-ctx-action="link-log" data-id="${w.id}">
                <span class="codicon codicon-file-symlink-file"></span>
                Link Log File
            </div>` : ''}
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
            case 'link-log':
                vscode.postMessage({ type: 'linkLogFile', id });
                break;
            case 'archive': {
                const w = watchers.find(w => w.id === id);
                const newArchived = !(w && w.archived);
                vscode.postMessage({ type: 'archiveWatcher', id, archived: newArchived });
                break;
            }
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

        // ── Section header: collapse toggle ──
        const sectionHeader = target.closest('.error-feed-section-header');
        if (sectionHeader) {
            const action = sectionHeader.getAttribute('data-action');
            const sectionKey = sectionHeader.getAttribute('data-section');

            // Delete button inside section header
            const deleteBtn = target.closest('.error-feed-section-delete');
            if (deleteBtn) {
                e.stopPropagation();
                deleteSectionErrors(deleteBtn.getAttribute('data-section'));
                return;
            }

            // Toggle collapse
            if (action === 'toggle-section' && sectionKey) {
                feedSectionCollapsed[sectionKey] = !feedSectionCollapsed[sectionKey];
                const $section = sectionHeader.closest('.error-feed-section');
                if ($section) $section.classList.toggle('collapsed', feedSectionCollapsed[sectionKey]);
            }
            return;
        }

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
                    model: selectedModel || undefined,
                    newSession: settings.sessionMode !== 'active'
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
        const groupKey = btn.getAttribute('data-group-key');

        switch (action) {
            case 'toggle-watcher':
                if (id) vscode.postMessage({ type: 'toggleWatcher', id });
                break;
            case 'remove-watcher':
                if (id) vscode.postMessage({ type: 'removeWatcher', id });
                break;
            case 'toggle-group': {
                if (!groupKey) break;
                const processWatchers = watchers.filter(w => w.type === 'process' && !w.archived);
                const { groups } = groupProcessesByLog(processWatchers);
                const g = groups.find(g => g.groupKey === groupKey);
                if (g) {
                    const anyEnabled = g.members.some(m => m.enabled);
                    for (const m of g.members) {
                        if (anyEnabled === m.enabled) {
                            vscode.postMessage({ type: 'toggleWatcher', id: m.id });
                        }
                    }
                }
                break;
            }
            case 'expand-group': {
                if (!groupKey) break;
                if (expandedGroups.has(groupKey)) {
                    expandedGroups.delete(groupKey);
                } else {
                    expandedGroups.add(groupKey);
                }
                renderWatchers();
                break;
            }
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

    // Sidebar deselect — clicking empty space deselects current watcher
    $watchersList.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        // Only deselect if the click target is the list container itself (empty space)
        if (target === $watchersList || target.classList.contains('watcher-section-body')) {
            if (selectedWatcherId) {
                vscode.postMessage({ type: 'selectWatcher', id: null });
            }
        }
    }, true);

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

    $feedTitleDelete?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteVisibleErrors();
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


    // ── Global filter bar toggles (watcher sidebar) ──
    $filterToggleErrors?.addEventListener('click', (e) => {
        e.stopPropagation();
        globalFilterErrors = !globalFilterErrors;
        localFilterErrors = globalFilterErrors;
        render();
    });
    $filterToggleWarnings?.addEventListener('click', (e) => {
        e.stopPropagation();
        globalFilterWarnings = !globalFilterWarnings;
        localFilterWarnings = globalFilterWarnings;
        render();
    });

    // ── Local filter toggles (error feed header) ──
    $feedCountWarnings?.addEventListener('click', (e) => {
        e.stopPropagation();
        localFilterWarnings = !localFilterWarnings;
        render();
    });
    $feedCountErrors?.addEventListener('click', (e) => {
        e.stopPropagation();
        localFilterErrors = !localFilterErrors;
        render();
    });

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
     * Format token count to human-readable string (e.g. 128000 → "128k")
     * @param {number} tokens
     * @returns {string}
     */
    function formatTokenCount(tokens) {
        if (tokens >= 1000000) return (tokens / 1000000).toFixed(tokens % 1000000 === 0 ? 0 : 1) + 'M';
        if (tokens >= 1000) return (tokens / 1000).toFixed(tokens % 1000 === 0 ? 0 : 1) + 'k';
        return String(tokens);
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
