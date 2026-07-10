# Research: TUI（codex / claude）启动清屏序列与"恢复终端会话"可行性

- **Query**: 恢复终端工作区会话时，先贴回历史 scrollback，再重跑 startupCmd（codex/claude 这类全屏 TUI）。历史被清屏擦掉。能否"只拦清屏、保住历史又不错乱"？还是有更靠谱的 resume 做法？
- **Scope**: mixed（本机 CLI --help 实测 + 仓库既有代码/调查文档）
- **Date**: 2026-07-10

---

## 结论速览（先看这段）

- **codex**：默认进 alt-screen（`?1049h`）。加 `--no-alt-screen` 后不进 alt buffer，但**仍然是"绝对光标定位 + 擦行 + 整屏重绘"的 inline repaint**，不是纯追加。仓库自己的调查文档已实测证实（`altScreenEnter=0` 但 `maxBaseY=0`，没有一行进 scrollback）。
- **claude(Claude Code)**：交互模式是全屏 TUI，同样靠光标定位重绘 viewport。
- **"只拦清屏"不可行**：codex/claude 用 CUP 绝对定位从固定行列重画界面。就算把 `2J`/`3J` 过滤掉不清屏，它下一帧的绝对定位重绘会直接**盖在贴回的历史文本之上**，得到的是历史被 TUI 界面覆盖/错行的脏结果，不是"历史在上、界面在下"。仓库已经试过前端拦 ED3 + 改写 DECSTBM 的方案并**主动回滚**（风险高、会破坏 clear 语义、历史不完整）。
- **正确路线**：对 TUI 会话**不要"贴 scrollback + 裸重跑"**。改用 CLI 自带 resume 让它自己把上次对话画回来。codex/claude 都支持，且**仓库里已经有现成的 resume 命令拼接逻辑可复用**。

---

## 1. codex 启动屏幕行为

**本机版本**：`codex-cli 0.144.1`（`codex --version` 实测）

### alt-screen / 清屏 / 绝对定位

`codex --help` 明确列出（实测原文）：

```
--no-alt-screen
    Disable alternate screen mode
    Runs the TUI in inline mode, preserving terminal scrollback history.
```

- **默认进 alt-screen**：存在 `--no-alt-screen` 开关本身即证明 codex 默认发 `?1049h` 进备用缓冲区（xterm.js 备用 buffer 无 scrollback）。仓库 `src-tauri/src/pty/manager.rs:29-31` 的 `VtScrollDiag` 注释同样把 `?1049h` 记作"TUI 进 alternate screen"的判据。
- **`--no-alt-screen` 具体改变什么**：只让它不进 alt buffer、在主 buffer 渲染（help 原文 "inline mode, preserving terminal scrollback history"）。**但这不等于纯追加式输出**。

### 关键实测（仓库调查文档，已排查过同一现象）

`docs/debugging/codex-scrollbar-investigation-timeline.md:45-54`（团队实机诊断）：

| 指标 | 观察 |
|---|---|
| `altScreenEnter=0` | `--no-alt-screen` 生效，没进 alternate screen |
| LF/CR/擦行/光标定位大量出现 | codex 在做 TUI 重绘 |
| `maxBaseY=0` / `maxNormalBaseY=0` | xterm 没有任何行真正滚出 viewport |

> 文档原文结论（:54）：**"Codex 即使带了 `--no-alt-screen`，仍采用'定位光标 + 擦行 + 重画屏幕'的 inline TUI repaint 模式。xterm 只看到当前 viewport 被反复重绘，没有行进入 scrollback。"**

**证据来源**：本机 `codex --help` / `codex resume --help`；`src-tauri/src/pty/manager.rs:27-90`；`docs/debugging/codex-scrollbar-investigation-timeline.md`。

---

## 2. claude(Claude Code) 启动屏幕行为

**本机版本**：`2.1.178 (Claude Code)`（`claude --version` 实测）

- 交互默认就是全屏 TUI（`claude --help` 原文："starts an interactive session by default, use -p/--print for non-interactive output"）。TUI 靠光标定位在 viewport 内重绘输入框/状态行/对话区，属于绝对定位重绘型，与 codex 同类。
- 无 alt-screen 开关（不像 codex 有 `--no-alt-screen`），无法从 CLI 侧强制它变成纯 inline 追加。
- **证据来源**：本机 `claude --help` / `claude --version`。（联网文档检索工具在本环境不可用，未取到官方文档版本号佐证；alt-screen 具体字节流未做 PTY 抓包——见"Caveats"。但"TUI 靠定位重绘、无法只靠拦清屏保历史"的结论对 codex 已由仓库实测坐实，claude 同为定位重绘型 TUI，同理适用。）

---

## 3. 核心可行性判断："只拦清屏"能否干净保历史

**判断：不行，必然错乱。**

理由：

1. codex/claude 不是"清屏后往下追加"，而是"**清屏 + 从固定行列用 CUP 绝对定位重画整屏**"。清屏只是它重绘循环的一步。
2. 即使把 `2J`/`3J` 过滤掉让历史留在屏上，它下一帧的绝对定位（`\x1b[<row>;<col>H`）会从第 1 行开始把界面**画在历史文本所在的同一批行上** → 历史被覆盖或与界面交错错行，得不到"历史在上、TUI 在下"。
3. 仓库**已经实操验证过并放弃**这条路：`docs/debugging/...timeline.md:112-127` 记录团队做过"前端拦 ED3(`3J`) + 改写 DECSTBM+SU 区域滚动"的方案，最终 `2026-07-02 19:23` **用户要求回滚**，原因：
   - 偏前端补丁，需 xterm parser hook 拦改 codex 特定 ANSI，风险面大；
   - 容易破坏普通 `clear`/`cls` 语义、引入重复帧/历史不完整；
   - 不能统一底层行为。
4. 该 scrollback 问题的**最终解法根本不在"拦序列"层**，而是随包侧载新版 Windows ConPTY/OpenConsole 统一运行时（`timeline.md:161-172`，提交 `67afe83`）。也就是说"改 ANSI 流"这条路团队已判死。

> 换言之：贴回的 scrollback 和 TUI 的绝对定位重绘会抢同一片屏幕坐标，靠"少发几个清屏序列"无法调和。

---

## 4. 替代方案对比

| 方案 | 历史从哪来 | 能否继续用 CLI | TUI 会不会覆盖历史 | 评价 |
|---|---|---|---|---|
| **贴 scrollback + 裸重跑 startupCmd** | 我们贴 | 能 | **会覆盖/错乱**（第 3 节） | ❌ 对 TUI 不可行 |
| **只拦清屏(2J/3J) + 重跑** | 我们贴 | 能 | **仍会被绝对定位盖掉** | ❌ 已被仓库回滚验证否定 |
| **改用 CLI 原生 resume 命令** | **CLI 自己重画上次对话** | 能，且直接续上下文 | 不涉及贴历史，无冲突 | ✅ 推荐 |
| **只贴 scrollback、不重跑** | 我们贴 | 不能（只是死历史） | 无 TUI | 仅适合非 TUI/已退出的普通 shell |

### codex / claude 真实 resume 参数（本机 --help 实测）

**codex**（`codex resume --help`）：
- `codex resume [SESSION_ID] [PROMPT]` — 按 UUID/会话名恢复某次交互会话
- `codex resume --last` — 直接续最近一次会话（不弹 picker）
- `codex resume --all` / `--include-non-interactive` — 扩大可选范围
- **`codex resume` 支持 `--no-alt-screen`**（实测继承全局 flag）。help 原文："inline mode, **preserving terminal scrollback history**"。→ resume 时加它，让 codex 在主 buffer inline 续画。

**claude(Claude Code)**（`claude --help`）：
- `-c, --continue` — 续当前目录最近一次对话
- `-r, --resume [value]` — 按 session ID 恢复，或弹交互 picker
- `--fork-session` — resume 时新建 session ID（配 `--resume`/`--continue`）
- `--from-pr [value]` — 恢复关联某 PR 的会话
- （`--replay-user-messages` 仅 `--print` + `stream-json` 用，非 TUI 续接场景，别用）

### ★ 仓库已有现成 resume 逻辑（直接复用，别重造）

- `src/lib/projectStartupCommand.ts:105-116` `appendResumeCliArgs(baseCommand, source, project)`：把项目的 `cli_args` / provider override 追加到 resume 命令上（当项目走 cli_tool 分支且工具类型与会话来源一致时）。
- `src/components/HistoryWorkspace.tsx:117-118`：已在用
  - claude：`appendResumeCliArgs(\`claude --resume ${sessionId}\`, "claude", project)`
  - codex：`appendResumeCliArgs(\`codex resume ${sessionId}\`, "codex", project)`
- `src/stores/externalSessionSyncStore.ts:279-291` `resolveResumeCommand()`：
  - claude → `claude --resume ${id}`
  - codex → **`codex resume --no-alt-screen ${id}`**（已默认带 `--no-alt-screen`）
- `src-tauri/src/commands/history.rs:3140` 后端也生成 `claude --resume {session_id}`。
- 内置命令库 `src/lib/builtinAiCommands.ts:73,76`：`claude --continue` / `claude --resume`。
- CHANGELOG.md:582 已有"历史会话恢复终端"功能：右键"恢复会话"执行 `claude --resume` 或 `codex resume --no-alt-screen`，匹配项目路径/Shell/环境后打开终端续会话。

> 即：**"用 resume 命令替代裸重跑"这套在仓库里已经成型且在跑**。本任务对 TUI 会话应直接接到这条既有链路，而不是新造"贴 scrollback + 重跑"。

---

## 5. 一句话最终建议

对 codex/claude 这类全屏 TUI 会话，**放弃"静态贴 scrollback + 裸重跑 + 拦清屏"**（绝对定位重绘必然覆盖历史，仓库已实测否定并回滚），改为复用仓库既有的 resume 链路（`appendResumeCliArgs` / `resolveResumeCommand`），恢复时执行 `codex resume --no-alt-screen <id>` / `claude --resume <id>`，让 CLI 自己把上次对话重新画出来——历史交给 CLI 负责，我们只负责把会话跑起来。

---

## Caveats / Not Found

- **联网检索不可用**：本环境 WebSearch/exa 未启用，未取到 codex/Claude Code 官方文档的版本化 alt-screen 说明。结论主要基于本机 `--help`/`--version` 实测 + 仓库实机诊断文档，证据链对 codex 很硬（有实测字节流指标），对 claude 的"绝对定位重绘"是同类推断（无独立 PTY 抓包）。
- **未做 PTY 抓包**：未实机抓取 codex/claude 启动首帧的原始 ANSI 字节（`2J`/`3J`/`?1049h`/CUP 计数）。想要逐字节坐实可用 `manager.rs` 里 `CLI_MANAGER_DEBUG=1` 的 `VtScrollDiag` 跑一次真实会话看汇总；管道抓包会因非 TTY 导致 TUI 挂起，未采用。
- **区分"能否续接" vs "滚动条能否回滚"**：本研究回答的是"恢复时历史会不会被 TUI 盖掉"。而 codex 在 xterm 里"跑起来后能否向上滚 scrollback"是另一个已知问题（根因是 Windows ConPTY 版本差异，最终靠侧载新版 ConPTY 解决，见 `timeline.md`），与本恢复功能的"贴历史被覆盖"是两码事，别混。
