# 技术设计

## 问题 1：子任务转录渲染管线（前端）

### 现状瓶颈
每 250ms/每面板：全量 JSONL 重解析（≤2MB）+ 全部消息 Markdown 重渲染（无 memo）+ 隐藏时照常执行。

### 设计

**1. store 增加追加序号（`src/stores/terminalStore.ts`）**

`SubagentTranscriptContent` 增加 `resetSeq: number`（默认 0，不持久化——subagent session 本就不进 sessionStore）。

- `appendSubagentTranscript`：`reset=true` 或发生前部裁剪（droppedChars>0）时 `resetSeq += 1`；纯追加不变。
- 各初始化点（openSubagentTranscript / discovery 升级 / subscribe 回填）补默认值 0。
- 语义：**`resetSeq` 不变 ⇒ 本次 content 相对上次为纯尾部追加**，消费方可安全增量解析。
- `appendSubagentTranscript(key, content, reset)` 对外签名、4MB 裁剪、oom 诊断日志全部不变。

**2. SubagentTranscriptView 增量化（`src/components/terminal/SubagentTranscriptView.tsx`）**

- 组件内 `useRef` 解析缓存：`{ contentLen, resetSeq, nextId, omittedCount, messages }`。
  - `resetSeq` 变化或 `content.length < contentLen` → 全量重解析（保留现有 2MB `TRANSCRIPT_PARSE_MAX_CHARS` 上限路径）。
  - 否则仅解析 `content.slice(contentLen)`（Rust tail 保证推送为完整行）→ 追加到 `messages`。
- 渲染上限 `MAX_RENDERED_MESSAGES = 300`：`messages` 超限从头裁剪并累计 `omittedCount`，列表顶部显示"已省略前 N 条"。
- 消息行拆为 `memo` 的 `TranscriptMessageRow`（message 对象跨渲染引用稳定，memo 生效）。
- 新 prop `isVisible: boolean`：
  - content 订阅改为 `isVisible ? s.subagentTranscripts[sessionId] : undefined`——隐藏时追加不再触发重渲染，渲染走缓存快照。
  - `ended` / `source.kind` 以独立原始值 selector 订阅（header 状态保持正确，代价为零）。
  - 自动滚动 effect 仅 `isVisible` 时执行；由隐藏切回可见且 atBottom 时补一次 scrollToBottom。
- `TerminalTabs.tsx` 传入 `isVisible={!historyActive && isLayoutVisible && session.id === pane.activeSessionId}`（与 XTermTerminal 同款条件）。

**3. `MarkdownContent` 加 `memo`（`src/components/ui/MarkdownContent.tsx`）**

props 全为原始值/字符串，`React.memo` 安全，所有调用点受益。

## 问题 2：退出进度反馈 + 清理提速

### 设计

**1. 退出进度 UI（`src/App.tsx` + 新组件 `src/components/ExitProgressOverlay.tsx`）**

- App 增加 `exitPhase: "syncing" | "closing" | null` state；`runExitCleanup` 按阶段更新。
- `ExitProgressOverlay`：全屏遮罩 + spinner + 阶段文案（i18n 中英），`exitPhase` 非空时渲染。
- 同步 conflict/error：不再 toast（窗口即将销毁看不到），改为 overlay 内短暂提示（约 1.2s）后继续退出，同时 logWarn。
- 覆盖三条退出路径：关闭弹窗确认退出、closeBehavior=exit 直接退出、托盘退出。minimize 路径不受影响。

**2. 关闭期同步限时（`src/App.tsx`）**

`runCloseAutoSync` 用 `Promise.race` 包 8s 上限；超时 logWarn 并继续退出流程（进程退出后请求自然终止）。WebDAV 客户端 30s 超时配置不动。

**3. Rust `close_all` 批量化（`src-tauri/src/pty/manager.rs`）**

- 现状：循环调 `close()`——每会话一次 `taskkill` 子进程 spawn + 串行 join reader。
- 改为 `close_all` 专用路径：
  1. 收集全部 session 的 PID，Windows 下**单次** `taskkill /F /T /PID p1 /PID p2 ...`（taskkill 原生支持多 PID）；失败仅 warn。
  2. 逐 session `child.kill()` 兜底 + drop master Arc（触发 reader EOF）。
  3. 最后统一 join 所有 reader handle。
- 单会话 `close()`（手动关 Tab 路径）保持不变；`pty_close_all` 命令签名不变；非 Windows 平台维持逐个 close。

## 内存专项追加设计

### WebGL 延迟释放

- `XTermTerminal` 只释放 WebGL addon，不销毁 `Terminal` 实例、fit addon、PTY listener 或前端写入队列。
- 当 `isVisible=false` 时启动 10 秒计时器；计时期间如果重新可见则取消释放。
- 计时到期后 dispose `webglAddonRef.current` 并置空；这只释放 GPU renderer 资源。
- 当再次 `isVisible=true` 且主题/透明度允许 WebGL 时，重新加载 WebGL addon，并触发 viewport refresh/fit，确保画面从现有 xterm buffer 重绘。
- 清理 effect 必须在组件卸载时 clear timer，避免隐藏终端关闭后 timer 回调访问已销毁 terminal。

### 低内存模式

- `settingsStore` 新增持久化布尔字段 `lowMemoryMode`，默认 `false`。
- 通用设置页新增 Switch：「低内存模式」。说明文案：降低后台终端/GPU 资源占用，切回终端时可能轻微重绘。
- `XTermTerminal` 读取该设置：低内存模式开启时启用 F9 延迟释放策略；为避免过度惊扰，F9 也可作为默认策略开启，低内存模式用于后续更激进策略扩展。实现时优先 KISS：行为清晰、不要引入复杂策略矩阵。

## 兼容性 / 风险

- 转录契约（`cli-hook-contracts.md` 的 subscribe/upgrade/finish 路由）不受影响——只改消费端解析与渲染策略。
- `resetSeq` 判定若出现意外不一致，最坏行为 = 一次全量重解析（即现状），无正确性风险。
- taskkill 批量调用保留 per-child kill 兜底，杀进程语义与现状一致。
- `MarkdownContent` memo：纯 props，无行为变化。
- 回滚点：三块改动（转录渲染 / 退出 UI / Rust close_all）相互独立，可单独回退。
