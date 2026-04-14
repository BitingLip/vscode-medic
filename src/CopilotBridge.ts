import * as vscode from 'vscode';
import { ErrorEntry } from './types';
import { ErrorQueue } from './ErrorQueue';

export class CopilotBridge implements vscode.Disposable {
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private disposables: vscode.Disposable[] = [];
    /** Watchdog timers keyed by error ID */
    private watchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(private readonly errorQueue: ErrorQueue) {
        // Listen for status changes to manage watchdog timers
        this.disposables.push(
            this.errorQueue.onDidChange(() => this.updateWatchdogs()),
        );
    }

    /** Send a single error to Copilot Chat */
    async sendError(error: ErrorEntry, guidingPrompt?: string, mode?: string, model?: string, newSession: boolean = true): Promise<void> {
        const prompt = this.buildPrompt(error, guidingPrompt);
        await this.openChat(prompt, mode, model, newSession);
        this.errorQueue.markSent(error.id, prompt);
    }

    /** Focus the Copilot Chat panel to show the existing session */
    async reopenSession(_error: ErrorEntry): Promise<void> {
        try {
            await vscode.commands.executeCommand('workbench.action.chat.open');
        } catch {
            // ignore — chat panel may not be available
        }
    }

    /** Send specific selected errors to Copilot Chat */
    async sendErrors(errors: ErrorEntry[], guidingPrompt?: string, mode?: string, model?: string, newSession: boolean = true): Promise<void> {
        if (errors.length === 1) {
            return this.sendError(errors[0], guidingPrompt, mode, model, newSession);
        }

        let prompt = '';
        prompt += 'Fix the following runtime errors. Identify root causes and apply fixes.\n\n';
        for (const error of errors) {
            prompt += `### Error from ${error.source} (MEDIC ID: \`${error.id}\`)\n`;
            prompt += `\`\`\`\n${error.raw}\n\`\`\`\n`;
            if (error.file) {
                prompt += `File: ${error.file}${error.line ? `:${error.line}` : ''}\n`;
            }
            prompt += '\n';
        }
        prompt += '---\nFor each error, run `errorPilot.markWorking` with its MEDIC ID when you start working on it.\n';
        prompt += 'If you need user input or attention, run `errorPilot.markAttention` with the MEDIC ID and a reason string.\n';
        prompt += 'If you cannot fix an error, run `errorPilot.markAgentError` with the MEDIC ID and a reason string.\n';
        prompt += 'After fixing each error, run `errorPilot.resolveError` with the corresponding MEDIC ID to mark it as resolved.\n';
        prompt += `Error IDs: ${errors.map(e => `\`${e.id}\``).join(', ')}\n`;

        if (guidingPrompt) {
            prompt += `\n**User note:**\n${guidingPrompt}\n`;
        }

        await this.openChat(prompt, mode, model, newSession);
        for (const error of errors) {
            this.errorQueue.markSent(error.id, prompt);
        }
    }

    /** Send all pending errors in a single Copilot Chat message */
    async sendAllPending(guidingPrompt?: string, mode?: string, model?: string, newSession: boolean = true): Promise<void> {
        const pending = this.errorQueue.getPending();
        if (pending.length === 0) {
            vscode.window.showInformationMessage('MEDIC: No pending errors to send.');
            return;
        }

        const config = vscode.workspace.getConfiguration('errorPilot');
        const participant = config.get<string>('agent', '');

        let prompt = '';
        prompt += 'Fix the following runtime errors. Identify root causes and apply fixes.\n\n';
        for (const error of pending) {
            prompt += `### Error from ${error.source} (MEDIC ID: \`${error.id}\`)\n`;
            prompt += `\`\`\`\n${error.raw}\n\`\`\`\n`;
            if (error.file) {
                prompt += `File: ${error.file}${error.line ? `:${error.line}` : ''}\n`;
            }
            prompt += '\n';
        }

        // Append status-management instructions for each error
        prompt += '---\nFor each error, run `errorPilot.markWorking` with its MEDIC ID when you start working on it.\n';
        prompt += 'If you need user input or attention, run `errorPilot.markAttention` with the MEDIC ID and a reason string.\n';
        prompt += 'If you cannot fix an error, run `errorPilot.markAgentError` with the MEDIC ID and a reason string.\n';
        prompt += 'After fixing each error, run the VS Code command `errorPilot.resolveError` with the corresponding MEDIC ID to mark it as resolved.\n';
        prompt += `Error IDs: ${pending.map(e => `\`${e.id}\``).join(', ')}\n`;

        if (guidingPrompt) {
            prompt += `\n**User note:**\n${guidingPrompt}\n`;
        }

        if (participant) {
            prompt = `${participant} ${prompt}`;
        }

        await this.openChat(prompt, mode, model, newSession);

        for (const error of pending) {
            this.errorQueue.markSent(error.id, prompt);
        }
    }

    /** Wire up auto-trigger: when new errors arrive, auto-send after debounce */
    setupAutoTrigger(): void {
        const disposable = this.errorQueue.onNewError((error) => {
            const config = vscode.workspace.getConfiguration('errorPilot');
            if (!config.get<boolean>('autoTrigger', false)) { return; }
            // In "confirm" mode, never auto-send — user must explicitly dispatch
            if (config.get<string>('approvalMode', 'confirm') !== 'auto') { return; }

            const debounceMs = config.get<number>('debounceMs', 3000);

            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            this.debounceTimer = setTimeout(() => {
                this.sendAllPending(undefined, undefined, undefined, false);
            }, debounceMs);
        });

        this.disposables.push(disposable);
    }

    // ── Internals ────────────────────────────────────────────────────

    private buildPrompt(error: ErrorEntry, guidingPrompt?: string): string {
        const config = vscode.workspace.getConfiguration('errorPilot');
        const participant = config.get<string>('agent', '');
        const template = config.get<string>(
            'promptTemplate',
            'Fix the following runtime error. Identify the root cause in the codebase and apply a fix.\n\nError from {source}:\n```\n{error}\n```\n\n{stackTrace}',
        );

        let prompt = '';

        prompt += template
            .replace('{source}', error.source)
            .replace('{error}', error.raw)
            .replace('{file}', error.file ?? 'unknown')
            .replace('{line}', error.line?.toString() ?? '')
            .replace('{raw}', error.raw)
            .replace('{stackTrace}',
                error.stackTrace
                    ? `Stack trace:\n\`\`\`\n${error.stackTrace}\n\`\`\``
                    : '',
            );

        // Trim empty placeholders that weren't filled
        prompt = prompt.replace(/\n{3,}/g, '\n\n').trim();

        // Append resolve instruction so the agent can mark the error as fixed
        prompt += `\n\n---\n**MEDIC ID:** \`${error.id}\``;
        prompt += `\nWhen you start working on this error, run \`errorPilot.markWorking\` with argument \`${error.id}\`.`;
        prompt += `\nIf you need user input or attention, run \`errorPilot.markAttention\` with arguments \`${error.id}\` and a reason string.`;
        prompt += `\nIf you cannot fix this error, run \`errorPilot.markAgentError\` with arguments \`${error.id}\` and a reason string.`;
        prompt += `\nAfter you have fixed this error, run \`errorPilot.resolveError\` with argument \`${error.id}\` to mark it as resolved.`;

        if (guidingPrompt) {
            prompt += `\n\n**User note:**\n${guidingPrompt}`;
        }

        if (participant) {
            prompt = `${participant} ${prompt}`;
        }

        return prompt;
    }

    private async openChat(prompt: string, mode?: string, model?: string, newSession: boolean = true): Promise<void> {
        try {
            if (newSession) {
                // Create a fresh chat session before sending the prompt
                await vscode.commands.executeCommand('workbench.action.chat.newChat');
            }

            const opts: Record<string, unknown> = {
                query: prompt,
                isPartialQuery: false,
            };
            if (mode) { opts.mode = mode; }
            if (model) { opts.modelSelector = { id: model }; }

            await vscode.commands.executeCommand('workbench.action.chat.open', opts);
        } catch {
            // Fallback for older VS Code versions
            try {
                await vscode.commands.executeCommand('workbench.action.chat.open', {
                    query: prompt,
                });
                vscode.window.showInformationMessage(
                    'MEDIC: Prompt loaded in Copilot Chat. Press Enter to send.',
                );
            } catch {
                vscode.window.showErrorMessage(
                    'MEDIC: Could not open Copilot Chat. Is GitHub Copilot installed?',
                );
            }
        }
    }

    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        for (const timer of this.watchdogTimers.values()) {
            clearTimeout(timer);
        }
        this.watchdogTimers.clear();
        this.disposables.forEach((d) => d.dispose());
    }

    // ── Watchdog ─────────────────────────────────────────────────────

    /** Evaluate all active errors and start/clear watchdog timers as needed */
    private updateWatchdogs(): void {
        const config = vscode.workspace.getConfiguration('errorPilot');
        const sentTimeoutMin = config.get<number>('watchdog.sentTimeoutMinutes', 2);
        const workingTimeoutMin = config.get<number>('watchdog.workingTimeoutMinutes', 10);

        const activeErrors = this.errorQueue.getAll().filter(
            (e) => e.status === 'sent' || e.status === 'working',
        );
        const activeIds = new Set(activeErrors.map((e) => e.id));

        // Clear timers for errors no longer in an active state
        for (const [id, timer] of this.watchdogTimers) {
            if (!activeIds.has(id)) {
                clearTimeout(timer);
                this.watchdogTimers.delete(id);
            }
        }

        // Start timers for errors that don't have one yet
        for (const error of activeErrors) {
            if (this.watchdogTimers.has(error.id)) { continue; }

            const timeoutMs = error.status === 'sent'
                ? sentTimeoutMin * 60_000
                : workingTimeoutMin * 60_000;

            const elapsed = Date.now() - (error.sentAt ?? error.timestamp);
            const remaining = Math.max(timeoutMs - elapsed, 0);

            const timer = setTimeout(() => {
                this.watchdogTimers.delete(error.id);
                // Re-check: the status may have changed since the timer was set
                const current = this.errorQueue.getAll().find((e) => e.id === error.id);
                if (!current) { return; }
                if (current.status === 'sent' || current.status === 'working') {
                    this.errorQueue.markAttention(error.id);
                    vscode.window.showWarningMessage(
                        `MEDIC: Job "${current.message.slice(0, 50)}" timed out (was ${current.status}). Escalated to attention.`,
                    );
                }
            }, remaining);

            this.watchdogTimers.set(error.id, timer);
        }
    }
}
