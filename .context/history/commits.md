# Commits

## 2026-05-23 — feat(terminal): add configurable newline shortcut for AI CLI

- **Branch**: feat/compact-mode-launcher
- **Context-Id**: 6ea303e0-c45f-4b69-88ab-4787e68fbd70
- **Files**:
  - src/stores/settingsStore.ts
  - src/components/XTermTerminal.tsx
  - src/components/settings/pages/ShortcutSettingsPage.tsx
- **Decisions**:
  - 默认 Shift+Enter，可切 Ctrl/Alt+Enter；通过 `useSettingsStore.getState()` 在按键时取最新值，避免重建 terminal
  - 拦截放在 `attachCustomKeyEventHandler` 顶部，单按 Enter 不进入分支，行为不变
  - 设置放在 ShortcutSettingsPage 顶部独立 section，不混入现有「录制式」快捷键列表（语义为固定三选一）

## 2026-06-01 — fix(terminal): prevent pasted newlines from submitting

- **Branch**: feat/compact-mode-launcher
- **Context-Id**: ca128808-8fcb-4fab-a6f0-3679feb32ab7
- **Files**:
  - src/components/XTermTerminal.tsx
  - .trellis/tasks/06-01-fix-terminal-paste-newline-auto-send/check.jsonl
  - .trellis/tasks/06-01-fix-terminal-paste-newline-auto-send/implement.jsonl
  - .trellis/tasks/06-01-fix-terminal-paste-newline-auto-send/prd.md
  - .trellis/tasks/06-01-fix-terminal-paste-newline-auto-send/task.json
- **Decisions**:
  - Bypass xterm Terminal.paste for clipboard input because it normalizes LF to CR, which acts as submit in this terminal flow.
  - Normalize pasted CRLF/CR to LF so pasted trailing lines are preserved without triggering submit.
  - Intercept native paste in capture phase and route Ctrl+V through the same PTY write path.
- **Bugs**:
  - Symptom: pasting text with a trailing newline submitted the terminal input immediately.
  - Root cause: xterm paste preparation converted pasted newlines to carriage returns before onData forwarded them to the PTY.
  - Fix: write normalized pasted text directly to the PTY while keeping ordinary Enter behavior unchanged.
- **Tests**:
  - `npx tsc --noEmit`
  - `npm run build`
  - `git diff --check`
