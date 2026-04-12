import * as vscode from 'vscode';
import { ErrorQueue } from './ErrorQueue';
import { WatcherManager } from './WatcherManager';
import { CopilotBridge } from './CopilotBridge';
import { ErrorPilotViewProvider } from './ErrorPilotViewProvider';
import { DEFAULT_WATCHERS } from './types';

let errorQueue: ErrorQueue;
let watcherManager: WatcherManager;
let copilotBridge: CopilotBridge;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    errorQueue = new ErrorQueue();
    watcherManager = new WatcherManager(context, errorQueue);
    copilotBridge = new CopilotBridge(errorQueue);
    copilotBridge.setupAutoTrigger();

    // Auto-setup default watchers on first run (or if all were removed)
    if (watcherManager.getConfigs().length === 0) {
        for (const preset of DEFAULT_WATCHERS) {
            await watcherManager.addWatcher({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                ...preset,
            });
        }
    }

    const viewProvider = new ErrorPilotViewProvider(context.extensionUri, errorQueue, watcherManager, copilotBridge);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ErrorPilotViewProvider.viewType, viewProvider, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
    );

    // First-run: suggest moving to secondary sidebar (right)
    const shownTipKey = 'errorPilot.shownSidebarTip';
    if (!context.globalState.get<boolean>(shownTipKey)) {
        context.globalState.update(shownTipKey, true);
        vscode.window.showInformationMessage(
            'MEDIC: For the best experience, right-click the MEDIC icon in the Activity Bar and select "Move to Secondary Side Bar" to place it on the right.',
            'Got it'
        );
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('errorPilot.addWatcher', () => {
            vscode.commands.executeCommand('errorPilot.view.focus');
            viewProvider.showAddWatcher();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('errorPilot.removeWatcher', async (item?: any) => {
            if (item?.id) { await watcherManager.removeWatcher(item.id); }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('errorPilot.sendError', async (item?: any) => {
            if (item?.id) {
                const error = errorQueue.getAll().find((e) => e.id === item.id);
                if (error) { await copilotBridge.sendError(error); }
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('errorPilot.dismissError', (item?: any) => {
            if (item?.id) { errorQueue.remove(item.id); }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('errorPilot.sendAllPending', async () => {
            await copilotBridge.sendAllPending();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('errorPilot.clearErrors', () => {
            errorQueue.clear();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('errorPilot.toggleAutoTrigger', async () => {
            const config = vscode.workspace.getConfiguration('errorPilot');
            const current = config.get<boolean>('autoTrigger', false);
            await config.update('autoTrigger', !current, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`MEDIC: Auto-trigger ${!current ? 'enabled' : 'disabled'}`);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('errorPilot.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'errorPilot');
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('errorPilot.resolveError', (errorId?: string) => {
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
        vscode.commands.registerCommand('errorPilot.scanWorkspace', async () => {
            const existing = watcherManager.getConfigs();
            const existingPaths = new Set(existing.map((c) => c.path));
            let added = 0;
            for (const preset of DEFAULT_WATCHERS) {
                if (existingPaths.has(preset.path)) { continue; }
                await watcherManager.addWatcher({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...preset });
                added++;
            }
            if (added > 0) {
                vscode.window.showInformationMessage(`MEDIC: Added ${added} watcher${added > 1 ? 's' : ''} for BitingLip services.`);
            } else {
                vscode.window.showInformationMessage('MEDIC: All service watchers already configured.');
            }
        }),
    );

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'errorPilot.view.focus';
    context.subscriptions.push(statusBarItem);

    function updateStatusBar(): void {
        const count = errorQueue.pendingCount;
        if (count > 0) {
            statusBarItem.text = `$(bug) ${count}`;
            statusBarItem.tooltip = `MEDIC: ${count} pending error${count > 1 ? 's' : ''} — click to open`;
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
