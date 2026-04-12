# Changelog

All notable changes to the **MEDIC** extension will be documented in this file.

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
