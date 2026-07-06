# 性能优化：子任务分屏卡顿 + 退出延迟

## Changelog Target

V1.2.5（用户指定，写入 CHANGELOG.md 既有 `[V1.2.5]` 分节）

## 目标

1. 消除 claude/codex 子任务自动分屏期间的全局卡顿（切 tab 卡、打字卡）。
2. 消除"确认退出后 3-5 秒无响应才关窗"的体感延迟。
3. 顺带收敛相关 CPU / 内存开销；不做无证据的大重构。

## 确认的事实（代码证据）

### 问题 1：子任务分屏卡顿——主线程被转录渲染循环吃满

数据链路：Rust `tail_loop`（`src-tauri/src/commands/subagent_transcript.rs:158`，`POLL_MS=250ms`）每 250ms 推一次新 JSONL 行 → `appendSubagentTranscript`（`src/stores/terminalStore.ts:1865`）→ `SubagentTranscriptView`（`src/components/terminal/SubagentTranscriptView.tsx`）。

每次推送（每 250ms × 每个子 Agent 面板）在主线程上发生：

1. **全量重解析**：`parseTranscript(content)` 对最多 2MB（`TRANSCRIPT_PARSE_MAX_CHARS`）的累积 JSONL 逐行 `JSON.parse`（SubagentTranscriptView.tsx:160、113-145）。转录越长解析越慢，O(N) 每次、O(N²) 累计。
2. **全量 Markdown 重渲染**：所有历史消息都经 `MarkdownContent` 渲染，而 `MarkdownContent` **没有 `memo`**（`src/components/ui/MarkdownContent.tsx:383`），且每次解析产生全新 message 对象数组 → 整个会话的 Markdown 每 250ms 从头解析一遍。
3. **隐藏时照常烧 CPU**：转录面板挂载在 `display:none` 容器里（TerminalTabs.tsx:1190），无 `isVisible` 门控（对比 XTermTerminal 有完整的可见性门控 + rAF 写入预算），切走 tab 后解析/渲染循环照跑。
4. **store 内存搅动**：content 是上限 4MB（`SUBAGENT_TRANSCRIPT_MAX_CHARS`）的单字符串，每次追加做字符串拼接 + Record spread（terminalStore.ts:1907-1916），高频 GC 压力。

主线程被占满 → xterm 输入处理、tab 切换（React 渲染）全部排队 → 用户感知"打字卡、切 tab 卡"。

排除项（已验证无嫌疑）：PTY 输出链路 Rust 侧有动态批量 + 边界安全（pty/manager.rs:604-658），前端有 rAF 帧预算写入队列（XTermTerminal.tsx:967-1018）；TerminalTabs 订阅用了 `useShallow`（TerminalTabs.tsx:1594），转录追加不会重渲染它；渲染器用 WebGL addon。

### 问题 2：退出延迟——清理串行在 destroy 之前，窗口全程可见

`runExitCleanup`（`src/App.tsx:817-829`）顺序执行：

1. `runCloseAutoSync()` → WebDAV 上传/下载，HTTP 超时 **30 秒**（`src-tauri/src/webdav/mod.rs:36`），网络慢/走代理时轻松 3-5 秒。
2. `invoke("pty_close_all")` → `close_all`（`src-tauri/src/pty/manager.rs:845`）**逐个串行** close：每个会话起一个 `taskkill` 子进程（manager.rs:388）+ `join` 读线程，Windows 上每个几百 ms，多会话线性叠加。
3. `sessionStore.clear()`（SQLite 写）。
4. 全部完成后才 `destroy()`。期间窗口保持可见且无任何反馈。

## 方案方向（待确认后细化到 design.md / implement.md）

### 问题 1 修复（前端为主）

- F1 增量解析：利用转录 append-only 特性（store 已有 `truncatedBytes` 可区分追加 vs 前部裁剪），仅解析新增后缀；发生 reset/裁剪时才全量重解析。
- F2 消息行 memo：稳定 key + `memo` 包裹消息行/`MarkdownContent`，历史消息不再重复 Markdown 解析。
- F3 可见性门控：面板处于 `display:none` 时暂停解析/渲染，切回时一次性追平（对齐 XTermTerminal 的 isVisible 模式）。
- F4 渲染上限:只渲染最近 N 条消息（如 300），封顶最坏情况；不引入虚拟列表库。

### 问题 2 修复（已确认：保持窗口可见 + 显示进度）

- F5' 确认退出后显示全屏进度遮罩（"正在同步…/正在关闭终端…"），全部清理完成后关窗；同步冲突/失败在遮罩内短暂提示后继续退出并记日志（退出路径不再用 toast）。
- F6 Rust `close_all` 并行化：单次 `taskkill /T /F /PID a /PID b ...` 一并杀所有会话树（taskkill 原生支持多 /PID），reader join 统一收尾。
- F7 关闭期同步限时 8 秒（Promise.race），封顶最坏退出时间。

## 已确认决策

1. 退出交互：**保持可见 + 同步进度反馈**（用户选定；即 F5'）。
2. CHANGELOG 目标版本：**V1.2.5**。

## 验收标准

1. 子 Agent 运行且转录持续增长（≥1MB）时：主终端打字无可感知延迟；tab 切换流畅；转录面板隐藏时 CPU 占用接近 0。
2. 确认退出后立即出现进度反馈（不再"无响应"），同步阶段最多 8 秒，PTY 清理由串行 taskkill 改为单次批量，总退出时间显著缩短且全程有反馈。
3. `npx tsc --noEmit` 通过；`cd src-tauri && cargo check`/`cargo test` 通过。
4. 转录功能行为不回归：追加、reset、裁剪告警、结束后延迟关闭、多子 Agent 并存。

### 整体扫描补充（F8，已确认纳入）

全局静态扫描结论：Rust 侧健康（阻塞 IO 全 `spawn_blocking`、hook server 独立线程）；前端定时器全部有门控（降级轮询仅 watcher 失败时启用、统计节拍仅面板激活、发现扫描 TTL 封顶）；React Query 配置合理；WebGL 有 context-loss 兜底。

发现的真问题：**常驻组件整店订阅**。`CommandTemplatePanel.tsx:138` 订阅整个 `useTerminalStore()`，且该面板常驻终端工具栏（TerminalTabs.tsx:2379）——terminalStore 任何变化（含转录每 250ms 追加、状态事件）都触发其重渲染。

- F8 收窄常驻组件订阅：`CommandTemplatePanel`（terminalStore → 仅 sessions/activeSessionId，useShallow）、`SyncStatusIndicator`、`CommandHistoryPanel` 改窄 selector；弹窗/设置页类整店订阅不动（按需挂载，无收益）。

### 内存专项补充（用户已确认纳入）

截图显示 WebView2 进程组约 811MB，其中 WebView2 GPU 进程约 286MB、CLI-Manager WebView 进程约 300MB/174MB。新增目标：降低后台终端长期占用的 GPU/内存资源。

- F9 隐藏终端延迟释放 WebGL：终端从可见变为隐藏后，不立即 dispose WebGL；隐藏持续超过 10 秒后释放 WebGL addon。切回可见时重建 WebGL 并刷新当前 viewport。不得重启 PTY、不得 dispose xterm Terminal 本体、不得丢 scrollback/输入状态。
- F10 通用设置增加「低内存模式」：默认关闭。开启后使用更激进的内存策略（至少：后台终端按 F9 释放 WebGL；后续可承载更低 transcript/scrollback 保留策略）。设置需持久化、支持中英文文案。

## 范围外

- JSONL 解析挪 Web Worker（增量化后预计不再需要）。
- 浅色主题禁用 WebGL 的策略重评估（刻意设计，非缺陷）。

- 不改 PTY 输出链路（已有批量优化，无证据表明是瓶颈）。
- 不引入虚拟列表/worker 等重型方案，除非增量解析后仍有证据不达标。
- 不动 WebDAV 同步协议本身（仅前端关闭期加限时）。
