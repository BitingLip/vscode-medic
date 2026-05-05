# Changelog

All notable changes to the **MEDIC** extension will be documented in this file.

## [1.1.5] — 2026-05-05

### Changed
- **Smaller VSIX** — Excluded stale `media/*.bak` backup files from the package (~85 KB smaller).

## [1.1.4] — 2026-05-05

### Added
- **Web Console install CTA** — When no browser clients are connected, the Web Console section now shows a one-click button that opens Copilot Chat with a step-by-step guide for loading the bundled Chrome extension via `chrome://extensions/`.

### Changed
- **Trash button is filter-aware** — Clearing the feed now respects the active error/warning filters, with a dynamic tooltip and a dimmed state when there is nothing to clear.

## [1.1.0] — 2026-04-14

### Added
- **Browser Console Bridge** — WebSocket server on `ws://localhost:18988` receives errors/warnings from the companion Chrome extension
- **Chrome extension** — Content script hooks `console.error`, `console.warn`, `window.onerror`, and `unhandledrejection`; background service worker manages the WebSocket connection with auto-reconnect and offline queuing; popup UI shows connection status with enable/disable toggle
- **Auto-created web watchers** — Each connecting browser origin automatically gets a watcher in the "Web Console" sidebar section

## [1.0.2] — 2026-04-14

### Changed
- **Settings prefix renamed** — `errorPilot.*` → `medic.*` across all commands, configuration keys, and view IDs
- **Class rename** — `ErrorPilotViewProvider` → `MedicViewProvider` (file and class)

### Added
- **Stack trace extraction** — Multi-line stack traces are now accumulated and parsed; file/line references extracted from Node.js `(file:line:col)` and .NET `in file:line N` frames
- **Stack trace in error cards** — Errors with stack traces now show clickable file references in the dashboard

### Fixed
- **CLIXML stderr noise** — Suppressed PowerShell `#< CLIXML` errors from `Get-CimInstance` process scanning
- **README corrections** — Fixed typos, added missing `sent` status in lifecycle, updated project structure

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
