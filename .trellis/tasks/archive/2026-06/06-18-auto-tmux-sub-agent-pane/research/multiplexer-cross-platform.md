# Multiplexer Cross-Platform Research

## Question

Should CLI-Manager use tmux or cmux to implement automatic split panes for Claude/Codex sub-agent workflows across Windows PowerShell, CMD, Git Bash, WSL, Linux, and macOS?

## Sources

* tmux README: https://github.com/tmux/tmux
* cmux website: https://cmux.com/
* cmux GitHub: https://github.com/manaflow-ai/cmux
* Windows Terminal command line docs: https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments

## Findings

### tmux

* tmux is a terminal multiplexer that runs inside a terminal and supports panes, sessions, detach/reattach, and command-driven automation.
* Official README lists OpenBSD, FreeBSD, NetBSD, Linux, macOS, and Solaris support.
* tmux is appropriate for Linux, macOS, and WSL.
* tmux is not a native PowerShell/CMD solution. On Windows native shells, it requires WSL/Cygwin/MSYS2-like Unix environments and cannot be the universal core.
* Git Bash may run Unix-style tools, but Git for Windows does not make tmux a reliable built-in assumption. Treat it as optional capability, not a baseline.

### cmux

* The relevant cmux project is a Ghostty-based native macOS terminal application for AI coding agents.
* It provides vertical tabs, split panes, notifications, browser panes, CLI/socket automation, and Claude Code Teams support.
* cmux is macOS-only for now according to its site.
* cmux is not a portable in-shell multiplexer like tmux. It is an external terminal application, so it cannot directly solve Windows PowerShell/CMD/Git Bash/WSL/Linux coverage inside CLI-Manager's embedded PTY.

### Windows Terminal

* Windows Terminal supports command-line `split-pane` with horizontal/vertical flags, starting directory, title, profile, and command line.
* This is useful only when CLI-Manager launches an external Windows Terminal window.
* It does not help CLI-Manager's embedded xterm.js + portable-pty panes directly.

### Current CLI-Manager constraints

* Embedded terminals already use portable-pty and xterm.js.
* UI-level pane splitting already exists in `terminalStore` and `terminalPaneTree`.
* Project startup is based on `startup_cmd || cli_tool` written into the PTY after creation.
* Hook events currently cover SessionStart, UserPromptSubmit, Notification/PermissionRequest, Stop, and failure/stop variants. There is no reliable "sub-agent started" event exposed in the current code.

## Recommendation

Use a layered strategy:

1. **Core: CLI-Manager internal panes** for all platforms and all shells.
2. **tmux adapter: optional** for Linux, macOS, WSL, and any shell where `tmux` is detected.
3. **Windows Terminal adapter: optional external mode** for Windows external terminal workflows.
4. **cmux adapter: optional macOS external mode** only, not MVP core.

Do not use cmux as the core implementation. Do not make tmux a hard dependency for PowerShell/CMD/Git Bash.

## MVP Scope

* Add a platform/shell-aware "agent split backend" setting:
  * `internal` default
  * `tmux` when available
  * later: `windows-terminal`, `cmux`
* Implement capability detection before using external multiplexer commands.
* Use internal panes as fallback everywhere.
* For tmux-capable shells, send `tmux split-window` only when inside or attached to a tmux session.

## Risks

* Automatically detecting Claude internal sub-agent creation is not currently reliable from available hooks.
* tmux command quoting must be shell-specific and tested carefully.
* External terminal adapters may not be controllable once launched unless they expose stable CLI/socket APIs.
