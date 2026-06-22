# 跨平台子 Agent 分屏支持

## Goal

在 CLI-Manager 中为 Claude/Codex 等 AI CLI 的子 Agent/辅助会话提供跨平台分屏承载能力。核心目标是覆盖 Windows PowerShell、CMD、Git Bash、WSL、Linux、macOS；tmux/cmux 只能作为可选适配层，不能牺牲内置终端的一致性。

## What I already know

* 用户的痛点是：WSL 终端中使用 Claude，再由 Claude 使用 tmux 开启子 Agent 时，tmux 没有自动分屏；后续范围扩大为 Windows/macOS/Linux 多端支持。
* tmux 不会因 Claude 子 Agent 自动分屏，必须显式执行 `tmux split-window`。
* tmux 官方支持 Linux/macOS/各类 BSD/Solaris，适合作为 Unix/WSL 适配器；不适合作为 PowerShell/CMD 的统一底座。
* cmux 是 Ghostty-based 的 macOS 原生终端应用，适合 macOS 外部终端/Agent 工作流集成；不适合作为 Windows/Linux/内嵌 PTY 的统一底座。
* Windows Terminal 支持外部 `wt split-pane`，但只适用于外部终端模式，不适用于 CLI-Manager 内嵌 xterm.js pane。
* 当前项目已有应用内分屏能力：`src/stores/terminalStore.ts` 的 `splitTerminal` 和 `src/stores/terminalPaneTree.ts` 管理 UI pane。
* 当前项目启动项目终端的入口在前端：项目配置的 `startup_cmd || cli_tool` 作为 `startupCmd`，创建 PTY 后通过 `pty_write` 写入。
* WSL shell 由 Rust PTY 层解析为 `wsl.exe`，相关逻辑在 `src-tauri/src/pty/manager.rs`。
* WSL 环境变量转发已有专门逻辑，`CLI_MANAGER_TAB_ID`、`CLI_MANAGER_NOTIFY_PORT`、`CLI_MANAGER_NOTIFY_TOKEN` 通过 `WSLENV` 进入 Linux shell。
* `src-tauri/src/wsl.rs` 已有 Windows 路径转 WSL 路径工具。
* 现有 Claude/Codex Hook 事件没有可靠的 `SubAgentStarted` 事件，不能把“自动识别 AI CLI 内部子 Agent 创建”作为第一版强承诺。
* 当前项目里 Codex Hook 与 Claude Hook 并列：Codex 支持 `SessionStart`、`UserPromptSubmit`、`PermissionRequest`、`Stop`，并用于实时统计和通知。

## Assumptions

* MVP 不修改 Claude/Codex CLI 本体，也不依赖它们的内部子 Agent API。
* MVP 优先保证所有平台都有一致的“分屏承载子会话”能力。
* 外部 multiplexer 使用前必须能力检测；不可用时回退到 CLI-Manager 内置 pane。
* tmux/cmux 不作为强依赖。

## Open Questions

* MVP 是否先只实现“手动/命令触发的子 Agent 分屏”，暂不做 Claude/Codex 内部子 Agent 自动识别？

## Requirements

* 默认使用 CLI-Manager 内置 pane 实现跨平台分屏，覆盖 PowerShell、CMD、Git Bash、WSL、Linux、macOS。
* Claude 和 Codex 必须走同一套子 Agent 分屏能力，不能只为 Claude 特判。
* 根据项目 `cli_tool` / `startup_cmd` 推断当前 AI CLI：包含 `claude` 走 Claude 默认命令，包含 `codex` 或 `code` 走 Codex 默认命令；无法推断时允许用户选择/输入命令。
* 支持 tmux 作为可选后端：Linux、macOS、WSL，以及检测到 `tmux` 可用的类 Unix shell。
* 支持为未来 cmux 做 macOS 外部适配预留，但 MVP 不把 cmux 作为核心。
* 支持为 Windows Terminal 外部模式做 `wt split-pane` 预留，但 MVP 不影响内嵌终端。
* 不影响普通项目启动行为。
* 外部后端不可用时必须回退内置 pane，并给出清晰提示。
* 保留现有 Hook 环境变量转发能力，不能破坏实时统计和通知。

## Acceptance Criteria

* [ ] Claude 项目可通过内置 pane 启动一个 Claude 子 Agent/辅助会话。
* [ ] Codex 项目可通过内置 pane 启动一个 Codex 子 Agent/辅助会话。
* [ ] PowerShell/CMD/Git Bash/WSL/Linux/macOS 至少可通过内置 pane 启动一个子 Agent/辅助会话。
* [ ] tmux 可用时，可选择用 tmux 分屏承载子会话。
* [ ] tmux 不可用时不会导致终端无法启动，并回退到内置 pane。
* [ ] 非 Claude/Codex 项目行为不变。
* [ ] 现有 Claude/Codex Hook 通知、实时统计、SessionStart 绑定不被破坏。
* [ ] 前端类型检查通过。
* [ ] Rust `cargo check` 通过。

## Definition of Done

* Tests added/updated where practical.
* Typecheck / cargo check green.
* Risk and rollback considered.

## Out of Scope

* 不实现 Claude/Codex CLI 内部协议解析。
* 不承诺第一版自动识别 Claude/Codex 内部子 Agent 创建事件。
* 不替代 CLI-Manager 现有应用内分屏；内置 pane 是默认核心能力。
* 不在 Windows 原生 PowerShell/CMD 中模拟 tmux。
* 不把 cmux 作为 Windows/Linux 方案。

## Technical Notes

* Candidate files:
  * `src/stores/terminalStore.ts`
  * `src/components/sidebar/index.tsx`
  * `src/components/TerminalTabs.tsx`
  * `src-tauri/src/commands/terminal.rs`
  * `src-tauri/src/pty/manager.rs`
  * `src-tauri/src/wsl.rs`
* Research reference:
  * `research/multiplexer-cross-platform.md`
* Revised approach: create a small multiplexer abstraction. Default backend is internal panes. tmux is an optional adapter. cmux and Windows Terminal are future external adapters.
