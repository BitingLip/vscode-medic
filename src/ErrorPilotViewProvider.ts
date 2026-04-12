import * as vscode from 'vscode';
import { PanelState, ERROR_PRESETS, CHAT_MODES, CUSTOM_AGENTS, ModelInfo } from './types';
import { ErrorQueue } from './ErrorQueue';
import { WatcherManager } from './WatcherManager';
import { CopilotBridge } from './CopilotBridge';

export class ErrorPilotViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'errorPilot.view';

    private view?: vscode.WebviewView;
    private selectedWatcherId: string | null = null;
    private pinnedWatcherIds: string[] = [];
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly errorQueue: ErrorQueue,
        private readonly watcherManager: WatcherManager,
        private readonly copilotBridge: CopilotBridge,
    ) {
        this.disposables.push(
            this.errorQueue.onDidChange(() => this.pushState()),
            this.watcherManager.onDidChangeConfigs(() => this.pushState()),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('errorPilot')) { this.pushState(); }
            }),
        );
    }

    public showAddWatcher(): void {
        this.view?.webview.postMessage({ type: 'showAddWatcher' });
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;

        const codiconsUri = vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist');

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'media'),
                codiconsUri,
            ],
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            (msg) => this.handleMessage(msg),
            null,
            this.disposables,
        );
    }

    // ── State Push ───────────────────────────────────────────────────

    private pushState(): void {
        if (!this.view) { return; }
        const config = vscode.workspace.getConfiguration('errorPilot');
        const state: PanelState = {
            errors: this.errorQueue.getAll(),
            watchers: this.watcherManager.getConfigs(),
            selectedWatcherId: this.selectedWatcherId,
            pinnedWatcherIds: this.pinnedWatcherIds,
            agent: config.get<string>('agent', ''),
            autoTrigger: config.get<boolean>('autoTrigger', false),
            debounceMs: config.get<number>('debounceMs', 3000),
            approvalMode: config.get<string>('approvalMode', 'confirm'),
            autoDeleteSession: config.get<string>('autoDeleteSession', 'never'),
            chatMode: config.get<string>('chatMode', 'agent'),
            chatModel: config.get<string>('chatModel', ''),
            sessionMode: config.get<string>('sessionMode', 'new'),
        };
        this.view.webview.postMessage({ type: 'state', data: state });
    }

    // ── Message Handling ─────────────────────────────────────────────

    private async handleMessage(msg: any): Promise<void> {
        switch (msg.type) {
            case 'ready':
                this.pushState();
                this.view?.webview.postMessage({ type: 'presets', data: ERROR_PRESETS });
                this.view?.webview.postMessage({ type: 'agents', data: { modes: CHAT_MODES, agents: CUSTOM_AGENTS } });
                this.pushModels();
                break;

            case 'selectWatcher':
                this.selectedWatcherId = msg.id ?? null;
                this.pushState();
                break;

            case 'sendError': {
                const error = this.errorQueue.getAll().find((e) => e.id === msg.id);
                if (error) { await this.copilotBridge.sendError(error, msg.guidingPrompt, msg.mode, msg.model, msg.newSession); }
                break;
            }

            case 'openAgentSession': {
                const error = this.errorQueue.getAll().find((e) => e.id === msg.id);
                if (error) { await this.copilotBridge.reopenSession(error); }
                break;
            }

            case 'dismissError':
                this.errorQueue.remove(msg.id);
                break;

            case 'resolveError':
                this.errorQueue.markResolved(msg.id);
                break;

            case 'sendAllPending':
                await this.copilotBridge.sendAllPending(msg.guidingPrompt, msg.mode, msg.model, msg.newSession);
                break;

            case 'sendSelectedErrors': {
                const ids: string[] = msg.ids || [];
                const allErrors = this.errorQueue.getAll();
                const selected = allErrors.filter((e) => ids.includes(e.id));
                if (selected.length > 0) {
                    await this.copilotBridge.sendErrors(selected, msg.guidingPrompt, msg.mode, msg.model, msg.newSession);
                }
                break;
            }

            case 'clearErrors':
                this.errorQueue.clear();
                break;

            case 'addWatcher': {
                const { name, type, path, errorPatterns } = msg.config;
                await this.watcherManager.addWatcher({
                    id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    name,
                    type: type || 'file',
                    path,
                    errorPatterns: errorPatterns || [],
                    enabled: true,
                });
                break;
            }

            case 'removeWatcher':
                await this.watcherManager.removeWatcher(msg.id);
                break;

            case 'toggleWatcher':
                await this.watcherManager.toggleWatcher(msg.id);
                break;

            case 'scanWorkspace':
                await vscode.commands.executeCommand('errorPilot.scanWorkspace');
                break;

            case 'updateSetting': {
                const cfg = vscode.workspace.getConfiguration('errorPilot');
                await cfg.update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
                break;
            }

            case 'openSettings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'errorPilot');
                break;

            case 'openFile': {
                const uri = vscode.Uri.file(msg.file);
                const line = msg.line ? msg.line - 1 : 0;
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, {
                    selection: new vscode.Range(line, 0, line, 0),
                });
                break;
            }

            case 'copyError': {
                const err = this.errorQueue.getAll().find((e) => e.id === msg.id);
                if (err) {
                    const text = `${err.source}: ${err.message}${err.stackTrace ? '\n' + err.stackTrace : ''}`;
                    await vscode.env.clipboard.writeText(text);
                }
                break;
            }

            case 'updatePinned':
                this.pinnedWatcherIds = msg.ids || [];
                break;

            case 'openLogFile': {
                const watcher = this.watcherManager.getConfigs().find((w) => w.id === msg.id);
                if (watcher) {
                    const uri = vscode.Uri.file(watcher.path);
                    try {
                        const doc = await vscode.workspace.openTextDocument(uri);
                        await vscode.window.showTextDocument(doc);
                    } catch {
                        vscode.window.showWarningMessage(`Could not open: ${watcher.path}`);
                    }
                }
                break;
            }
        }
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }

    private async pushModels(): Promise<void> {
        try {
            const models = await vscode.lm.selectChatModels();
            const modelInfos: ModelInfo[] = models.map((m) => ({
                id: m.id,
                name: m.name,
                vendor: m.vendor,
                family: m.family,
            }));
            this.view?.webview.postMessage({ type: 'models', data: modelInfos });
        } catch {
            // lm API not available
        }
    }

    // ── HTML ─────────────────────────────────────────────────────────

    private getHtml(webview: vscode.Webview): string {
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
        const codiconCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'codicon.css'),
        );
        const nonce = getNonce();

        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   style-src ${webview.cspSource} 'unsafe-inline';
                   font-src ${webview.cspSource};
                   script-src 'nonce-${nonce}' ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${codiconCssUri}">
    <link rel="stylesheet" href="${cssUri}">
    <title>MEDIC</title>
</head>
<body>
    <div class="error-pilot-viewpane" id="viewpane">

        <!-- ═══ LEFT: Error Feed Container ═══ -->
        <div class="error-feed-container" id="error-feed-container">

            <!-- Error Feed Title Bar -->
            <div class="error-feed-title" id="error-feed-title">
                <span class="error-feed-title-label" id="feed-title-label">All Errors</span>
                <span class="error-feed-title-count" id="feed-title-count">0 total</span>
                <div class="error-feed-title-actions">
                    <button class="icon-btn" id="feed-title-clear" data-action="clear-filter" title="Clear filter" style="display:none;">
                        <span class="codicon codicon-close"></span>
                    </button>
                    <button class="icon-btn" id="feed-title-show-sidebar" title="Show watchers sidebar" style="display:none;">
                        <span class="codicon codicon-layout-sidebar-right"></span>
                    </button>
                </div>
            </div>

            <!-- Watchers Chips (single-column fallback) -->
            <div class="watchers-chips" id="watchers-chips"></div>

            <!-- Error Feed (scrollable) -->
            <div class="error-feed" id="error-feed">
                <!-- Empty State -->
                <div class="empty-state" id="empty-state">
                    <span class="codicon codicon-shield empty-state-icon"></span>
                    <div class="empty-state-title">No errors detected</div>
                    <div class="empty-state-message">Errors from your watchers will appear here</div>
                    <div class="empty-state-actions">
                        <button class="btn btn-secondary" id="empty-scan-btn">
                            <span class="codicon codicon-search"></span> Scan Workspace
                        </button>
                        <button class="btn btn-secondary" id="empty-add-btn">
                            <span class="codicon codicon-add"></span> Add Watcher
                        </button>
                    </div>
                </div>
            </div>

            <!-- Compose Box -->
            <div class="compose-box" id="compose-box">
                <!-- Selected Error Chips -->
                <div class="compose-chips" id="compose-chips"></div>
                <!-- Input Row -->
                <div class="compose-input-row">
                    <textarea
                        id="prompt-input"
                        class="compose-input"
                        rows="1"
                        placeholder="Describe what to fix"
                        spellcheck="false"
                    ></textarea>
                </div>
                <!-- Toolbar Row -->
                <div class="compose-toolbar">
                    <div class="compose-toolbar-left">
                        <button class="compose-attach-btn" id="compose-attach-btn" title="Attach pending errors">
                            <span class="codicon codicon-add"></span>
                        </button>
                        <!-- Agent Picker -->
                        <div class="compose-picker" id="agent-picker-wrap">
                            <button class="compose-picker-btn" id="agent-picker-btn">
                                <span class="codicon codicon-copilot" id="agent-picker-icon"></span>
                                <span class="compose-picker-label" id="agent-picker-label">Agent</span>
                                <span class="codicon codicon-chevron-down compose-picker-chevron"></span>
                            </button>
                            <div class="compose-picker-dropdown" id="agent-picker-dropdown"></div>
                        </div>
                        <!-- Model Picker -->
                        <div class="compose-picker" id="model-picker-wrap">
                            <button class="compose-picker-btn" id="model-picker-btn">
                                <span class="compose-picker-label" id="model-picker-label">Auto</span>
                                <span class="codicon codicon-chevron-down compose-picker-chevron"></span>
                            </button>
                            <div class="compose-picker-dropdown" id="model-picker-dropdown"></div>
                        </div>
                    </div>
                    <div class="compose-toolbar-right">
                        <button class="compose-send-btn" id="compose-send-btn" title="Send (Ctrl+Enter)">
                            <span class="codicon codicon-arrow-up"></span>
                        </button>
                    </div>
                </div>
            </div>
            <!-- Below-box selectors -->
            <div class="compose-below-bar" id="compose-below-bar">
                <!-- Workspace Picker -->
                <div class="compose-picker" id="workspace-picker-wrap">
                    <button class="compose-picker-btn" id="workspace-picker-btn">
                        <span class="codicon codicon-folder" id="workspace-picker-icon"></span>
                        <span class="compose-picker-label" id="workspace-picker-label">@workspace</span>
                        <span class="codicon codicon-chevron-down compose-picker-chevron"></span>
                    </button>
                    <div class="compose-picker-dropdown" id="workspace-picker-dropdown"></div>
                </div>
                <!-- Approvals Picker -->
                <div class="compose-picker" id="approvals-picker-wrap">
                    <button class="compose-picker-btn" id="approvals-picker-btn">
                        <span class="codicon codicon-shield" id="approvals-picker-icon"></span>
                        <span class="compose-picker-label" id="approvals-picker-label">Confirm</span>
                        <span class="codicon codicon-chevron-down compose-picker-chevron"></span>
                    </button>
                    <div class="compose-picker-dropdown" id="approvals-picker-dropdown"></div>
                </div>
                <!-- Auto-delete Sessions Picker -->
                <div class="compose-picker" id="autodelete-picker-wrap">
                    <button class="compose-picker-btn" id="autodelete-picker-btn">
                        <span class="codicon codicon-trash" id="autodelete-picker-icon"></span>
                        <span class="compose-picker-label" id="autodelete-picker-label">Never</span>
                        <span class="codicon codicon-chevron-down compose-picker-chevron"></span>
                    </button>
                    <div class="compose-picker-dropdown" id="autodelete-picker-dropdown"></div>
                </div>
                <!-- Session Mode Picker -->
                <div class="compose-picker" id="session-picker-wrap">
                    <button class="compose-picker-btn" id="session-picker-btn">
                        <span class="codicon codicon-window" id="session-picker-icon"></span>
                        <span class="compose-picker-label" id="session-picker-label">New session</span>
                        <span class="codicon codicon-chevron-down compose-picker-chevron"></span>
                    </button>
                    <div class="compose-picker-dropdown" id="session-picker-dropdown"></div>
                </div>
            </div>
        </div>

        <!-- ═══ SASH (resize handle) ═══ -->
        <div class="sash" id="sash"></div>

        <!-- ═══ RIGHT: Watchers Sidebar ═══ -->
        <div class="watchers-sidebar" id="watchers-sidebar">

            <!-- Sidebar Title + Toolbar -->
            <div class="watchers-title-container">
                <span class="watchers-title">Watchers</span>
                <div class="watchers-toolbar">
                    <button class="icon-btn" id="watchers-refresh-btn" title="Refresh watchers">
                        <span class="codicon codicon-refresh"></span>
                    </button>
                    <button class="icon-btn" id="watchers-search-btn" title="Search watchers">
                        <span class="codicon codicon-search"></span>
                    </button>
                    <button class="icon-btn" id="watchers-hide-btn" title="Hide sidebar">
                        <span class="codicon codicon-close-all"></span>
                    </button>
                </div>
            </div>

            <!-- Search bar (hidden by default) -->
            <div class="watchers-search-bar hidden" id="watcher-search-bar">
                <input type="text" id="watcher-search-input" placeholder="Filter watchers…">
            </div>

            <!-- Add Watcher button -->
            <div class="watchers-new-button-container">
                <button class="watchers-new-button" id="watchers-new-btn">
                    <span class="codicon codicon-add"></span> Add Watcher
                </button>
            </div>

            <!-- Watchers list (scrollable, with sections) -->
            <div class="watchers-list" id="watchers-list">
                <div class="watchers-empty" id="watchers-empty">
                    <p>No watchers configured</p>
                </div>
            </div>
        </div>
    </div>

    <!-- Context Menu -->
    <div class="context-menu" id="context-menu"></div>

    <!-- Add Watcher Overlay -->
    <div class="overlay" id="add-watcher-overlay">
        <div class="overlay-content">
            <div class="overlay-header">
                <h3><span class="codicon codicon-add"></span> Add Watcher</h3>
                <button class="icon-btn" id="close-add-watcher">
                    <span class="codicon codicon-close"></span>
                </button>
            </div>
            <form id="watcher-form">
                <div class="form-group">
                    <label for="watcher-name">Name</label>
                    <input type="text" id="watcher-name" placeholder="e.g. Gateway Logs" required>
                </div>
                <div class="form-group">
                    <label for="watcher-type">Type</label>
                    <select id="watcher-type">
                        <option value="file">Log File</option>
                        <option value="process">Process (Terminal)</option>
                        <option value="web">Web (Browser Console)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="watcher-path" id="watcher-path-label">File Path</label>
                    <input type="text" id="watcher-path" placeholder="e.g. logs/app.log" required>
                </div>
                <div class="form-group">
                    <label for="watcher-preset">Preset</label>
                    <select id="watcher-preset">
                        <option value="">Custom…</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="watcher-patterns">Error Patterns</label>
                    <textarea id="watcher-patterns" rows="3" placeholder="One regex per line"></textarea>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">Add</button>
                    <button type="button" class="btn btn-secondary" id="cancel-add-watcher">Cancel</button>
                </div>
            </form>
        </div>
    </div>

    <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
