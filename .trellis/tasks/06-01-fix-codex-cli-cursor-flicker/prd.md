# fix Codex CLI cursor flicker

## Goal

消除 Codex CLI 在内嵌终端执行时的光标快速闪动，让终端在运行中保持稳定可读，不影响命令输出和现有标签激活反馈。

## What I already know

* 问题出现在 `src/components/XTermTerminal.tsx` 的终端渲染链路里。
* 当前终端在创建时把 `cursorBlink` 设为 `isActive`，并在 `isActive` 变化时再次热更新 `terminal.options.cursorBlink`。
* 终端还会在激活时 `focus()`，失活时 `blur()`。
* PTY 输出在 Rust 侧已做 UTF-8 / ANSI 边界保护，前端又按 animation frame 批量写入，不像是输出分片导致的乱码问题。
* 这个仓库已有明确的 xterm 规范：需要“必须在构造时设置”的选项应一次性固定，不要靠频繁切换来回重建或抖动。

## Assumptions (temporary)

* 这是一个终端光标表现问题，而不是 PTY 输出损坏。
* 闪动主要来自 xterm 光标策略，而不是 CSS 动画。
* 最小修复应尽量不影响现有终端激活态、分屏、背景图与快捷键逻辑。

## Open Questions

* 已确认：采用全局关闭内嵌终端光标闪烁的最小修复。

## Requirements (evolving)

* 终端执行时不应出现肉眼可见的高频光标闪动。
* 修复后不应引入 terminal 重建、丢失 scrollback 或输入中断。
* 保留现有 active/inactive 的焦点管理与标签切换行为。
* 全局关闭内嵌 xterm 的 `cursorBlink`，不新增 Codex 专用识别或配置项。

## Acceptance Criteria (evolving)

* [ ] Codex CLI 执行时，终端中的光标不再快速闪烁。
* [ ] 切换标签后终端仍能正常聚焦与输入。
* [ ] 现有输出、分屏、背景图和快捷键行为不回退。

## Definition of Done

* 修复代码完成。
* 相关验证通过。
* 如行为变化需要，更新项目规约或变更记录。

## Out of Scope (explicit)

* 不重做终端架构。
* 不改 PTY 协议。
* 不为这个问题引入新依赖。

## Technical Notes

* `src/components/XTermTerminal.tsx`：终端创建、focus/blur、cursorBlink 热更新、ResizeObserver、PTY 输出批量写入。
* `src/components/TerminalTabs.tsx`：终端激活态和标签切换入口。
* `src-tauri/src/pty/boundary.rs` / `src-tauri/src/pty/manager.rs`：已做输出边界保护，当前不是首要怀疑点。
* `src/App.css`：已检查终端背景相关样式，未见明显 cursor 动画来源。
