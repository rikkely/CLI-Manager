# Notification Platform Options

## Current Code Findings

- `src/App.tsx` sends system notifications with `sendNotification({ title, body })`; no target metadata is included.
- `src/App.tsx` application toast action closes history and calls `useTerminalStore.getState().setActive(tabId)`.
- `src-tauri/src/lib.rs` already has `show_main_window`, used by the tray and single-instance plugin.
- `src-tauri/src/commands/system_notification.rs` sends WSL fallback notifications through Windows host PowerShell Toast APIs.
- `src-tauri/capabilities/default.json` currently grants basic notification permissions only.

## Tauri / Plugin Findings

- Tauri v2 notification plugin documents `sendNotification`, permission checks, `registerActionTypes`, and `onAction`.
- In the installed `tauri-plugin-notification 2.3.3` Rust source, desktop plugin registration exposes only notify, request_permission, and is_permission_granted commands.
- The JS init script replaces `window.Notification` so desktop `sendNotification` ultimately calls `plugin:notification|notify`.
- Therefore JS action APIs should not be treated as a reliable desktop cross-platform solution for this project without verification or plugin changes.

## Platform Strategy

- Windows: strongest candidate for interactive Toast. Use native Rust/WinRT or protocol activation if a button is required. WSL should keep routing through Windows host notification.
- macOS: support notification click where available; explicit buttons/categories may require native notification center integration and installed bundle behavior.
- Linux: XDG notification actions depend on desktop environment and notification daemon. Degrade cleanly when actions are unavailable.

## Recommended MVP

Use a shared frontend activation entry:

1. Resolve a Hook notification target from `tabId`.
2. Ask backend to show/unminimize/focus the main window.
3. Close history workspace and activate the terminal tab.

For system notifications:

- Prefer native click/action handling where reliable.
- Carry target data in the notification send path.
- Fall back to current display-only notification when platform action plumbing fails.

## Validation Notes

- Automated checks can cover TypeScript/Rust compilation and unit-level helpers.
- Runtime notification click behavior needs manual verification on Windows first, then macOS/Linux best-effort verification.
