# Fix terminal narrow resize

## Goal

修复 CLI-Manager 内嵌 xterm 终端内容偶发全部挤压到左侧的问题，避免前端在布局未稳定时把异常小列宽同步给后端 PTY，导致 Claude Code 等 TUI 按窄窗口重排。

## What I already know

* 用户看到的现象是终端内容整体挤到左侧，示例中 Claude Code 启动画面按很窄的列宽显示。
* `src/components/XTermTerminal.tsx` 使用 `FitAddon.fit()` 和 `proposeDimensions()` 计算终端尺寸。
* `XTermTerminal` 会在 xterm resize 时直接调用 `pty_resize`，把 `cols/rows` 同步到 Rust PTY。
* 当前前端只过滤 `offsetWidth <= 0` / `offsetHeight <= 0`，没有过滤“非 0 但异常小”的不可信尺寸。
* `TerminalTabs` 会在历史面板打开时替换终端区域，关闭后终端组件重新挂载，可能触发未稳定布局下的初始 fit。
* 非活跃终端 tab 使用 `display: none` 隐藏，重新激活时依赖一帧后的 fit。
* Rust 后端 `pty_resize` 当前原样透传 `cols/rows` 到 `portable_pty`，没有最小尺寸保护。

## Assumptions

* 根因是前端短暂测得过小容器宽度并同步给 PTY，而不是 ANSI 解析、xterm 渲染器或 Claude Code 输出本身异常。
* 最小修复应优先放在前端尺寸可信度判断；后端最小尺寸保护作为兜底而非主修复。

## Requirements

* 防止异常小的 fit/proposeDimensions 结果同步到后端 PTY。
* 初始化或重新激活终端时，等容器布局稳定后再执行会影响 PTY 的 resize。
* 保持正常窗口 resize、字体变更、主题变更、tab 切换和分屏拖拽仍能触发正确 fit。
* 不引入新依赖，不重构终端架构。

## Acceptance Criteria

* [ ] 新开终端时不会把明显过小的列数同步给 PTY。
* [ ] 从历史面板切回终端后，终端不会被错误压缩到左侧。
* [ ] 切换 tab 后 active 终端会恢复正确尺寸。
* [ ] 分屏拖拽后终端仍能按新区域正确 resize。
* [ ] 字体大小/字体族变化后终端仍能重新 fit。
* [ ] `npx tsc --noEmit` 通过。
* [ ] 可运行应用进行手动验证；若环境无法运行，需要明确说明未完成手动验证。

## Definition of Done

* 最小范围代码改动完成。
* TypeScript 类型检查通过。
* 如涉及 Rust 后端兜底，执行 `cargo check`。
* 运行应用并手动验证关键触发路径，或明确说明无法手动验证的原因。
* 提交前运行 `gitnexus_detect_changes()` 检查影响范围。

## Technical Approach

推荐 MVP：前端主修复 + 后端可选兜底。

* 在 `XTermTerminal` 内统一收口 fit/resize 同步逻辑：只在容器尺寸可信且计算出的 `cols/rows` 达到合理下限时才同步 PTY。
* 初始挂载时避免立即把不稳定尺寸同步给 PTY，改为延后一到两帧后 fit，并以同一套可信尺寸检查保护。
* 保留现有 `ResizeObserver`、active tab、font change 的 fit 触发点，但让它们经过同一个保护入口。
* 如选择更保守方案，可在 Rust `PtyManager::resize` 中对过小 `cols/rows` 加最小值兜底，防止未来其他前端路径误报。

## Decision (ADR-lite)

**Context**: xterm 终端尺寸由前端 DOM 测量决定，PTY 尺寸一旦被改小，TUI 会按窄列宽重排。

**Decision**: 前端阻止不可信尺寸进入 `pty_resize`，初始化 resize 延后到布局稳定；同时在后端 `PtyManager::resize` 加最小尺寸兜底。

**Consequences**: 前端修复更贴近根因，后端兜底能防止未来其他前端路径误报；代价是 `pty_resize` 对极小尺寸不再原样透传，而是钳制到合理下限。

## Out of Scope

* 不重写终端渲染层。
* 不替换 xterm.js 或 FitAddon。
* 不调整 Claude Code 输出或 ANSI 解析逻辑。
* 不做终端主题、字体设置、分屏 UX 的额外改版。

## Technical Notes

* 关键文件：`src/components/XTermTerminal.tsx`
* 相关容器：`src/components/TerminalTabs.tsx`
* 分屏相关：`src/components/SplitTerminalView.tsx`
* 后端 resize 入口：`src-tauri/src/commands/terminal.rs`
* 后端 PTY resize：`src-tauri/src/pty/manager.rs`
* 依赖版本：`@xterm/xterm` `^6.0.0`，`@xterm/addon-fit` `^0.11.0`
