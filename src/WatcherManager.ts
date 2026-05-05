import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { WatcherConfig, ErrorEntry, DEFAULT_ERROR_PATTERNS, DEFAULT_WARNING_PATTERNS } from './types';
import { ErrorQueue } from './ErrorQueue';

export class WatcherManager implements vscode.Disposable {
    private fileWatchers = new Map<string, vscode.Disposable>();
    private filePositions = new Map<string, number>();
    private resolvedPaths = new Map<string, string>();
    private fileEncodings = new Map<string, BufferEncoding>();
    private terminalDisposable: vscode.Disposable | undefined;
    private pollTimer: ReturnType<typeof setInterval> | undefined;
    private configs: WatcherConfig[] = [];
    private multiLineBuffer = new Map<string, { lines: string[]; timer: NodeJS.Timeout; error?: ErrorEntry }>();
    private readonly output = vscode.window.createOutputChannel('MEDIC');
    private wsServer: WebSocketServer | undefined;
    private wsClients = new Set<WebSocket>();
    private readonly WS_PORT = 18988;
    /** Recent web messages for dedup: key → timestamp */
    private wsRecentMessages = new Map<string, number>();
    private wsRecentCleanupTimer: ReturnType<typeof setInterval> | undefined;

    /** Strip ANSI escape sequences (color codes, cursor movement, etc.) */
    private static stripAnsi(str: string): string {
        // eslint-disable-next-line no-control-regex
        return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    }

    /** Extract a timestamp from a log line. Returns epoch ms, or Date.now() if none found. */
    private static extractTimestamp(line: string): number {
        // ISO 8601: 2026-04-13T10:00:01.123Z or 2026-04-13T10:00:01+00:00
        const isoMatch = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/.exec(line);
        if (isoMatch) {
            const parsed = Date.parse(isoMatch[0]);
            if (!isNaN(parsed)) { return parsed; }
        }
        // Common log format: 2026-04-13 10:00:01 or 2026/04/13 10:00:01
        const commonMatch = /(\d{4}[-/]\d{2}[-/]\d{2})\s+(\d{2}:\d{2}:\d{2})/.exec(line);
        if (commonMatch) {
            const parsed = Date.parse(`${commonMatch[1].replace(/\//g, '-')}T${commonMatch[2]}Z`);
            if (!isNaN(parsed)) { return parsed; }
        }
        return Date.now();
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
        this.migratePatterns();
        this.startAll();
    }

    /** Auto-add any new default patterns to existing watchers that are missing them. */
    private migratePatterns(): void {
        let changed = false;
        for (const c of this.configs) {
            for (const p of DEFAULT_ERROR_PATTERNS) {
                if (!c.errorPatterns.includes(p)) {
                    c.errorPatterns.push(p);
                    changed = true;
                }
            }
            for (const p of DEFAULT_WARNING_PATTERNS) {
                if (!c.warningPatterns.includes(p)) {
                    c.warningPatterns.push(p);
                    changed = true;
                }
            }
        }
        if (changed) {
            this.output.appendLine('[Migration] Added new default patterns to existing watchers');
            this.saveConfigs();
        }
    }

    getConfigs(): WatcherConfig[] {
        return [...this.configs];
    }

    /** Number of currently connected browser extension WebSocket clients. */
    getBrowserClientCount(): number {
        return this.wsClients.size;
    }

    /**
     * Discovery-only refresh. Does NOT read file content or scan for errors.
     * - Scans common log directories (logs/, log/, root) for *.log files.
     * - Discovers currently open VS Code terminals.
     * - Removes auto-discovered file watchers whose files no longer exist.
     * - Never removes manual, archived, or pinned (protectedIds) watchers.
     * Returns the number of watchers added/removed for UI feedback.
     */
    async discoverAll(protectedIds?: Set<string>): Promise<{ added: number; removed: number }> {
        const existingPaths = new Set(this.configs.map(c => c.path));
        let added = 0;
        let removed = 0;

        // 1. Scan for *.log files in common directories
        const workRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workRoot) {
            const logDirs = ['logs', 'log'].map(d => path.join(workRoot, d));
            // Also check workspace root for stray .log files
            logDirs.push(workRoot);

            for (const dir of logDirs) {
                if (!fs.existsSync(dir)) { continue; }
                let files: string[];
                try { files = fs.readdirSync(dir).filter(f => f.endsWith('.log')); }
                catch { continue; }

                for (const file of files) {
                    const relPath = path.relative(workRoot, path.join(dir, file)).replace(/\\/g, '/');
                    if (existingPaths.has(relPath)) { continue; }
                    const name = file.replace(/\.log$/, '')
                        .split(/[-_]/)
                        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(' ');
                    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                    this.configs.push({
                        id, name, type: 'file', path: relPath,
                        errorPatterns: [...DEFAULT_ERROR_PATTERNS],
                        warningPatterns: [...DEFAULT_WARNING_PATTERNS],
                        enabled: false,
                    });
                    existingPaths.add(relPath);
                    added++;
                }
            }
        }

        // 2. Discover currently open VS Code terminals
        for (const terminal of vscode.window.terminals) {
            const termPath = `terminal://${terminal.name}`;
            if (existingPaths.has(termPath)) { continue; }
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            this.configs.push({
                id, name: terminal.name, type: 'terminal', path: termPath,
                errorPatterns: [...DEFAULT_ERROR_PATTERNS],
                warningPatterns: [...DEFAULT_WARNING_PATTERNS],
                enabled: false,
            });
            existingPaths.add(termPath);
            added++;
        }

        // 3. Discover running OS processes that reference the workspace
        const { added: processAdded, updated: processUpdated, pidInfo } = await this.discoverOsProcesses(protectedIds);
        added += processAdded;

        // 4. Deduplicate: remove file watchers whose path is claimed by a process watcher
        const claimedLogPaths = new Set<string>();
        for (const c of this.configs) {
            if (c.type === 'process' && c.logFile) {
                claimedLogPaths.add(path.resolve(c.logFile).toLowerCase());
            }
        }
        if (claimedLogPaths.size > 0) {
            const dupeFileIds: string[] = [];
            for (const c of this.configs) {
                if (c.type !== 'file') { continue; }
                if (c.manual || c.archived || protectedIds?.has(c.id)) { continue; }
                const resolved = path.resolve(this.resolvedPaths.get(c.id) ?? this.resolvePath(c.path)).toLowerCase();
                if (claimedLogPaths.has(resolved)) {
                    dupeFileIds.push(c.id);
                    this.output.appendLine(`[dedup] Removing file watcher '${c.name}' — claimed by process watcher`);
                }
            }
            for (const id of dupeFileIds) {
                this.stopWatcher(id);
                this.configs = this.configs.filter(c => c.id !== id);
                removed++;
            }
        }

        // 5. Clean up stale auto-discovered watchers
        const toRemove: string[] = [];
        for (const config of this.configs) {
            // Never auto-remove manual/archived watchers. Pinned protection
            // applies to non-web watchers only; stale web tab watchers should
            // always be eligible for cleanup.
            if (config.manual || config.archived) { continue; }
            if (config.type !== 'web' && protectedIds?.has(config.id)) { continue; }

            if (config.type === 'file') {
                const resolved = this.resolvedPaths.get(config.id) ?? this.resolvePath(config.path);
                if (!fs.existsSync(resolved)) {
                    toRemove.push(config.id);
                }
            } else if (config.type === 'process') {
                // Check if the process is still running by PID
                if (config.pid) {
                    const stillRunning = pidInfo.has(config.pid);
                    if (!stillRunning) {
                        toRemove.push(config.id);
                    }
                }
            } else if (config.type === 'web') {
                // Remove web watchers when no browser extension is connected
                if (this.wsClients.size === 0) {
                    toRemove.push(config.id);
                }
            }
        }

        for (const id of toRemove) {
            this.stopWatcher(id);
            this.configs = this.configs.filter(c => c.id !== id);
            removed++;
        }

        if (added > 0 || removed > 0 || processUpdated > 0) {
            await this.saveConfigs();
            this._onDidChangeConfigs.fire();
        }

        // If browser clients are connected, ask them to report active tabs so
        // stale web watchers are pruned asynchronously via handleWebSocketMessage
        if (this.wsClients.size > 0) {
            const req = JSON.stringify({ type: 'getActiveTabs' });
            for (const client of this.wsClients) {
                try { client.send(req); } catch { /* ignore */ }
            }
        }

        return { added, removed };
    }

    /**
     * Discover a single terminal as it opens.
     * Called from extension.ts onDidOpenTerminal handler.
     */
    async discoverTerminal(terminal: vscode.Terminal): Promise<void> {
        const termPath = `terminal://${terminal.name}`;
        const existing = this.configs.find(c => c.path === termPath);
        if (existing) { return; }

        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        this.configs.push({
            id, name: terminal.name, type: 'terminal', path: termPath,
            errorPatterns: [...DEFAULT_ERROR_PATTERNS],
            warningPatterns: [...DEFAULT_WARNING_PATTERNS],
            enabled: false,
        });
        await this.saveConfigs();
        this._onDidChangeConfigs.fire();
    }

    /** Ignored executables that are intermediate / noise processes */
    private static readonly IGNORED_EXES = new Set([
        'powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash', 'sh', 'zsh',
        'conhost.exe', 'wsl.exe', 'explorer.exe', 'code.exe', 'code-insiders.exe',
        'dotnet.exe', 'npm.cmd', 'npx.cmd', 'git.exe',
    ]);

    /**
     * Derive a human-readable name from a process entry.
     * For node.exe: extracts the JS script basename (e.g., "vite.js" → "vite js (node)").
     * For esbuild.exe: extracts short path context.
     * For BitingLip.* .NET exes: "cloud gateway exe (BitingLip.Cloud.Gateway)".
     * For other exes: camelCase split, strip "Service" suffix.
     */
    private static deriveName(proc: { name: string; cmd: string }): string {
        const exeName = proc.name.toLowerCase();

        // node.exe → extract JS file from args: "vite js (node)"
        if (exeName === 'node.exe') {
            const jsMatch = /node["']?\s+["']?(?:[^\s"']*[\\/])?([^\s"'\\/]+\.(?:js|mjs|cjs))["']?/i.exec(proc.cmd);
            if (jsMatch) {
                return jsMatch[1].replace(/\./g, ' ').trim() + ' (node)';
            }
            return 'node';
        }

        // esbuild.exe → "esbuild exe" with short path hint
        if (exeName === 'esbuild.exe') {
            return 'esbuild exe';
        }

        const rawName = proc.name.replace(/\.exe$/i, '');

        // BitingLip.Cloud.Gateway → "cloud gateway exe (BitingLip.Cloud.Gateway)"
        const dotParts = rawName.split('.');
        if (dotParts.length >= 2 && dotParts[0].toLowerCase() === 'bitinglip') {
            const shortName = dotParts.slice(1).join(' ').toLowerCase();
            return `${shortName} exe (${rawName})`;
        }

        // GeminiProxyService → "Gemini Proxy"
        return rawName
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[._-]/g, ' ')
            .replace(/Service$/i, '')
            .trim();
    }

    /**
     * Extract a log file path from a process command line.
     * Supports: Tee-Object -FilePath '...', -RedirectStandardOutput '...',
     * stdout redirect (> or >>), and Linux tee <path>.
     */
    private static extractLogFilePath(cmd: string): string | null {
        // PowerShell Tee-Object -FilePath '<path>' or Tee-Object '<path>'
        const teeMatch = /Tee-Object\s+(?:-FilePath\s+)?['"]([^'"]+)['"]/i.exec(cmd);
        if (teeMatch) { return teeMatch[1]; }

        // -RedirectStandardOutput '<path>'
        const redirectMatch = /-RedirectStandardOutput\s+['"]([^'"]+)['"]/i.exec(cmd);
        if (redirectMatch) { return redirectMatch[1]; }

        // Shell redirect: > file.log or >> file.log
        const shellRedirect = /(?:>>?)\s*['"]?([^'"\s]+\.log)['"]?/i.exec(cmd);
        if (shellRedirect) { return shellRedirect[1]; }

        // Linux tee <path>
        const teePipe = /\|\s*tee\s+(?:-a\s+)?['"]?([^'"\s]+\.log)['"]?/i.exec(cmd);
        if (teePipe) { return teePipe[1]; }

        return null;
    }

    /**
     * Walk up the process parent chain (via pidInfo) to find a log file path.
     * Tries the process itself first, then parents up to maxDepth levels.
     */
    private static resolveLogFile(
        cmd: string,
        parentPid: number | undefined,
        pidInfo: Map<number, { parentPid: number; cmd: string }>,
        maxDepth = 5,
    ): string | null {
        // Try the process itself
        const direct = WatcherManager.extractLogFilePath(cmd);
        if (direct) { return direct; }

        // Walk up parents
        let currentPid = parentPid;
        for (let i = 0; i < maxDepth && currentPid !== undefined; i++) {
            const info = pidInfo.get(currentPid);
            if (!info) { break; }
            const found = WatcherManager.extractLogFilePath(info.cmd);
            if (found) { return found; }
            currentPid = info.parentPid;
        }
        return null;
    }

    /**
     * Scan ALL running OS processes via Get-CimInstance Win32_Process.
     * Returns:
     *  - procs: workspace-filtered processes (exe not in IGNORED_EXES, cmd contains workspace root)
     *  - pidInfo: Map of ALL process PIDs to {parentPid, cmd} for parent chain walking
     */
    private scanOsProcesses(): { procs: Array<{ pid: number; parentPid: number; name: string; cmd: string }>; pidInfo: Map<number, { parentPid: number; cmd: string }> } {
        const workRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workRoot) { return { procs: [], pidInfo: new Map() }; }

        const workRootLower = workRoot.toLowerCase().replace(/\\/g, '/');

        try {
            const psScript = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.CommandLine)" }`;
            const encodedCmd = Buffer.from(psScript, 'utf16le').toString('base64');
            const raw = execSync(`powershell -NoProfile -EncodedCommand ${encodedCmd}`, {
                encoding: 'utf-8',
                timeout: 15000,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'ignore'],  // suppress CLIXML stderr
            });

            const allProcs: Array<{ pid: number; parentPid: number; name: string; cmd: string }> = [];
            const pidInfo = new Map<number, { parentPid: number; cmd: string }>();

            for (const line of raw.split(/\r?\n/)) {
                if (!line.trim()) { continue; }
                const firstPipe = line.indexOf('|');
                if (firstPipe < 0) { continue; }
                const secondPipe = line.indexOf('|', firstPipe + 1);
                if (secondPipe < 0) { continue; }
                const thirdPipe = line.indexOf('|', secondPipe + 1);
                if (thirdPipe < 0) { continue; }

                const pid = parseInt(line.substring(0, firstPipe), 10);
                const parentPid = parseInt(line.substring(firstPipe + 1, secondPipe), 10);
                const name = line.substring(secondPipe + 1, thirdPipe);
                const cmd = line.substring(thirdPipe + 1);

                if (isNaN(pid)) { continue; }

                // Build full PID info map (ALL processes, for parent chain walking)
                pidInfo.set(pid, { parentPid, cmd });

                // Filter workspace-relevant, non-ignored processes
                const exeName = name.toLowerCase();
                if (WatcherManager.IGNORED_EXES.has(exeName)) { continue; }
                const cmdLower = cmd.toLowerCase().replace(/\\/g, '/');
                if (!cmdLower.includes(workRootLower)) { continue; }

                allProcs.push({ pid, parentPid, name, cmd });
            }

            return { procs: allProcs, pidInfo };
        } catch (err) {
            this.output.appendLine(`[scanOsProcesses] Error: ${err}`);
            return { procs: [], pidInfo: new Map() };
        }
    }

    /**
     * Discover running OS processes that reference the workspace.
     * Dynamic scanning — no hardcoded service list. Extracts log file paths
     * by walking the parent process chain to find Tee-Object / redirect targets.
     */
    async discoverOsProcesses(protectedIds?: Set<string>): Promise<{ added: number; updated: number; pidInfo: Map<number, { parentPid: number; cmd: string }> }> {
        if (process.platform !== 'win32') { return { added: 0, updated: 0, pidInfo: new Map() }; } // TODO: Linux/Mac support

        const { procs, pidInfo } = this.scanOsProcesses();
        if (procs.length === 0) { return { added: 0, updated: 0, pidInfo }; }

        const existingPids = new Set(
            this.configs.filter(c => c.type === 'process' && c.pid).map(c => c.pid!)
        );

        let added = 0;

        for (const proc of procs) {
            // Skip if PID already tracked
            if (existingPids.has(proc.pid)) { continue; }

            const rawName = proc.name.replace(/\.exe$/i, '');
            const name = WatcherManager.deriveName(proc);

            // Resolve log file via parent chain
            const logFile = WatcherManager.resolveLogFile(proc.cmd, proc.parentPid, pidInfo);
            const logFileExists = logFile ? fs.existsSync(logFile) : false;

            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const processKey = `process://${proc.pid}/${rawName}`;

            this.configs.push({
                id,
                name,
                type: 'process',
                path: processKey,
                pid: proc.pid,
                logFile: logFile ?? undefined,
                logFileExists,
                errorPatterns: [...DEFAULT_ERROR_PATTERNS],
                warningPatterns: [...DEFAULT_WARNING_PATTERNS],
                enabled: false,
            });
            existingPids.add(proc.pid);
            added++;
            this.output.appendLine(`[Process Discovery] Found ${name} (PID ${proc.pid}${logFile ? ', log: ' + path.basename(logFile) : ', no log'})`);
        }

        // Update logFile/logFileExists and names on existing process watchers
        let updated = 0;
        for (const c of this.configs) {
            if (c.type !== 'process' || !c.pid) { continue; }
            const info = pidInfo.get(c.pid);
            if (!info) {
                this.output.appendLine(`[Process Discovery] Update: ${c.name} (PID ${c.pid}) — not in pidInfo, skipping`);
                continue;
            }

            // Re-derive name from current process info
            const proc = procs.find(p => p.pid === c.pid);
            if (proc) {
                const freshName = WatcherManager.deriveName(proc);
                if (freshName !== c.name) {
                    this.output.appendLine(`[Process Discovery] Rename: "${c.name}" → "${freshName}" (PID ${c.pid})`);
                    c.name = freshName;
                    updated++;
                }
            }

            if (!c.logFile) {
                this.output.appendLine(`[Process Discovery] Update: ${c.name} (PID ${c.pid}) — no logFile, resolving (parentPid=${info.parentPid})...`);
                const logFile = WatcherManager.resolveLogFile(info.cmd, info.parentPid, pidInfo);
                if (logFile) {
                    c.logFile = logFile;
                    c.logFileExists = fs.existsSync(logFile);
                    updated++;
                    this.output.appendLine(`[Process Discovery] Update: ${c.name} (PID ${c.pid}) — resolved log: ${path.basename(logFile)}`);
                } else {
                    this.output.appendLine(`[Process Discovery] Update: ${c.name} (PID ${c.pid}) — resolveLogFile returned null`);
                }
            } else {
                c.logFileExists = fs.existsSync(c.logFile);
            }
        }

        // Second pass: inherit log file from ancestor processes that already have one.
        // This handles deep process trees (e.g., proxy services under a supervisor)
        // where the Tee-Object is too many hops away for direct extraction.
        const pidToLogFile = new Map<number, string>();
        for (const c of this.configs) {
            if (c.type === 'process' && c.pid && c.logFile) {
                pidToLogFile.set(c.pid, c.logFile);
            }
        }
        if (pidToLogFile.size > 0) {
            for (const c of this.configs) {
                if (c.type !== 'process' || !c.pid || c.logFile) { continue; }
                // Walk up parent chain looking for a PID that already has a resolved logFile
                let currentPid: number | undefined = pidInfo.get(c.pid)?.parentPid;
                for (let i = 0; i < 10 && currentPid !== undefined; i++) {
                    const ancestorLog = pidToLogFile.get(currentPid);
                    if (ancestorLog) {
                        c.logFile = ancestorLog;
                        c.logFileExists = fs.existsSync(ancestorLog);
                        updated++;
                        this.output.appendLine(`[Process Discovery] Inherited log '${path.basename(ancestorLog)}' for ${c.name} (PID ${c.pid}) from ancestor PID ${currentPid}`);
                        break;
                    }
                    currentPid = pidInfo.get(currentPid)?.parentPid;
                }
            }
        }

        return { added, updated, pidInfo };
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
        this.startWebSocketServer();

        // Periodic cleanup of the WebSocket dedup cache (every 10s)
        this.wsRecentCleanupTimer = setInterval(() => {
            const cutoff = Date.now() - 5000;
            for (const [key, ts] of this.wsRecentMessages) {
                if (ts < cutoff) { this.wsRecentMessages.delete(key); }
            }
        }, 10_000);
    }

    private startWatcher(config: WatcherConfig): void {
        if (this.fileWatchers.has(config.id)) { return; }

        if (config.type === 'file') {
            this.startFileWatcher(config);
        } else if (config.type === 'process' && config.logFile && config.logFileExists) {
            // Check if another active watcher is already tailing this same log file
            const resolvedLog = path.resolve(config.logFile).toLowerCase();
            const alreadyTailed = this.configs.some(c =>
                c.id !== config.id && c.enabled && this.fileWatchers.has(c.id)
                && c.logFile && path.resolve(c.logFile).toLowerCase() === resolvedLog
            );
            if (alreadyTailed) {
                this.output.appendLine(`[${config.name}] Skipping — another watcher already tails ${path.basename(config.logFile)}`);
                return;
            }
            this.startFileWatcher(config, config.logFile);
        }
        // Terminal watchers are handled by the shared terminal listener
    }

    // ── File Watching ────────────────────────────────────────────────

    private startFileWatcher(config: WatcherConfig, pathOverride?: string): void {
        const resolvedPath = pathOverride ?? this.resolvePath(config.path);
        this.resolvedPaths.set(config.id, resolvedPath);

        // Start reading from current end of file (only new content going forward)
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

            // Try error patterns first
            let matched = false;
            for (const patternStr of config.errorPatterns) {
                try {
                    const pattern = new RegExp(patternStr, 'i');
                    const match = pattern.exec(line);
                    if (match) {
                        this.handleErrorMatch(config, line, match, 'error');
                        matched = true;
                        break;
                    }
                } catch {
                    // Invalid regex — skip
                }
            }

            // Then try warning patterns
            if (!matched && config.warningPatterns) {
                for (const patternStr of config.warningPatterns) {
                    try {
                        const pattern = new RegExp(patternStr, 'i');
                        const match = pattern.exec(line);
                        if (match) {
                            this.handleErrorMatch(config, line, match, 'warning');
                            matched = true;
                            break;
                        }
                    } catch {
                        // Invalid regex — skip
                    }
                }
            }

            // Accumulate stack trace continuation lines into the buffered error
            if (!matched) {
                const bufferKey = config.id;
                const existing = this.multiLineBuffer.get(bufferKey);
                if (existing && /^\s+at\s/.test(line)) {
                    clearTimeout(existing.timer);
                    existing.lines.push(line);
                    const timer = setTimeout(() => {
                        this.flushMultiLineBuffer(bufferKey);
                    }, 200);
                    existing.timer = timer;
                }
            }
        }
    }

    private handleErrorMatch(config: WatcherConfig, line: string, match: RegExpExecArray, severity: 'error' | 'warning'): void {
        // Try to capture multi-line stack traces
        const bufferKey = config.id;
        const existing = this.multiLineBuffer.get(bufferKey);
        if (existing) {
            clearTimeout(existing.timer);
            // Flush the previous buffered error immediately before starting a new one
            this.flushMultiLineBuffer(bufferKey);
        }

        const message = match.groups?.['message'] ?? match[1] ?? line.trim();
        const file = match.groups?.['file'];
        const lineNum = match.groups?.['line'] ? parseInt(match.groups['line'], 10) : undefined;

        // Extract timestamp from the log line if present (ISO 8601 or common formats)
        const timestamp = WatcherManager.extractTimestamp(line);

        const error: ErrorEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            timestamp,
            source: config.name,
            watcherId: config.id,
            message: message.trim(),
            file,
            line: lineNum,
            stackTrace: undefined,
            raw: line.trim(),
            severity,
            status: 'pending',
        };

        // Debounce slightly to allow stack trace lines to accumulate
        const timer = setTimeout(() => {
            this.flushMultiLineBuffer(bufferKey);
        }, 200);

        this.multiLineBuffer.set(bufferKey, { lines: [line], timer, error });
    }

    private flushMultiLineBuffer(bufferKey: string): void {
        const entry = this.multiLineBuffer.get(bufferKey);
        if (!entry?.error) { return; }
        this.multiLineBuffer.delete(bufferKey);

        // Assemble stack trace from continuation lines (skip the first line which is the error itself)
        if (entry.lines.length > 1) {
            const traceLines = entry.lines.slice(1);
            entry.error.stackTrace = traceLines.join('\n');
            entry.error.raw = entry.lines.join('\n');

            // If the initial pattern didn't capture file/line, extract from first stack frame
            if (!entry.error.file) {
                // Node/JS: at func (file:line:col)
                const nodeMatch = /\(([^)]+):(\d+):\d+\)/.exec(traceLines[0]);
                // .NET: in file:line N
                const dotnetMatch = /in (.+):line (\d+)/.exec(traceLines[0]);
                const frameMatch = nodeMatch || dotnetMatch;
                if (frameMatch) {
                    entry.error.file = frameMatch[1];
                    entry.error.line = parseInt(frameMatch[2], 10);
                }
            }
        }

        this.errorQueue.push(entry.error);
    }

    // ── Public Helpers ──────────────────────────────────────────────────

    /**
     * For file watchers: returns the resolved absolute path.
     * For process watchers: searches `logs/` for files matching the process prefix
     * and returns all matching absolute paths.
     */
    getLogFilePaths(id: string): string[] {
        const config = this.configs.find(c => c.id === id);
        if (!config) { return []; }

        if (config.type === 'file') {
            return [this.resolvedPaths.get(id) ?? this.resolvePath(config.path)];
        }

        if (config.type === 'process' && config.logFile) {
            return [config.logFile];
        }

        return [];
    }

    // ── Private Helpers ──────────────────────────────────────────────

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

    // ── WebSocket Server (Browser Console) ───────────────────────────

    private startWebSocketServer(): void {
        if (this.wsServer) { return; }

        try {
            this.wsServer = new WebSocketServer({ port: this.WS_PORT });
            this.output.appendLine(`[WebSocket] Server listening on ws://localhost:${this.WS_PORT}`);

            this.wsServer.on('connection', (ws, req) => {
                this.output.appendLine(`[WebSocket] Client connected`);
                this.wsClients.add(ws);
                this._onDidChangeConfigs.fire();

                ws.send(JSON.stringify({ type: 'connected' }));

                ws.on('message', (data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        this.handleWebSocketMessage(msg);
                    } catch (e) {
                        this.output.appendLine(`[WebSocket] Bad message: ${e}`);
                    }
                });

                ws.on('close', () => {
                    this.wsClients.delete(ws);
                    this.output.appendLine(`[WebSocket] Client disconnected`);
                    this.cleanupWebWatchers();
                    this._onDidChangeConfigs.fire();
                });

                ws.on('error', (err) => {
                    this.output.appendLine(`[WebSocket] Client error: ${err.message}`);
                    this.wsClients.delete(ws);
                });
            });

            this.wsServer.on('error', (err) => {
                this.output.appendLine(`[WebSocket] Server error: ${err.message}`);
                if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
                    this.output.appendLine(`[WebSocket] Port ${this.WS_PORT} in use — Web Console disabled`);
                }
            });
        } catch (err) {
            this.output.appendLine(`[WebSocket] Failed to start: ${err}`);
        }
    }

    /** Remove web watchers when no browser clients are connected */
    private cleanupWebWatchers(): void {
        if (this.wsClients.size > 0) { return; }
        const webIds = this.configs.filter(c => c.type === 'web' && !c.manual && !c.archived).map(c => c.id);
        if (webIds.length === 0) { return; }
        for (const id of webIds) {
            this.stopWatcher(id);
        }
        this.configs = this.configs.filter(c => c.type !== 'web' || c.manual || c.archived);
        this.saveConfigs();
        this._onDidChangeConfigs.fire();
        this.output.appendLine(`[WebSocket] Cleaned up ${webIds.length} web watcher(s) — no clients connected`);
    }

    private ensureWebWatcher(tabId: number | string, tabTitle: string, tabUrl: string): string {
        // Stable ID per browser tab
        const id = `web://tab/${tabId}`;
        const existing = this.configs.find(c => c.id === id);

        // Derive a display name from title or URL
        let name = tabTitle;
        if (!name) {
            try {
                const url = new URL(tabUrl);
                name = url.hostname + (url.port ? ':' + url.port : '') + url.pathname;
            } catch {
                name = tabUrl || `Tab ${tabId}`;
            }
        }
        // Truncate long titles
        if (name.length > 60) { name = name.substring(0, 57) + '…'; }

        if (existing) {
            // Update name if the tab title changed
            if (existing.name !== name) {
                existing.name = name;
                existing.path = tabUrl;
                this.saveConfigs();
                this._onDidChangeConfigs.fire();
            }
            return existing.id;
        }

        const config: WatcherConfig = {
            id,
            name,
            type: 'web',
            path: tabUrl,
            errorPatterns: [],   // Not used — browser sends structured data
            warningPatterns: [], // Not used — browser sends structured data
            enabled: true,
        };

        this.configs.push(config);
        this.saveConfigs();
        this._onDidChangeConfigs.fire();
        this.output.appendLine(`[WebSocket] Created web watcher: ${name} (${id})`);
        return id;
    }

    /**
     * Handle a structured message from the browser extension.
     * Expected shape:
     * {
     *   type: 'error' | 'warning',
     *   message: string,
     *   source?: string,     // file URL
     *   lineno?: number,
     *   colno?: number,
     *   stack?: string,
     *   url: string,          // page URL
     *   tabId?: number,       // Chrome tab ID
     *   tabTitle?: string,    // Chrome tab title
     *   tabUrl?: string,      // Chrome tab URL
     *   timestamp?: number
     * }
     */
    private handleWebSocketMessage(msg: any): void {
        if (!msg || !msg.type) { return; }

        // ── Active tab report: prune watchers for tabs no longer open/approved ──
        if (msg.type === 'activeTabs' && Array.isArray(msg.tabs)) {
            const activeIds = new Set<string>(msg.tabs.map((t: any) => `web://tab/${t.tabId}`));
            const toRemove = this.configs
                .filter(c => c.type === 'web' && !c.manual && !c.archived && !activeIds.has(c.id))
                .map(c => c.id);
            if (toRemove.length > 0) {
                for (const id of toRemove) { this.stopWatcher(id); }
                this.configs = this.configs.filter(c => !toRemove.includes(c.id));
                this.saveConfigs();
                this._onDidChangeConfigs.fire();
                this.output.appendLine(`[WebSocket] Pruned ${toRemove.length} stale web watcher(s)`);
            }
            // Also surface approved tabs immediately so users see what's connected,
            // even before any error has been emitted from the page.
            let added = 0;
            for (const t of msg.tabs) {
                if (t == null || t.tabId === undefined) { continue; }
                const id = `web://tab/${t.tabId}`;
                if (!this.configs.find(c => c.id === id)) {
                    this.ensureWebWatcher(t.tabId, t.tabTitle ?? '', t.tabUrl ?? '');
                    added++;
                }
            }
            if (added > 0) {
                this.output.appendLine(`[WebSocket] Registered ${added} active tab watcher(s)`);
            }
            return;
        }

        if (!msg.message) { return; }

        const tabId = msg.tabId ?? 0;

        // ── Dedup: drop identical messages within a 2-second window ──
        const dedupKey = `${tabId}|${msg.type}|${msg.message}`;
        const now = Date.now();
        const lastSeen = this.wsRecentMessages.get(dedupKey);
        if (lastSeen && now - lastSeen < 2000) {
            return; // Silently drop rapid duplicate
        }
        this.wsRecentMessages.set(dedupKey, now);

        // Ensure a per-tab watcher exists
        const watcherId = this.ensureWebWatcher(tabId, msg.tabTitle ?? '', msg.tabUrl ?? msg.url ?? '');

        const severity: 'error' | 'warning' = msg.type === 'warning' ? 'warning' : 'error';

        // Build a raw line for deduplication
        const raw = msg.stack
            ? `${msg.message}\n${msg.stack}`
            : msg.message;

        const entry: ErrorEntry = {
            id: '',          // assigned by ErrorQueue
            timestamp: msg.timestamp ?? now,
            source: msg.url ?? msg.tabUrl ?? '',
            watcherId,
            message: msg.message,
            file: msg.source,
            line: msg.lineno,
            stackTrace: msg.stack,
            raw,
            severity,
            status: 'pending',
        };

        this.errorQueue.push(entry);
        this.output.appendLine(`[WebSocket] ${severity}: ${msg.message.substring(0, 120)}`);
    }

    dispose(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        if (this.wsRecentCleanupTimer) {
            clearInterval(this.wsRecentCleanupTimer);
            this.wsRecentCleanupTimer = undefined;
        }
        for (const watcher of this.fileWatchers.values()) {
            watcher.dispose();
        }
        this.fileWatchers.clear();
        this.resolvedPaths.clear();
        this.terminalDisposable?.dispose();

        // WebSocket server
        for (const client of this.wsClients) {
            try { client.close(); } catch { /* ignore */ }
        }
        this.wsClients.clear();
        if (this.wsServer) {
            this.wsServer.close();
            this.wsServer = undefined;
        }

        for (const buf of this.multiLineBuffer.values()) {
            clearTimeout(buf.timer);
        }
        this.multiLineBuffer.clear();

        this._onDidChangeConfigs.dispose();
        this.output.dispose();
    }
}
