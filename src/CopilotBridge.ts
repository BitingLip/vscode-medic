import * as vscode from 'vscode';
import { ErrorEntry } from './types';
import { ErrorQueue } from './ErrorQueue';

export class CopilotBridge implements vscode.Disposable {
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor(private readonly errorQueue: ErrorQueue) {}

    /** Send a single error to Copilot Chat */
    async sendError(error: ErrorEntry, guidingPrompt?: string, mode?: string, model?: string, newSession: boolean = true): Promise<void> {
        const prompt = this.buildPrompt(error, guidingPrompt);
        await this.openChat(prompt, mode, model, newSession);
        this.errorQueue.markSent(error.id, prompt);
    }

    /** Re-open a Copilot Chat session with the same prompt used when the error was sent */
    async reopenSession(error: ErrorEntry): Promise<void> {
        if (error.agentSessionQuery) {
            await this.openChat(error.agentSessionQuery);
        } else {
            const prompt = this.buildPrompt(error);
            await this.openChat(prompt);
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
        prompt += '---\nAfter fixing each error, run the VS Code command `errorPilot.resolveError` with the corresponding MEDIC ID to mark it as resolved.\n';
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

        // Append resolve instructions for each error
        prompt += '---\nAfter fixing each error, run the VS Code command `errorPilot.resolveError` with the corresponding MEDIC ID to mark it as resolved.\n';
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

            const debounceMs = config.get<number>('debounceMs', 3000);

            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            this.debounceTimer = setTimeout(() => {
                this.sendError(error);
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
        prompt += `\n\n---\n**MEDIC ID:** \`${error.id}\`\nAfter you have fixed this error, run the VS Code command \`errorPilot.resolveError\` with argument \`${error.id}\` to mark it as resolved in the MEDIC dashboard.`;

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
        this.disposables.forEach((d) => d.dispose());
    }
}
