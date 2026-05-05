import * as vscode from 'vscode';
import { ErrorQueue } from './ErrorQueue';
import { WatcherManager } from './WatcherManager';
import { CopilotBridge } from './CopilotBridge';
import { medicViewProvider } from './MedicViewProvider';

let errorQueue: ErrorQueue;
let watcherManager: WatcherManager;
let copilotBridge: CopilotBridge;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    errorQueue = new ErrorQueue();
    watcherManager = new WatcherManager(context, errorQueue);
    copilotBridge = new CopilotBridge(errorQueue);
    copilotBridge.setupAutoTrigger();

    // Always run discovery on activation to prune stale auto-discovered
    // watchers (for example old web tabs) and refresh process/terminal state.
    await watcherManager.discoverAll();

    const viewProvider = new medicViewProvider(context.extensionUri, errorQueue, watcherManager, copilotBridge);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(medicViewProvider.viewType, viewProvider, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
    );

    // Auto-discover new terminals as they open
    context.subscriptions.push(
        vscode.window.onDidOpenTerminal(terminal => {
            watcherManager.discoverTerminal(terminal);
        }),
    );

    // First-run: suggest moving to secondary sidebar (right)
    const shownTipKey = 'medic.shownSidebarTip';
    if (!context.globalState.get<boolean>(shownTipKey)) {
        context.globalState.update(shownTipKey, true);
        vscode.window.showInformationMessage(
            'MEDIC: For the best experience, right-click the MEDIC icon in the Activity Bar and select "Move to Secondary Side Bar" to place it on the right.',
            'Got it'
        );
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.addWatcher', () => {
            vscode.commands.executeCommand('medic.view.focus');
            viewProvider.showAddWatcher();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.removeWatcher', async (item?: any) => {
            if (item?.id) { await watcherManager.removeWatcher(item.id); }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.sendError', async (item?: any) => {
            if (item?.id) {
                const error = errorQueue.getAll().find((e) => e.id === item.id);
                if (error) { await copilotBridge.sendError(error); }
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.dismissError', (item?: any) => {
            if (item?.id) { errorQueue.remove(item.id); }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.sendAllPending', async () => {
            await copilotBridge.sendAllPending();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.clearErrors', () => {
            errorQueue.clear();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.toggleAutoTrigger', async () => {
            const config = vscode.workspace.getConfiguration('medic');
            const current = config.get<boolean>('autoTrigger', false);
            await config.update('autoTrigger', !current, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`MEDIC: Auto-trigger ${!current ? 'enabled' : 'disabled'}`);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'medic');
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.showSidebar', async () => {
            await vscode.commands.executeCommand('medic.view.focus');
            viewProvider.showSidebar();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.resolveError', (errorId?: string) => {
            if (!errorId) {
                // Fallback: resolve the most recently sent error
                const sent = errorQueue.getAll()
                    .filter(e => e.status === 'sent')
                    .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
                if (sent.length > 0) {
                    errorId = sent[0].id;
                } else {
                    vscode.window.showInformationMessage('MEDIC: No sent errors to resolve.');
                    return;
                }
            }
            const error = errorQueue.getAll().find(e => e.id === errorId);
            if (error) {
                errorQueue.markResolved(error.id);
                vscode.window.showInformationMessage(`MEDIC: Marked "${error.message.slice(0, 60)}" as fixed.`);
            } else {
                vscode.window.showWarningMessage(`MEDIC: Error ID "${errorId}" not found.`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.markWorking', (errorId?: string) => {
            if (!errorId) {
                const sent = errorQueue.getAll()
                    .filter(e => e.status === 'sent')
                    .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
                if (sent.length > 0) { errorId = sent[0].id; }
                else { return; }
            }
            const error = errorQueue.getAll().find(e => e.id === errorId);
            if (error) { errorQueue.markWorking(error.id); }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.markAttention', (errorId?: string, reason?: string) => {
            if (!errorId) {
                const working = errorQueue.getAll()
                    .filter(e => e.status === 'working' || e.status === 'sent')
                    .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
                if (working.length > 0) { errorId = working[0].id; }
                else { return; }
            }
            const error = errorQueue.getAll().find(e => e.id === errorId);
            if (error) {
                errorQueue.markAttention(error.id);
                if (reason) {
                    vscode.window.showWarningMessage(`MEDIC: Attention needed � ${reason}`);
                }
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.markAgentError', (errorId?: string, reason?: string) => {
            if (!errorId) {
                const active = errorQueue.getAll()
                    .filter(e => e.status === 'working' || e.status === 'sent')
                    .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
                if (active.length > 0) { errorId = active[0].id; }
                else { return; }
            }
            const error = errorQueue.getAll().find(e => e.id === errorId);
            if (error) {
                errorQueue.markAgentError(error.id);
                vscode.window.showErrorMessage(`MEDIC: Agent error � ${reason ?? error.message.slice(0, 60)}`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.demoLifecycle', async () => {
            const id = `demo-${Date.now().toString(36)}`;
            const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

            errorQueue.push({
                id,
                timestamp: Date.now(),
                source: 'demo',
                watcherId: '__demo__',
                message: 'TypeError: Cannot read properties of undefined (reading \'map\')',
                raw: 'TypeError: Cannot read properties of undefined (reading \'map\')\n    at renderItems (src/components/List.tsx:42:18)',
                file: 'src/components/List.tsx',
                line: 42,
                severity: 'error',
                status: 'pending',
            });
            vscode.window.showInformationMessage('MEDIC Demo: pending');

            await delay(2500);
            errorQueue.markSent(id, '(demo prompt)');
            vscode.window.showInformationMessage('MEDIC Demo: sent');

            await delay(2500);
            errorQueue.markWorking(id);
            vscode.window.showInformationMessage('MEDIC Demo: working');

            await delay(2500);
            errorQueue.markAttention(id);
            vscode.window.showInformationMessage('MEDIC Demo: attention');

            await delay(2500);
            errorQueue.markAgentError(id);
            vscode.window.showInformationMessage('MEDIC Demo: error');

            await delay(2500);
            errorQueue.markResolved(id);
            vscode.window.showInformationMessage('MEDIC Demo: resolved ?');
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('medic.scanWorkspace', async () => {
            const { added, removed } = await watcherManager.discoverAll(viewProvider.getPinnedIds());
            const parts: string[] = [];
            if (added > 0) { parts.push(`discovered ${added}`); }
            if (removed > 0) { parts.push(`removed ${removed} stale`); }
            vscode.window.showInformationMessage(
                parts.length > 0
                    ? `MEDIC: ${parts.join(', ')} watcher${added + removed > 1 ? 's' : ''}.`
                    : 'MEDIC: No changes � all watchers up to date.',
            );
        }),
    );

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'medic.view.focus';
    context.subscriptions.push(statusBarItem);

    function updateStatusBar(): void {
        const count = errorQueue.pendingCount;
        if (count > 0) {
            statusBarItem.text = `$(bug) ${count}`;
            statusBarItem.tooltip = `MEDIC: ${count} pending error${count > 1 ? 's' : ''} � click to open`;
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    }

    errorQueue.onDidChange(updateStatusBar);
    updateStatusBar();
    context.subscriptions.push(errorQueue, watcherManager, copilotBridge, viewProvider);
}

export function deactivate(): void {}
