# Git Status Contracts

> git.rs 中 Git 状态收集/变更列表的执行合约与已知陷阱。

---

## 状态收集的三条链路（改过滤逻辑必须全部检查）

| 链路 | 入口 | 消费方 | 收集方式 |
|------|------|--------|----------|
| Git 面板 | `git_get_changes`（Tauri command） | `gitStore.fetchChanges` / `fileExplorerStore` | **内联 status 循环**（git.rs 内 `for entry in statuses.iter()`） |
| Replay 快照 | `git_get_worktree_snapshot` → `build_worktree_snapshot` | `replayStore` | `collect_git_changes_from_repo()` |
| WSL 项目 | `git_get_changes` → `git_get_changes_wsl` | 同面板 | `git status --porcelain -z` 文本解析（`parse_wsl_git_status`） |

> **Warning**: `git_get_changes` 与 `collect_git_changes_from_repo` 是两段**重复实现**的收集循环，历史原因未合并。任何条目过滤/状态映射规则变更必须同步两处（优先提取共享函数），WSL 文本解析链路也要评估是否同样适用。

### Common Mistake: 只改 `collect_git_changes_from_repo` 导致面板无效果

**Symptom**：修复/过滤逻辑单测全绿，但 Git 面板 UI 行为不变。

**Cause**：面板真正调用的是 `git_get_changes` 的内联循环，不经过 `collect_git_changes_from_repo`（后者只服务 Replay 快照）。issue #85 首轮修复即踩此坑。

**Fix / Prevention**：过滤类逻辑提取为共享工具函数（现有范例：`is_nested_repo_entry`），两个循环各自调用；修改前 grep `statuses.iter()` 确认所有循环点。

---

## 嵌套 Git 子仓库过滤合约（issue #85）

### Signatures

```rust
/// 尾部 '/' 且目录内存在 .git（目录或文件形式，覆盖 submodule/worktree gitlink）→ true
fn is_nested_repo_entry(repo: &Repository, file_path: &str) -> bool
```

### Contracts

- libgit2 `statuses()` + `recurse_untracked_dirs(true)` 下：普通未跟踪目录会被展开为文件条目；**只有嵌套 git 仓库**保留为带尾部 `/` 的目录条目（如 `sub-repo-a/`）。
- 命中 `is_nested_repo_entry` 的条目：`continue` 跳过，不进入 `GitFileChange` 列表。
- `git_get_file_diff` 的 `"U" | "??"` 分支：`read_to_string` 前有 `is_dir()` 兜底守卫，目录条目返回友好中文错误，而非原始 OS 错误（Windows 下曾表现为 os error 123/5/3，随环境浮动）。

### Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 条目尾部 `/` 且 `<dir>/.git` 存在 | 跳过，不进变更列表 |
| 条目尾部 `/` 但无 `.git`（理论不出现） | 保留，不误伤 |
| diff 请求路径为目录 | `Err("该条目是目录（可能为嵌套 Git 仓库），无法显示文件 diff")` |

### Tests

- `commands::git::tests::collect_git_changes_skips_nested_repo_dir`（正例 + 反例）
- `commands::git::tests::is_nested_repo_entry_detects_nested_repo_dir_only`
- 手工夹具：`D:\github\nested-git-test`（一级/二级嵌套仓库 + node_modules 假 .git）

### 已知未覆盖（后续项）

- `parse_wsl_git_status`（WSL 链路）尚未过滤嵌套仓库条目（`?? dir/` 仍会进列表；diff 目录守卫可兜底不报错）。已记入任务 `07-05-feat-git-sub-repo-monitor` 一并处理。
