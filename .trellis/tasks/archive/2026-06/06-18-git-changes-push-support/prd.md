# Git 变更面板 push/pull 支持

> 实现已合入 commit 7c39922；本文件为归档记录（原任务目录因归档未跟踪文件丢失后重建）。

## Goal

在 Git 变更面板（`GitChangesPanel`）现有 commit 能力基础上增加 push 与受限 pull：提交栏顶部展示当前分支与 ahead/behind，提供独立「推送」按钮；push 被拒（non-fast-forward）或 behind>0 时提供「拉取」按钮（`--ff-only`）。push/pull 均 shell out 系统 `git`，继承用户凭据管理器、SSH key 与 git config 代理。

## Requirements

1. **分支状态查询**：后端 `git_branch_status(project_path)` → `{ branch, upstream, ahead, behind, has_upstream, detached }`（git2 只读）。
2. **分支状态行**：提交栏顶部展示 `分支名  ↑N ↓M`；无 upstream 显示「未跟踪远端」。
3. **推送按钮**：ahead>0 或无 upstream 可点；无 upstream → `git push -u origin <branch>`。
4. **拉取按钮**：push 被拒或 behind>0 时显示，`git pull --ff-only`；无法快进提示去终端手动合并/变基。
5. **过程反馈**：按钮 loading + toast；失败携带 git stderr 关键错误行（映射可读中文）。
6. **状态刷新**：push/pull 成功后刷新分支状态与变更列表。

## 暂存模型重构（实现期间随用户反馈迭代）

- 未跟踪文件复选框改为前端「选中」态：勾选不立即 git add，提交时统一 add；右键保留真实「加入跟踪（git add）」。
- 新增(A)文件复选框为「本次是否提交」选择态：取消勾选不再 unstage / 退回未跟踪（保持跟踪），提交走 `git_commit_paths` 按路径 pathspec 提交。
- 目录级与顶部全选同步该模型，任意层级都不会把已加入跟踪的文件退回未跟踪。

## Decision (ADR-lite)

**Context**: 本地 git 用 git2，但 push/pull 需凭据与代理；新文件「跟踪」与「本次提交」需解耦。
**Decision**: 本地只读用 git2；网络操作 shell out 系统 `git`（继承凭据/SSH/代理）；pull 限定 `--ff-only`，push 不提供 force；未跟踪/新增文件采用前端选择态 + 提交时 add / pathspec 提交。
**Consequences**: 跨平台稳定、零 credential 手搓；冲突需用户到终端处理（本任务范围外）。

## Out of Scope

- 冲突解决 UI、merge/rebase pull、force push、多 remote。

## Technical Notes

- 关键文件：`src-tauri/src/commands/git.rs`、`src-tauri/src/lib.rs`、`src/stores/gitStore.ts`、`src/components/git/GitChangesPanel.tsx`、`src/components/git/GitTreeNode.tsx`、`src/components/git/StageCheckbox.tsx`、`src/lib/types.ts`。
- 新增后端命令：`git_branch_status` / `git_push` / `git_pull_ff_only` / `git_commit_paths`。
