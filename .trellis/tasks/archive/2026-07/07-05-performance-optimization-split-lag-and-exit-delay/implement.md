# 实施计划

## 顺序清单

1. **store 层**（`src/stores/terminalStore.ts`）
   - `SubagentTranscriptContent` 增加 `resetSeq: number`；`appendSubagentTranscript` 在 reset/裁剪时自增；所有转录初始化点补默认值 0。
2. **转录视图**（`src/components/terminal/SubagentTranscriptView.tsx`）
   - 增量解析缓存（contentLen/resetSeq/nextId/omittedCount/messages）。
   - `TranscriptMessageRow`（memo）拆分；渲染上限 300 条 + 省略提示。
   - 新 prop `isVisible`；隐藏时不订阅 content、不滚动；切回可见追平。
3. **调用点**（`src/components/TerminalTabs.tsx`）
   - 给 `SubagentTranscriptView` 传 `isVisible`（与 XTermTerminal 同条件）。
4. **MarkdownContent**（`src/components/ui/MarkdownContent.tsx`）
   - 导出包 `React.memo`。
5. **退出流程**（`src/App.tsx` + 新增 `src/components/ExitProgressOverlay.tsx` + `src/lib/i18n.ts`）
   - `exitPhase` state + overlay 组件 + 中英文案。
   - `runCloseAutoSync` 8s `Promise.race` 限时；conflict/error 改 overlay 提示 + logWarn，去掉退出路径 toast。
6. **Rust close_all**（`src-tauri/src/pty/manager.rs`）
   - Windows 批量 taskkill（多 /PID 单次调用）→ 逐 child.kill 兜底 → 统一 join reader。
   - 不动单会话 `close()` 与命令签名。
7. **常驻组件订阅收窄（F8）**
   - `src/components/CommandTemplatePanel.tsx`：`useTerminalStore()` 改窄 selector（sessions/activeSessionId，useShallow）。
   - `src/components/sidebar/SyncStatusIndicator.tsx`、`src/components/CommandHistoryPanel.tsx`：同样改窄 selector。
   - 仅改订阅方式，不改任何行为逻辑。
8. **WebGL/低内存模式追加**
   - `src/stores/settingsStore.ts`：新增持久化 `lowMemoryMode: boolean`（默认 false）及更新方法（复用现有 setting update 模式）。
   - 通用设置页：新增「低内存模式」开关和中英文文案。
   - `src/components/XTermTerminal.tsx`：隐藏超过 10 秒后释放 WebGL addon；切回可见时重建 WebGL 并刷新视口；不得销毁 Terminal 本体/PTY/scrollback。
   - `src/lib/i18n.ts`：增加低内存模式相关文案。
   - `CHANGELOG.md`/`docs/功能清单.md`：补充低内存模式与后台 WebGL 释放说明。
9. **文档**
   - `CHANGELOG.md`：写入 `[V1.2.5]` 分节（用户指定）。
   - `docs/功能清单.md`：退出进度反馈属用户可见行为，补一行。

## 验证命令

```bash
npx tsc --noEmit
cd src-tauri && cargo check
cd src-tauri && cargo test
```

运行时性能验证（构建/UI 由用户执行）：
- 子 Agent 运行且转录 ≥1MB：主终端打字、tab 切换流畅；隐藏转录面板后 CPU 接近空载。
- 确认退出：出现进度遮罩，同步最多 8s，随后窗口关闭。

## 风险文件 / 回滚点

- `src/stores/terminalStore.ts`（1919 行大 store）：仅动 `SubagentTranscriptContent` 类型 + append/初始化点，不碰其他 action。
- `src-tauri/src/pty/manager.rs`：PTY 生命周期核心，只新增 `close_all` 批量路径，`close()` 原样保留。
- 三块改动相互独立，可按块回退。

## start 前检查

- [x] prd.md 决策补全（退出体验=保持可见+进度；Changelog Target=V1.2.5）
- [x] design.md / implement.md 就绪
- [x] implement.jsonl / check.jsonl 挂相关契约
- [ ] 用户批准进入实施
