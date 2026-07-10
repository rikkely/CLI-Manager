# restore-terminal-workspace-sessions

关联 Issue: [#123](https://github.com/dark-hxx/CLI-Manager/issues/123) — [Feature] 再次打开，会话不丢失

Changelog Target: [TEMP]

## Goal

类似 orca：关闭 CLI-Manager 后再次打开，上次的终端工作区标签自动保留，无需手动到"会话历史"里重新选取。启动时若检测到上次遗留的工作区标签，弹窗询问是否恢复；恢复时按会话类型分流——CLI 会话（codex/claude）用 CLI 原生 resume 让其自行重画历史并可继续对话，普通 shell 会话静态贴回滚动内容——让用户在原标签接着操作。

> ⚠️ **方案已转向（2026-07-10 实测后）**：原设计"静态贴 scrollback + 重跑 startupCmd"对 codex/claude 这类全屏 TUI **不可行**（启动用绝对光标定位整屏重绘，会盖掉贴回的历史；"只拦清屏"团队已实操并回滚）。改为对 CLI 会话走 resume。详见 `research/tui-startup-clear-sequences.md` 与 Decision 段。

## What I already know（探查结论）

- **持久化介质**：工作区会话走 `tauri-plugin-store`（`sessionStore.ts`），持久化 `sessions / splits / activeSessionId`；与 SQLite `session_meta`（历史会话浏览元数据）是**两套独立数据**。本任务只碰前者。
- **会话字段已够用**：`TerminalSession` 已含 `id / projectId / worktreeId / title / cwd / shell / envVars / startupCmd / cliSessionId / initialTerminalOutput / kind`（`src/lib/types.ts:121-162`）。
- **scrollback 快照已存在**：`XTermTerminal.tsx` 用 `@xterm/addon-serialize`，在终端 dispose 时序列化画面写入 `initialTerminalOutput`；重挂载时回填。这就是"静态历史输出"的现成载体。
- **恢复逻辑已实现但从未被调用**：`terminalStore.restoreSessions()`（`terminalStore.ts:1476`）是 dead code，被启动时 `App.tsx` 的无条件 `clear()`（`:736-739`，注释"启动时不恢复历史终端，避免重建 PTY 并重跑 startupCmd"）抢先清空。
- **CLI 类型 / 关联项目**：会话本身不存 CLI 枚举，靠 `projectId` + `startupCmd` 文本 + 项目配置推断（`terminalProject.ts` / `providerSwitching.ts`）。

## Requirements

- **R1 持久化范围**：关闭前的全部工作区标签，含标签顺序、当前选中标签、关联项目（projectId/worktreeId）、CLI 类型（由 startupCmd/项目配置推断，不新增枚举）、会话标识、终端滚动内容（`initialTerminalOutput`）。
- **R2 运行期持续保存**：恢复快照在应用运行期间持续落盘，不能只在正常关闭时保存，确保崩溃 / 强杀后也能恢复。触发策略 = **定时节流，间隔 10s**（Q2 已定）。为把用户感知压到 0，须满足：
  - **R2.1 脏检测**：某终端自上次落盘后无新输出则跳过序列化，不重复做无用功。
  - **R2.2 scrollback 行数上限**：单终端持久化的滚动内容截取尾部 N 行（上限约 2000 行），避免快照文件无限膨胀；符合"恢复最近画面"语义。
  - **R2.3 空转防护**：仅当存在真实 PTY 会话时启动定时器，空工作区不空转。
- **R3 启动检测**：每次启动检查是否存在上次遗留的可恢复工作区标签。
- **R4 问询式恢复**：有可恢复标签 → 弹窗询问"是否恢复上次会话"；没有 → 正常进入，不显示提示。
- **R5 一次性恢复（按类型分流）**：用户确认后，一次性恢复全部标签，恢复方式按会话类型分流：
  - **R5-CLI（codex/claude 会话）**：用 CLI 原生 resume 恢复，让 CLI 自己重画上次对话、且可继续。复用仓库既有链路（`appendResumeCliArgs` / `resolveResumeCommand`）：
    - 有 `cliSessionId` → `codex resume --no-alt-screen <id>` / `claude --resume <id>`。
    - 无 `cliSessionId`（hook 未装/未上报）→ 兜底续最近一次：`codex resume --last` / `claude --continue`。
    - **不**为 CLI 会话贴 `initialTerminalOutput`（会被 TUI 绝对定位重绘覆盖，见 Decision）。
  - **R5-Shell（普通 shell 会话）**：静态贴回 `initialTerminalOutput`（shell 不清屏，历史可见），attach 新 PTY；startupCmd 视其是否有副作用决定（普通 shell 一般无 TUI 覆盖问题）。
  - 会话类型判定：靠 `startupCmd` 文本 + 项目配置（复用 `providerSwitching.ts` / `projectStartupCommand.ts` 既有判定），不新增枚举字段。
- **R6 无自动恢复开关**：不提供"自动恢复"设置项；只要存在可恢复内容，每次都询问。
- **R7 拒绝即清快照**：用户拒绝恢复时，清除本次工作区恢复快照，但保留正常的历史会话记录（session_meta / JSONL），避免下次继续询问同一批旧标签。
- **R8 分屏范围**：MVP 只恢复标签（顺序 + 选中 + scrollback + 新 PTY），**不恢复分屏布局**（恢复后均为单一终端）。见 Out of Scope。

## Acceptance Criteria

- [ ] 关闭（正常退出）后重开，检测到遗留标签并弹窗询问。
- [ ] 确认恢复后：标签数量、顺序、选中项与关闭前一致。
- [ ] **CLI 会话（codex/claude）**恢复后，CLI 自行重画上次对话、可继续输入；有 cliSessionId 走 resume `<id>`，无则续最近一次（`--last` / `--continue`）；历史不被清屏覆盖。
- [ ] **shell 会话**恢复后，贴回关闭前的滚动内容，可立即操作。
- [ ] 无可恢复内容时，启动不弹窗，行为与现状一致。
- [ ] 拒绝恢复后，快照被清除；再次启动不再询问同一批旧标签；历史会话浏览（session_meta）不受影响。
- [ ] 强杀 / 崩溃后重开，仍能恢复到最近一次节流落盘的快照（丢失窗口 ≤ 节流间隔）。
- [ ] 分屏不恢复：关闭前的分屏在恢复后表现为独立单终端标签（不报错、不丢标签）。

## Out of Scope

- 分屏布局（split tree）的无损恢复 —— 需扩展 `PersistedSplit` 为完整树结构，本期不做。
- 恢复"运行中的进程状态" —— PTY 进程随应用关闭即销毁，无法冻结/解冻；恢复的是外壳 + 静态历史文本 + 新 PTY。
- 退出期间后台继续执行 CLI / 产生新输出。
- "自动恢复"偏好开关。

## Decision (ADR-lite)

**Context**: Issue #123 要求关闭后会话不丢失；现状 `App.tsx` 启动刻意 `clear()` 防止重建 PTY 重跑 startupCmd。
**Decision**:
- **[已转向 2026-07-10]** 恢复按会话类型分流，不再对所有会话"贴 scrollback + 重跑 startupCmd"：
  - CLI 会话（codex/claude）→ CLI 原生 resume（`codex resume --no-alt-screen <id>` / `claude --resume <id>`；无 id 兜底 `--last` / `--continue`），历史由 CLI 自己重画。
  - shell 会话 → 静态贴回 `initialTerminalOutput`。
- 复用现有 `restoreSessions()`（改造：分流 + 复用 scrollback / resume 链路），把启动 `clear()` 改为"检测 → 问询 → restore / clear"。
- MVP 只恢复标签，不恢复分屏（R8）。
**Consequences**:
- 复用仓库既有 resume 链路（`appendResumeCliArgs` / `resolveResumeCommand`，"历史会话恢复终端"已在用）与 SerializeAddon 快照；改动集中在启动时序 + restoreSessions 分流改造 + 节流落盘。
- **为什么放弃"贴 scrollback + 重跑"给 TUI**：codex/claude 启动用绝对光标定位整屏重绘，会盖掉贴回的历史；"只拦清屏(2J/3J)"也不行——团队 2026-07-02 已实操"前端拦 ED3 + 改写区域滚动"并主动回滚（`docs/debugging/codex-scrollbar-investigation-timeline.md`）。证据见 `research/tui-startup-clear-sequences.md`。
- 仍需移除/条件化启动无条件 `clear()`；退出侧对称 `clear()` 改为退出前强制落盘（已在首轮实现中修复）。

## Technical Notes

- 关键文件：`src/stores/sessionStore.ts`、`src/stores/terminalStore.ts`（`restoreSessions` :1476 / `createSession` :872 / `updateSessionTerminalSnapshot` :864）、`src/App.tsx`（init :711 / clear :736）、`src/components/XTermTerminal.tsx`（serialize :3205 / 回填 :1636）、`src/lib/types.ts`（TerminalSession :121 / PersistedSplit :198）。
- 后端 PTY 不缓存输出历史，画面恢复只能靠前端 SerializeAddon 快照。
- `saveSessions` 会过滤伪会话（subagent-transcript / file-editor / synced-history），只持久化真实 PTY 会话——恢复天然只针对真实终端。
- **resume 链路（复用，勿重造）**：`src/lib/projectStartupCommand.ts` `appendResumeCliArgs`、`src/stores/externalSessionSyncStore.ts` `resolveResumeCommand`（claude→`claude --resume <id>`；codex→`codex resume --no-alt-screen <id>`）、`src/components/HistoryWorkspace.tsx:117-118` 已在用。
- **研究依据**：`research/tui-startup-clear-sequences.md`（codex/claude 启动屏幕行为实测 + resume 参数）。

## Definition of Done

- 类型检查 `npx tsc --noEmit` 通过；涉及 Rust 则 `cargo check` 通过。
- 行为变更写入 `CHANGELOG.md`（Changelog Target）；功能变更更新 `docs/功能清单.md`。
- 提交关联 `Refs #123`。
