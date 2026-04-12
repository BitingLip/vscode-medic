import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WatcherConfig, ErrorEntry } from './types';
import { ErrorQueue } from './ErrorQueue';

export class WatcherManager implements vscode.Disposable {
    private fileWatchers = new Map<string, vscode.Disposable>();
    private filePositions = new Map<string, number>();
    private resolvedPaths = new Map<string, string>();
    private fileEncodings = new Map<string, BufferEncoding>();
    private terminalDisposable: vscode.Disposable | undefined;
    private pollTimer: ReturnType<typeof setInterval> | undefined;
    private configs: WatcherConfig[] = [];
    private multiLineBuffer = new Map<string, { lines: string[]; timer: NodeJS.Timeout }>();
    private readonly output = vscode.window.createOutputChannel('MEDIC');

    /** Strip ANSI escape sequences (color codes, cursor movement, etc.) */
    private static stripAnsi(str: string): string {
        // eslint-disable-next-line no-control-regex
        return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    }

    /** Detect file encoding from first bytes: UTF-16LE BOM or null-byte interleaving */
    private detectEncoding(filePath: string): BufferEncoding {
        const cached = this.fileEncodings.get(filePath);
        if (cached) { return cached; }

        let encoding: BufferEncoding = 'utf-8';
        try {
            const fd = fs.openSync(filePath, 'r');
            const header = Buffer.alloc(4);
            fs.readSync(fd, header, 0, 4, 0);
            fs.closeSync(fd);

            // UTF-16LE BOM: FF FE
            if (header[0] === 0xFF && header[1] === 0xFE) {
                encoding = 'utf16le';
            }
            // No BOM but null bytes interleaved (e.g. 'H\0e\0l\0')
            else if (header[1] === 0x00 && header[3] === 0x00) {
                encoding = 'utf16le';
            }
        } catch {
            // Can't read — default to utf-8
        }

        this.fileEncodings.set(filePath, encoding);
        return encoding;
    }

    private readonly _onDidChangeConfigs = new vscode.EventEmitter<void>();
    readonly onDidChangeConfigs = this._onDidChangeConfigs.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly errorQueue: ErrorQueue,
    ) {
        this.configs = context.globalState.get<WatcherConfig[]>('watcherConfigs', []);
        this.startAll();
    }

    getConfigs(): WatcherConfig[] {
        return [...this.configs];
    }

    async addWatcher(config: WatcherConfig): Promise<void> {
        this.configs.push(config);
        await this.saveConfigs();
        if (config.enabled) {
            this.startWatcher(config);
        }
        this._onDidChangeConfigs.fire();
    }

    async removeWatcher(id: string): Promise<void> {
        this.stopWatcher(id);
        this.configs = this.configs.filter((c) => c.id !== id);
        await this.saveConfigs();
        this._onDidChangeConfigs.fire();
    }

    async toggleWatcher(id: string): Promise<void> {
        const config = this.configs.find((c) => c.id === id);
        if (!config) { return; }

        config.enabled = !config.enabled;
        if (config.enabled) {
            this.startWatcher(config);
        } else {
            this.stopWatcher(id);
        }
        await this.saveConfigs();
        this._onDidChangeConfigs.fire();
    }

    async updateWatcher(id: string, updates: Partial<WatcherConfig>): Promise<void> {
        const config = this.configs.find((c) => c.id === id);
        if (!config) { return; }

        this.stopWatcher(id);
        Object.assign(config, updates);
        if (config.enabled) {
            this.startWatcher(config);
        }
        await this.saveConfigs();
        this._onDidChangeConfigs.fire();
    }

    // ── Lifecycle ────────────────────────────────────────────────────

    private startAll(): void {
        for (const config of this.configs) {
            if (config.enabled) {
                this.startWatcher(config);
            }
        }
        this.startTerminalListener();
        this.startPolling();
    }

    private startWatcher(config: WatcherConfig): void {
        if (this.fileWatchers.has(config.id)) { return; }

        if (config.type === 'file') {
            this.startFileWatcher(config);
        }
        // Terminal watchers are handled by the shared terminal listener
    }

    // ── File Watching ────────────────────────────────────────────────

    private startFileWatcher(config: WatcherConfig): void {
        const resolvedPath = this.resolvePath(config.path);
        this.resolvedPaths.set(config.id, resolvedPath);

        // Start reading from end of file (only new content)
        try {
            const stats = fs.statSync(resolvedPath);
            this.filePositions.set(config.id, stats.size);
            this.output.appendLine(`[${config.name}] Watching ${resolvedPath} (starting at byte ${stats.size})`);
        } catch {
            this.filePositions.set(config.id, 0);
            this.output.appendLine(`[${config.name}] Watching ${resolvedPath} (file not found, starting at 0)`);
        }

        const dirName = path.dirname(resolvedPath);
        const baseName = path.basename(resolvedPath);
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(dirName, baseName),
        );

        const onChange = () => {
            this.output.appendLine(`[${config.name}] FS event detected`);
            this.readNewFileContent(config, resolvedPath);
        };
        const disposables = new vscode.Disposable(() => watcher.dispose());
        watcher.onDidChange(onChange);
        watcher.onDidCreate(onChange);

        this.fileWatchers.set(config.id, disposables);
    }

    private readNewFileContent(config: WatcherConfig, filePath: string): void {
        try {
            const stats = fs.statSync(filePath);
            const lastPos = this.filePositions.get(config.id) ?? 0;

            if (stats.size < lastPos) {
                // File was truncated/rotated — reset position
                this.filePositions.set(config.id, stats.size);
                this.fileEncodings.delete(filePath);
                this.output.appendLine(`[${config.name}] File rotated, resetting position`);
                return;
            }
            if (stats.size === lastPos) { return; }

            const encoding = this.detectEncoding(filePath);
            const newBytes = stats.size - lastPos;
            const buffer = Buffer.alloc(newBytes);
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, buffer.length, lastPos);
            fs.closeSync(fd);

            this.filePositions.set(config.id, stats.size);
            const raw = buffer.toString(encoding);
            // Strip null bytes (broken UTF-16 partial reads) and ANSI escape codes
            const content = WatcherManager.stripAnsi(raw.replace(/\0/g, ''));
            this.output.appendLine(`[${config.name}] Read ${newBytes} bytes (${encoding}), ${content.length} chars`);
            this.processContent(config, content);
        } catch (err) {
            // File may have been deleted or be inaccessible
            this.output.appendLine(`[${config.name}] Read error: ${err}`);
        }
    }

    // ── Polling Fallback ──────────────────────────────────────────────

    private startPolling(): void {
        if (this.pollTimer) { return; }
        this.pollTimer = setInterval(() => this.pollAllFiles(), 2000);
    }

    private pollAllFiles(): void {
        for (const config of this.configs) {
            if (!config.enabled || config.type !== 'file') { continue; }
            const resolvedPath = this.resolvedPaths.get(config.id);
            if (resolvedPath) {
                this.readNewFileContent(config, resolvedPath);
            }
        }
    }
    private startTerminalListener(): void {
        if (this.terminalDisposable) { return; }

        try {
            // onDidWriteTerminalData may be proposed API — property access can throw
            const onData = vscode.window.onDidWriteTerminalData;
            if (typeof onData === 'function') {
                this.terminalDisposable = onData((event: any) => {
                    const termName: string = event.terminal.name;
                    const cleanData = WatcherManager.stripAnsi(event.data);
                    for (const config of this.configs) {
                        if ((config.type === 'terminal' || config.type === 'process') && config.enabled) {
                            if (this.matchTerminalName(termName, config.path)) {
                                this.processContent(config, cleanData);
                            }
                        }
                    }
                });
            }
        } catch {
            // API not available in this VS Code version — terminal watching disabled
        }
    }

    private matchTerminalName(name: string, pattern: string): boolean {
        if (pattern === '*') { return true; }
        // Exact match or simple wildcard
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
            return regex.test(name);
        }
        return name.toLowerCase().includes(pattern.toLowerCase());
    }

    // ── Error Parsing ─────────────────────────────────────────────────

    private processContent(config: WatcherConfig, content: string): void {
        const lines = content.split(/\r?\n/);

        for (const line of lines) {
            if (!line.trim()) { continue; }

            for (const patternStr of config.errorPatterns) {
                try {
                    const pattern = new RegExp(patternStr, 'i');
                    const match = pattern.exec(line);
                    if (match) {
                        this.handleErrorMatch(config, line, match);
                        break; // One match per line is enough
                    }
                } catch {
                    // Invalid regex — skip
                }
            }
        }
    }

    private handleErrorMatch(config: WatcherConfig, line: string, match: RegExpExecArray): void {
        // Try to capture multi-line stack traces
        const bufferKey = config.id;
        const existing = this.multiLineBuffer.get(bufferKey);
        if (existing) {
            clearTimeout(existing.timer);
        }

        const message = match.groups?.['message'] ?? match[1] ?? line.trim();
        const file = match.groups?.['file'];
        const lineNum = match.groups?.['line'] ? parseInt(match.groups['line'], 10) : undefined;

        const error: ErrorEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            timestamp: Date.now(),
            source: config.name,
            watcherId: config.id,
            message: message.trim(),
            file,
            line: lineNum,
            stackTrace: undefined,
            raw: line.trim(),
            status: 'pending',
        };

        // Debounce slightly to allow stack trace lines to accumulate
        const timer = setTimeout(() => {
            this.multiLineBuffer.delete(bufferKey);
            this.errorQueue.push(error);
        }, 200);

        this.multiLineBuffer.set(bufferKey, { lines: [line], timer });
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private resolvePath(p: string): string {
        if (path.isAbsolute(p)) { return p; }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder ? path.join(workspaceFolder.uri.fsPath, p) : p;
    }

    private stopWatcher(id: string): void {
        const watcher = this.fileWatchers.get(id);
        if (watcher) {
            watcher.dispose();
            this.fileWatchers.delete(id);
        }
        this.filePositions.delete(id);
        this.resolvedPaths.delete(id);

        const buffer = this.multiLineBuffer.get(id);
        if (buffer) {
            clearTimeout(buffer.timer);
            this.multiLineBuffer.delete(id);
        }
    }

    private async saveConfigs(): Promise<void> {
        await this.context.globalState.update('watcherConfigs', this.configs);
    }

    dispose(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        for (const watcher of this.fileWatchers.values()) {
            watcher.dispose();
        }
        this.fileWatchers.clear();
        this.resolvedPaths.clear();
        this.terminalDisposable?.dispose();

        for (const buf of this.multiLineBuffer.values()) {
            clearTimeout(buf.timer);
        }
        this.multiLineBuffer.clear();

        this._onDidChangeConfigs.dispose();
        this.output.dispose();
    }
}
