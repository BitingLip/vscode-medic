import * as vscode from 'vscode';
import { ErrorEntry } from './types';

export class ErrorQueue implements vscode.Disposable {
    private errors: ErrorEntry[] = [];

    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private readonly _onNewError = new vscode.EventEmitter<ErrorEntry>();
    readonly onNewError = this._onNewError.event;

    get maxSize(): number {
        return vscode.workspace.getConfiguration('errorPilot').get<number>('maxQueueSize', 50);
    }

    push(error: ErrorEntry): void {
        // Check for an existing entry with the same message+source (any status)
        const existing = this.errors.find(
            (e) => e.message === error.message && e.source === error.source
        );

        if (existing) {
            // Bump occurrence count; only update lastSeenAt if newer
            existing.occurrences = (existing.occurrences ?? 1) + 1;
            if (error.timestamp > (existing.lastSeenAt ?? 0)) {
                existing.lastSeenAt = error.timestamp;
            }
            // Keep the oldest timestamp as the original
            if (error.timestamp < existing.timestamp) {
                existing.timestamp = error.timestamp;
            }
            this._onDidChange.fire();
            // Don't fire onNewError — no need to trigger agent for duplicates
            return;
        }

        error.occurrences = 1;
        error.lastSeenAt = error.timestamp;
        this.errors.unshift(error);
        while (this.errors.length > this.maxSize) {
            this.errors.pop();
        }

        this._onDidChange.fire();
        this._onNewError.fire(error);
    }

    getAll(): ErrorEntry[] {
        return [...this.errors];
    }

    getByWatcher(watcherId: string): ErrorEntry[] {
        return this.errors.filter((e) => e.watcherId === watcherId);
    }

    getPending(): ErrorEntry[] {
        return this.errors.filter((e) => e.status === 'pending');
    }

    markSent(id: string, query?: string): void {
        const error = this.errors.find((e) => e.id === id);
        if (error) {
            error.status = 'sent';
            error.sentAt = Date.now();
            if (query) { error.agentSessionQuery = query; }
            this._onDidChange.fire();
        }
    }

    markWorking(id: string): void {
        const error = this.errors.find((e) => e.id === id);
        if (error) {
            error.status = 'working';
            this._onDidChange.fire();
        }
    }

    markAttention(id: string): void {
        const error = this.errors.find((e) => e.id === id);
        if (error) {
            error.status = 'attention';
            this._onDidChange.fire();
        }
    }

    markAgentError(id: string): void {
        const error = this.errors.find((e) => e.id === id);
        if (error) {
            error.status = 'error';
            this._onDidChange.fire();
        }
    }

    markResolved(id: string): void {
        const error = this.errors.find((e) => e.id === id);
        if (error) {
            error.status = 'resolved';
            this._onDidChange.fire();
        }
    }

    remove(id: string): void {
        this.errors = this.errors.filter((e) => e.id !== id);
        this._onDidChange.fire();
    }

    clear(): void {
        this.errors = [];
        this._onDidChange.fire();
    }

    get pendingCount(): number {
        return this.errors.filter((e) => e.status === 'pending').length;
    }

    get totalCount(): number {
        return this.errors.length;
    }

    dispose(): void {
        this._onDidChange.dispose();
        this._onNewError.dispose();
    }
}
