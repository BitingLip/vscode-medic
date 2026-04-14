export type WatcherType = 'file' | 'terminal' | 'process' | 'web';

export type WatcherCategory = 'Logs' | 'Terminals' | 'Processes' | 'Web';

export interface WatcherConfig {
    id: string;
    name: string;
    type: WatcherType;
    /** File path for 'file' watchers, terminal:// URI for 'terminal' watchers, process:// key for 'process' watchers */
    path: string;
    /** Regex patterns to match error lines. Use named groups: (?<message>), (?<file>), (?<line>) */
    errorPatterns: string[];
    /** Regex patterns to match warning lines. Same named groups as errorPatterns. */
    warningPatterns: string[];
    enabled: boolean;
    /** True if the watcher was manually added by the user (won't be auto-removed on refresh). */
    manual?: boolean;
    /** True if the watcher has been archived by the user. */
    archived?: boolean;
    /** OS process ID (for 'process' watchers, updated on each discovery scan). */
    pid?: number;
    /** Log file path extracted from the process command line (Tee-Object target, stdout redirect, etc.). */
    logFile?: string;
    /** Whether the logFile actually exists on disk (rechecked each discovery). */
    logFileExists?: boolean;
}

export interface ErrorEntry {
    id: string;
    timestamp: number;
    source: string;
    watcherId: string;
    message: string;
    file?: string;
    line?: number;
    stackTrace?: string;
    raw: string;
    severity: 'error' | 'warning';
    status: 'pending' | 'sent' | 'working' | 'attention' | 'error' | 'resolved';
    sentAt?: number;
    agentSessionQuery?: string;
    /** Number of times this error has occurred (1 = first occurrence) */
    occurrences?: number;
    /** Timestamp of the most recent occurrence */
    lastSeenAt?: number;
}

export interface PanelState {
    errors: ErrorEntry[];
    watchers: WatcherConfig[];
    selectedWatcherId: string | null;
    pinnedWatcherIds?: string[];
    agent: string;
    autoTrigger: boolean;
    debounceMs: number;
    approvalMode: string;
    autoDeleteSession: string;
    chatMode: string;
    chatModel: string;
    sessionMode: string;
}

/** Model info sent to the webview */
export interface ModelInfo {
    id: string;
    name: string;
    vendor: string;
    family: string;
    version: string;
    maxInputTokens: number;
}

/** Known chat modes/agents for the Agent selector */
export const CHAT_MODES = [
    { id: 'agent', label: 'Agent', icon: 'codicon-agent', desc: 'Autonomous coding agent' },
    { id: 'ask', label: 'Ask', icon: 'codicon-ask', desc: 'Ask questions without edits' },
    { id: 'plan', label: 'Plan', icon: 'codicon-tasklist', desc: 'Plan before making changes' },
] as const;

export const CUSTOM_AGENTS = [
    { id: 'Architect', label: 'Architect', icon: 'codicon-symbol-structure', desc: 'Evaluate code architecture' },
    { id: 'Designer', label: 'Designer', icon: 'codicon-paintcan', desc: 'Review UI/UX quality' },
    { id: 'Developer', label: 'Developer', icon: 'codicon-code', desc: 'Implement features and fixes' },
    { id: 'DevOps', label: 'DevOps', icon: 'codicon-server-process', desc: 'Infrastructure and CI/CD' },
    { id: 'Documenter', label: 'Documenter', icon: 'codicon-book', desc: 'Keep docs up to date' },
    { id: 'Planner', label: 'Planner', icon: 'codicon-tasklist', desc: 'Research and outline plans' },
    { id: 'Reviewer', label: 'Reviewer', icon: 'codicon-eye', desc: 'Review code quality' },
    { id: 'Tester', label: 'Tester', icon: 'codicon-beaker', desc: 'Write and run tests' },
] as const;

/** Built-in error pattern presets */
export const ERROR_PRESETS: Record<string, string[]> = {
    'Generic': [
        '(?:^|\\s)(?:ERROR|FATAL|CRITICAL)[:\\s]+(?<message>.+)',
    ],
    '.NET / C#': [
        '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
        'at .+ in (?<file>.+):line (?<line>\\d+)',
    ],
    'Python': [
        '(?:Error|Exception|Traceback):\\s*(?<message>.+)',
        'File "(?<file>[^"]+)", line (?<line>\\d+)',
    ],
    'Node.js': [
        '(?:Error|TypeError|ReferenceError|SyntaxError):\\s*(?<message>.+)',
        'at .+ \\((?<file>[^)]+):(?<line>\\d+):\\d+\\)',
    ],
    'Rust': [
        'error\\[E\\d+\\]:\\s*(?<message>.+)',
        '--> (?<file>[^:]+):(?<line>\\d+)',
    ],
    'Go': [
        '(?:panic|fatal error):\\s*(?<message>.+)',
        '\\s+(?<file>[\\w./]+\\.go):(?<line>\\d+)',
    ],
};

/** Built-in warning pattern presets */
export const WARNING_PRESETS: Record<string, string[]> = {
    'Generic': [
        '(?:^|\\s)(?:WARN|WARNING)[:\\s]+(?<message>.+)',
    ],
    '.NET / C#': [
        '(?:warn):\\s*(?<message>.+)',
    ],
    'Python': [
        '(?:Warning|DeprecationWarning|UserWarning|RuntimeWarning):\\s*(?<message>.+)',
    ],
    'Node.js': [
        '\\(node:\\d+\\)\\s*(?<message>.+Warning.+)',
        '(?:Warning|DeprecationWarning):\\s*(?<message>.+)',
    ],
    'Rust': [
        'warning\\[?[^\\]]*\\]?:\\s*(?<message>.+)',
    ],
    'Go': [
        '(?:warning):\\s*(?<message>.+)',
    ],
};

/** Default error patterns for dynamically discovered log files */
export const DEFAULT_ERROR_PATTERNS: string[] = [
    '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
    '(?:fail|crit):\\s*(?<message>.+)',
    '(?:Error|TypeError|ReferenceError|SyntaxError):\\s*(?<message>.+)',
    '\\[vite\\].*(?:error|Error):\\s*(?<message>.+)',
    '\\b(?:ERR|FTL|CRT)\\]\\s*(?<message>.+)',
    'at .+ in (?<file>.+):line (?<line>\\d+)',
];

/** Default warning patterns for dynamically discovered log files */
export const DEFAULT_WARNING_PATTERNS: string[] = [
    '(?:warn):\\s*(?<message>.+)',
    '(?:Warning|DeprecationWarning):\\s*(?<message>.+)',
    '\\[vite\\].*(?:warn|Warning):\\s*(?<message>.+)',
    '\\bWRN\\]\\s*(?<message>.+)',
];
