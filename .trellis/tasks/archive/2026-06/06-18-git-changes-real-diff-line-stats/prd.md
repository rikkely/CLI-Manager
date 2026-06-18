# Git 变更面板增强路线图（分阶段）

## Goal

把 `GitChangesPanel` 从「只读 + 回滚」逐步升级为产品级的轻量 Git 工作台。按风险/价值分 4 个阶段独立交付，每阶段可单独验收、单独提交，互不阻塞。

当前面板能力：文件树视图、状态筛选、4s 聚焦轮询、diff 查看、单文件/hunk/行级回滚。
后端命令集中在 `src-tauri/src/commands/git.rs`，前端状态在 `src/stores/gitStore.ts`。

## 路线图总览

| Phase | 功能 | 类型 | 风险 | 主要改动面 | 依赖 |
|------|------|------|------|-----------|------|
| **P1** | 真实 diff 行数统计 | 收尾坑 | 低 | 后端 `git.rs` 单函数 + 前端 summary | 无 |
| **P2** | 暂存 + 提交 + AI commit message | 亮点 | 高 | 后端新命令 + 前端面板大改 + AI 接入 | 建议 P1 后 |
| **P3** | fs-watcher 替代轮询 | 性能 | 中 | 后端 notify + 事件 + 前端订阅 | 无（可与 P2 并行） |
| **P4** | diff 语法高亮 | 体验 | 低 | 纯前端 `DiffViewerModal` | 无 |

交付顺序：**P1 → P3 → P4 → P2**（P2 最重，放最后做透；P3/P4 低风险可穿插）。每个 Phase 完成后单独走 `trellis-check` 与提交。

---

## Phase 1 — 真实 diff 行数统计（先落地）

### 背景（坑）
`src-tauri/src/commands/git.rs:170` `get_diff_stats_git2` 直接 `return (0, 0)`，注释写「暂不实现」。因此 `GitFileChange.added/deleted` 全是 0，而前端 `GitTreeNode.tsx:89-96` 已经写好了 `+{added} / -{deleted}` 的渲染，只是永远拿到 0；`git_get_changes` 里 `is_wt_new()` 也被特判成 `(0,0)`。

### Requirements
- 后端为每个变更文件计算真实的新增/删除行数（相对 HEAD 的净变更，合并暂存区+工作区）。
- 未跟踪文件（U/??）：新增 = 文件行数，删除 = 0。
- 删除文件（D）：新增 = 0，删除 = 原文件行数。
- 二进制文件：0/0（不显示数字）。
- 性能：**单次 repo 级 diff** 计算全部文件，避免现状那种「每文件一次 diff」的 N 次扫描。
- 面板顶部 summary 增加总增删聚合：`N 个文件 · +X −Y`。

### Technical Approach
1. 在 `git_get_changes` 内，调用 `statuses()` 之前/之后构造一次
   `repo.diff_tree_to_workdir_with_index(Some(&head_tree), opts)`，
   `opts.include_untracked(true).recurse_untracked_dirs(true)`，
   覆盖暂存+工作区+未跟踪全部变更（相对 HEAD）。
2. 用 `diff.foreach` 的 line callback，按 `delta.new_file().path()`（删除取 old path）累加到
   `HashMap<String, (i32 ins, i32 del)>`：origin `'+'` → ins，`'-'` → del，上下文忽略。
3. 遍历 `statuses` 时按归一化路径查表填 `added/deleted`，查不到则 0/0（二进制/纯模式变更）。
4. 删除原 `get_diff_stats_git2` 与 `is_wt_new()` 的 `(0,0)` 特判分支。
5. 前端 `GitChangesPanel.tsx` summary 区新增总 `+X −Y`（聚合 `changes` 的 added/deleted）。
6. **无空仓库 HEAD**（首次提交前）：`repo.head()` 失败时降级为 `diff_to_index(None)` 或对所有视为新增，保证不 panic。

### Acceptance Criteria
- [ ] 修改文件显示真实 `+N −M`，与 `git diff --stat` 一致。
- [ ] 暂存后再改的文件，统计反映「暂存+未暂存」合并净变更。
- [ ] 未跟踪文件显示 `+行数 −0`；删除文件显示 `+0 −行数`。
- [ ] 二进制文件不显示数字（added=deleted=0）。
- [ ] 面板顶部 summary 显示总 `+X −Y`。
- [ ] 一次刷新只构造一个 diff（不再 per-file）。
- [ ] 空仓库 / detached HEAD 不 panic。
- [ ] `cargo test` / `cargo check` 通过，既有回滚单测不受影响。

### Files
- `src-tauri/src/commands/git.rs`（`git_get_changes` 重写统计；移除 `get_diff_stats_git2`）
- `src/components/git/GitChangesPanel.tsx`（summary 总增删）
- `src/lib/types.ts`、`GitTreeNode.tsx`：无需改（字段与渲染已就绪）

### Out of Scope（P1）
- 不做 staged/unstaged 分别显示（合并净值即可）。
- 不改前端每文件渲染样式（已存在）。

---

## Phase 2 — 暂存 + 面板内提交（文件级；不含 AI）

> 决策（2026-06-18）：**AI commit message 不做**；stage 粒度**仅文件级**；主会话直接实现。
> 本阶段聚焦把面板从「只读 + 回滚」补齐到「暂存 + 提交」的最小可用提交工作流。

### Requirements
- 文件级 stage / unstage：文件行加暂存复选框，勾选进暂存区、取消出暂存区；头部提供「全部暂存 / 全部取消暂存」。
- 面板内提交：底部提交栏含信息输入框 + 「提交 (N)」按钮（N=已暂存文件数），仅提交已暂存内容；空信息或无暂存时禁用。
- 提交后刷新面板（暂存清空、变更列表更新）。
- 复用现有单棵目录树与折叠逻辑，不重写为双区；暂存状态由后端 `GitFileChange.staged` 驱动复选框。

### Technical Approach
- 后端新增命令（`git.rs`，全程 libgit2，遵循文件安全清单 + `validate_repo_relative_path`）：
  - `git_stage_file`：worktree 有文件 → `index.add_path`；已删除 → `index.remove_path`；`index.write`。
  - `git_unstage_file`：有 HEAD → `reset_default(HEAD, [path])`；unborn → `index.remove_path`。
  - `git_stage_all` / `git_unstage_all`：全量 `add_all`+`update_all` / `index.read_tree(HEAD tree)`（unborn 用 `index.clear`）。
  - `git_commit(message)`：`write_tree` + `repo.signature()` + `repo.commit(Some("HEAD"), …)`；空信息 / 无暂存 / 无 git 身份返回稳定错误。
- 前端 `gitStore` 新增 `stageFile/unstageFile/stageAll/unstageAll/commit`，操作后 `fetchChanges(silent)`；新增 `committing` 态。
- `GitChangesPanel` 加底部提交栏与头部全部暂存/取消；`GitTreeNode` 文件行加暂存复选框（`onToggleStage` 透传）。

### Acceptance Criteria（P2）
- [ ] 勾选文件即暂存、取消勾选即取消暂存，复选框反映真实 index 状态（含新增/修改/删除/未跟踪）。
- [ ] 「全部暂存 / 全部取消暂存」对整列变更生效。
- [ ] 填写信息后「提交 (N)」提交已暂存内容；提交后列表刷新、暂存清空。
- [ ] 空信息或无暂存时提交按钮禁用；无 git 身份（user.name/email 缺失）给出明确错误不崩溃。
- [ ] 初始提交（unborn HEAD）可正常暂存并完成首个 commit。
- [ ] `cargo check` / `cargo test` / `npx tsc --noEmit` 通过。

### Out of Scope
- **不做 AI commit message**（本次明确排除）。
- 不做 hunk / 行级 stage（仅文件级）。
- 不做 push / pull / fetch / amend / rebase / cherry-pick（远端与高级操作另立任务）。

---

## Phase 3 — fs-watcher 替代轮询（性能）

### Requirements
- 用 `notify` crate 监听项目目录文件变化，去抖后向前端推送「git 变更需刷新」事件。
- 去掉 `GitChangesPanel.tsx` 的 4s 固定 `setInterval` 轮询（`POLL_INTERVAL_MS`），改为事件驱动 + 失焦暂停。
- 尊重 `.git/` 内部噪声过滤，去抖窗口（如 300~500ms）合并连续写。
- watcher 生命周期绑定当前关联项目；切换项目/关闭面板时释放。

### Technical Approach（已锁定 2026-06-18）

**监听范围（决策 A）**：工作区文件 + `.git/index` + `.git/HEAD`。
- 文件编辑 → 工作区事件；暂存/提交 → `.git/index` 变化；切分支 → `.git/HEAD` 变化。
- 过滤 `.git/objects`、`.git/logs`、锁文件等噪声，避免无谓刷新。

**兜底（决策 B）**：watcher 为主，去掉 4s 固定轮询；仅当 watcher 初始化失败（网络盘/WSL/notify 不可用）才降级为 ~15s 慢轮询。watcher 正常时不轮询。

**实现要点**：
- 新增 `notify`（v6）+ `notify-debouncer-mini`（去抖窗口 300~500ms 合并连续写）依赖。
- 仿 `ClaudeHookBridge::start(app.handle().clone())` 模式建 `GitWatcherBridge`，`.manage()` 注册为共享状态；内部持有 `Option<watcher>` + 当前 `project_path`。
- 新增命令 `git_watch_start(project_path)` / `git_watch_stop()`：start 替换上一个 watcher（仅当前活动项目，单 watcher），stop 释放。注册到 `lib.rs` handler。
- 事件：`app_handle.emit("git-changed", payload{ projectPath })`（单事件带项目路径，前端按当前项目匹配；避免每项目一个事件名）。
- 前端 `GitChangesPanel`：`panelActive && projectPath` 时调用 `git_watch_start`，卸载/切项目调 `git_watch_stop`；监听 `git-changed` 事件 → 命中当前项目且窗口聚焦可见时 `fetchChanges(path, true)`。去掉 `setInterval(POLL_INTERVAL_MS)`，保留聚焦/可见判断。watcher start 返回失败标记时启用 15s 慢轮询降级。
- 多窗口：`git-changed` 全窗口广播，各窗口按自身 `currentProjectPath` 过滤，天然隔离。

### Acceptance Criteria（P3）
- [ ] 编辑工作区文件后 <1s（去抖后）面板自动刷新，无需 4s 等待。
- [ ] 在终端 `git add` / `git commit` / `git checkout <branch>` 后面板自动刷新。
- [ ] `.git/objects` 等噪声不触发可见刷新风暴（去抖生效）。
- [ ] 切换关联项目 / 关闭面板后旧 watcher 释放，不泄漏。
- [ ] 失焦/隐藏时不刷新；重新聚焦立即刷新一次。
- [ ] watcher 初始化失败时降级为 15s 慢轮询，功能不中断。
- [ ] `cargo check` / `npx tsc --noEmit` 通过。

### Files（P3）
- `src-tauri/Cargo.toml`（notify + debouncer 依赖）
- `src-tauri/src/` 新增 watcher bridge 模块 + 命令；`lib.rs` 注册 manage/handler
- `src/components/git/GitChangesPanel.tsx`（start/stop + 事件订阅，移除固定轮询）
- `src/stores/gitStore.ts`（如需暴露 watcher 状态/降级标记）

### Out of Scope
- 不做跨多项目同时监听的全局 watcher 池（仅当前活动项目，单 watcher）。
- 不改 live stats 的 git 分支独立刷新逻辑（另有任务）。

---

## Phase 4 — diff 语法高亮（体验）

### Requirements
- `DiffViewerModal` 的 diff 正文按文件扩展名做语法高亮，保留现有 +/−/hunk 行级底色与行选中/回滚交互。
- 高亮不破坏行号、选区、横向滚动等既有逻辑。

### Technical Approach（待确认）
- 候选库：Shiki（VS Code 同款，质量高、体积大）或 highlight.js（轻、生态广）。进入该阶段先做选型研究。
- 纯前端改动，不碰后端。

### Out of Scope
- 不做 diff 主题自定义设置项（沿用终端主题色）。

---

## Definition of Done（每个 Phase 通用质量条）
- 对应层 lint / `npx tsc --noEmit` / `cargo check` 通过。
- 后端逻辑有单测或可复现验证；不 silently ignore 错误（遵循 Tauri 规则）。
- 行为变更更新 `CLAUDE.md` 最近变更摘要。
- 破坏性/外向操作（P2 提交、回滚）保留二次确认。
- 每个 Phase 单独提交，提交前跑 `gitnexus_detect_changes()` 校验影响面。

## Decision (ADR-lite)
- **Context**：Git 变更面板有 1 个数据坑 + 3 个增强方向，价值/风险差异大。
- **Decision**：单任务分阶段 PRD；交付顺序 P1→P3→P4→P2，P1 先落地。P2（含 AI/写操作）进入前单独 brainstorm。
- **Consequences**：低风险项快速兑现，最重的 P2 留足设计空间；验收粒度为 Phase 级。

## Technical Notes
- 后端：`src-tauri/src/commands/git.rs`（已读，含反向 patch / 回滚 / diff 全部基建）。
- 前端：`src/stores/gitStore.ts`、`src/components/git/{GitChangesPanel,GitTreeNode,GitChangesTree,DiffViewerModal}.tsx`、`src/lib/types.ts:353-367`。
- 安全清单：回滚/提交/写 index 走 `.trellis/spec/guides/tauri-user-file-security-checklist.md`，前端路径不可信、后端 `validate_repo_relative_path` 已有。
- 跨层：参考 `.trellis/spec/guides/cross-layer-thinking-guide.md`（Rust 类型 → invoke → store → 组件一致）。
- P2 AI 接入参考：`.trellis/spec/backend/ccswitch-integration-contracts.md`（provider 解析）。
- P3 事件参考：现有 `pty-output-{sessionId}` emit/订阅模式。

## Open Questions（仅 P2，进入时解决）
- AI 模型来源 / 调用位置 / stage 粒度 MVP / commit message UX（见 Phase 2 决策段）。
