# Fix Codex History Scrollbar

## Goal

Restore visible/usable scrolling for Codex history so users can review prior output/messages.

## What I already know

* User reported: "在 codex 中失去了滚动条。看不到历史记录。"
* The app has two relevant surfaces:
  * Built-in xterm terminal scrollback in `src/components/XTermTerminal.tsx`.
  * Session history workspace in `src/components/HistoryWorkspace.tsx` with `HistoryListPane` and `SessionDetailPane`.
* `XTermTerminal` already supports configurable `terminalScrollbackRows`.
* `XTermTerminal` currently attaches a `scroll` listener to the outer terminal container and resets `scrollTop/scrollLeft` to `0`, intended to prevent helper textarea/IME layout drift.
* Session history panes already use `overflow-y-auto`, but do not apply the shared `ui-thin-scroll` scrollbar styling.

## Assumptions (temporary)

* Most likely target: built-in Codex terminal scrollback, because settings explicitly mention Codex TUI scrollback limitations and the user said "在 codex 中".

## Open Questions

* None.

## Requirements (evolving)

* Fix built-in Codex terminal scrollback, not the session history workspace.
* Keep the fix minimal and scoped to the affected scroll container.
* Do not change backend history parsing or session data unless inspection proves the data is missing.
* Preserve IME behavior and terminal background behavior.

## Acceptance Criteria (evolving)

* [ ] Codex terminal/history surface has a visible or usable vertical scrollbar when content exceeds viewport.
* [ ] Prior output/messages can be reached by scrolling.
* [ ] Existing terminal search, IME input, and history panel layout still compile.

## Definition of Done

* Frontend type-check passes, or any failure is reported with the exact reason.
* Scope and risk are explained before code edits.

## Out of Scope

* Redesigning the terminal UI.
* Changing Codex CLI behavior or guaranteeing scrollback for full-screen TUI clear-screen output.
* Backend history indexing changes unless needed.

## Technical Notes

* Candidate files inspected:
  * `src/components/XTermTerminal.tsx`
  * `src/components/HistoryWorkspace.tsx`
  * `src/components/history/HistoryListPane.tsx`
  * `src/components/history/SessionDetailPane.tsx`
  * `src/App.css`
  * `src/components/settings/pages/ThemeSettingsPage.tsx`
  * `src/stores/settingsStore.ts`
