export type WatcherType = 'file' | 'terminal' | 'process' | 'web';

export type WatcherCategory = 'Logs' | 'Processes' | 'Web';

export interface WatcherConfig {
    id: string;
    name: string;
    type: WatcherType;
    /** File path/glob for 'file' watchers, terminal name pattern for 'terminal'/'process' watchers */
    path: string;
    /** Regex patterns to match error lines. Use named groups: (?<message>), (?<file>), (?<line>) */
    errorPatterns: string[];
    enabled: boolean;
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
    status: 'pending' | 'sent' | 'resolved';
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
}

/** Known chat modes/agents for the Agent selector */
export const CHAT_MODES = [
    { id: 'agent', label: 'Agent', icon: 'codicon-copilot', desc: 'Autonomous coding agent' },
    { id: 'ask', label: 'Ask', icon: 'codicon-comment-discussion', desc: 'Ask questions without edits' },
    { id: 'plan', label: 'Plan', icon: 'codicon-list-ordered', desc: 'Plan before making changes' },
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

/** Default watcher configurations for BitingLip services */
export const DEFAULT_WATCHERS: Omit<WatcherConfig, 'id'>[] = [
    // ── Logs (file watchers) ──
    {
        name: 'Cloud Supervisor',
        type: 'file',
        path: 'logs/cloud-supervisor.log',
        errorPatterns: [
            '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
            '(?:fail|crit):\\s*(?<message>.+)',
            'at .+ in (?<file>.+):line (?<line>\\d+)',
        ],
        enabled: true,
    },
    {
        name: 'Cloud Gateway',
        type: 'file',
        path: 'logs/cloud-gateway.log',
        errorPatterns: [
            '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
            '(?:fail|crit):\\s*(?<message>.+)',
            'at .+ in (?<file>.+):line (?<line>\\d+)',
        ],
        enabled: true,
    },
    {
        name: 'Cloud Admin',
        type: 'file',
        path: 'logs/cloud-admin.log',
        errorPatterns: [
            '(?:Error|TypeError|ReferenceError|SyntaxError):\\s*(?<message>.+)',
            '\\[vite\\].*(?:error|Error):\\s*(?<message>.+)',
        ],
        enabled: true,
    },
    {
        name: 'Cloud Anthropic',
        type: 'file',
        path: 'logs/cloud-anthropic.log',
        errorPatterns: [
            '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
            '(?:fail|crit):\\s*(?<message>.+)',
        ],
        enabled: true,
    },
    {
        name: 'Studio Worker',
        type: 'file',
        path: 'logs/studio-worker.log',
        errorPatterns: [
            '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
            '(?:fail|crit):\\s*(?<message>.+)',
            'at .+ in (?<file>.+):line (?<line>\\d+)',
        ],
        enabled: true,
    },
    {
        name: 'Studio Gateway',
        type: 'file',
        path: 'logs/studio-gateway.log',
        errorPatterns: [
            '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
            '(?:fail|crit):\\s*(?<message>.+)',
            'at .+ in (?<file>.+):line (?<line>\\d+)',
        ],
        enabled: true,
    },
    {
        name: 'Studio Frontend',
        type: 'file',
        path: 'logs/studio-frontend.log',
        errorPatterns: [
            '(?:Error|TypeError|ReferenceError|SyntaxError):\\s*(?<message>.+)',
            '\\[vite\\].*(?:error|Error):\\s*(?<message>.+)',
        ],
        enabled: true,
    },
    {
        name: 'Node Orchestrator',
        type: 'file',
        path: 'logs/node-orchestrator.log',
        errorPatterns: [
            '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
            '(?:fail|crit):\\s*(?<message>.+)',
            'at .+ in (?<file>.+):line (?<line>\\d+)',
        ],
        enabled: true,
    },
    {
        name: 'Node Frontend',
        type: 'file',
        path: 'logs/node-frontend.log',
        errorPatterns: [
            '(?:Error|TypeError|ReferenceError|SyntaxError):\\s*(?<message>.+)',
            '\\[vite\\].*(?:error|Error):\\s*(?<message>.+)',
        ],
        enabled: true,
    },
    // ── Processes (terminal watchers) ──
    {
        name: 'Cloud Processes',
        type: 'process',
        path: 'Cloud*',
        errorPatterns: [
            '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
            '(?:fail|crit):\\s*(?<message>.+)',
            '(?:Error|TypeError|SyntaxError):\\s*(?<message>.+)',
        ],
        enabled: false,
    },
    {
        name: 'Studio Processes',
        type: 'process',
        path: 'Studio*',
        errorPatterns: [
            '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
            '(?:fail|crit):\\s*(?<message>.+)',
            '(?:Error|TypeError|SyntaxError):\\s*(?<message>.+)',
        ],
        enabled: false,
    },
    {
        name: 'Node Processes',
        type: 'process',
        path: 'Node*',
        errorPatterns: [
            '(?:Unhandled exception|Exception)[.:]\\s*(?<message>.+)',
            '(?:fail|crit):\\s*(?<message>.+)',
            '(?:Error|TypeError|SyntaxError):\\s*(?<message>.+)',
        ],
        enabled: false,
    },
];
