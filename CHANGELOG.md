# Changelog

All notable changes to the **MEDIC** extension will be documented in this file.

## [1.0.1] — 2026-04-14

### Fixed
- **Watchers not rendering on startup** — Missing `feed-title-clear` DOM element caused `renderFeedTitle()` to throw, crashing the entire `render()` pipeline before `renderWatchers()` could run
- Added null-guards for `$feedTitleClear` style access

## [1.0.0] — 2026-04-14

### Added
- **Process discovery** — Automatically finds running OS processes referencing the workspace via `Get-CimInstance Win32_Process`
- **Log file resolution** — Extracts log paths from `Tee-Object`, `-RedirectStandardOutput`, shell redirects (`>`), and Linux `tee` by walking up to 5 levels of the parent process chain
- **Ancestor log inheritance** — Processes deep in the tree (e.g., proxy services under a supervisor) inherit log files from ancestor processes
- **Frontend grouping** — Processes sharing a log file (e.g., vite + esbuild) are grouped into collapsible clusters
- **Smart process naming** — `BitingLip.Cloud.Gateway` → `cloud gateway exe (BitingLip.Cloud.Gateway)`, node.exe running vite.js → `vite js (node)`, proxy services → `Gemini Proxy`
- **Terminals section** — VS Code terminals now appear in their own sidebar section, separate from log file watchers
- **Four-section sidebar** — Processes, Terminals, Web Console, Logs — each with accurate grouped counts
- **Error status pipeline** — Full lifecycle: `pending → working → resolved / attention / agent error`
- **Status commands** — `markWorking`, `markAttention`, `markAgentError`, `resolveError` — callable by Copilot agents
- **Compose box** — Select multiple errors as chips, choose agent mode + model, add context notes, then dispatch
- **Model picker** — Auto-detects available language models, deduplicates by name, groups by vendor
- **Agent picker** — Choose between chat modes (Agent/Ask/Plan) and custom agent participants
- **Severity vs. status icons** — Code block sidebar always shows error/warning severity; card header shows job status

### Fixed
- PowerShell `$` escaping in process scanning (switched to `-EncodedCommand` with base64-encoded UTF-16LE)
- Stale process cleanup now checks PID existence instead of matching terminal names
- Log file updates on existing watchers now persist to globalState (save condition includes `processUpdated`)
- Process names re-derived on each discovery cycle to pick up naming improvements

### Changed
- Version bump to 1.0.0

## [0.1.0] — 2026-04-12

### Added
- Initial release
- File and terminal watcher system with built-in presets for .NET, Python, Node.js, Rust, Go
- Live error dashboard with two-column layout (error feed + watchers sidebar)
- Copilot Chat integration — send errors with full context in one click
- Chat mode selector (Agent / Ask / Plan)
- Language model selector with auto-detection
- Session mode (new session / active session)
- Agent participant routing (`@workspace`, `@terminal`, `@vscode`)
- Approval mode selector (confirm / auto-approve)
- Compose box for adding user notes to error dispatches
- Customizable prompt templates with variable substitution
- Duplicate error grouping with occurrence counting
- Error lifecycle tracking (pending → sent → resolved)
- Auto-trigger mode with configurable debounce
- Status bar indicator for pending error count
- Workspace scanning for common log file paths
- UTF-16LE encoding and ANSI color code support
