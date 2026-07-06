# PRD: Git 面板支持监控文件夹下的多个子 git 仓库

- Issue: https://github.com/dark-hxx/CLI-Manager/issues/85
- Changelog Target: V1.2.5
- 类型: Feature（方案 B，子仓库枚举 + 面板切换）
- 依赖: 先完成 `07-05-fix-git-scan-nested-repo-error`（方案 A 兼容修复）

## 背景

用户的项目目录下存在多个嵌套 git 仓库（主仓库 + 子仓库，或纯文件夹 + 多个仓库）。当前 Git 面板只针对项目根路径操作，子仓库无法被监控。

核心杠杆：**现有全部 git 命令都以 `project_path` 为参数**，天然支持指向任意子仓库路径，后端操作命令（stage/commit/push/pull/diff 等）零改动即可复用。

## 需求

### 后端
1. 新增命令 `git_list_repositories(project_path) -> Vec<GitRepoInfo>`：
   - 限深扫描（建议 2~3 层）项目根目录下含 `.git` 的子目录；
   - 排除 `node_modules`、`.git` 内部、`target`、`dist` 等常见大目录；
   - 返回相对路径 + 绝对路径 +（可选）当前分支；项目根自身是仓库时排在首位。
   - **必须在 `src-tauri/src/lib.rs` 的 `invoke_handler![]` 登记**。
2. `git_watcher.rs` 的 `is_relevant`：`.git` 过滤从"仅根仓库"改为匹配路径中**任意** `/.git/` 段——各仓库的 `index`/`HEAD` 放行，其余（objects/logs/锁文件）过滤。watcher 本身已递归监听项目根，无需多 watcher。

### 后端（补充，来自任务 A 质检发现）
- `parse_wsl_git_status`（git.rs:390）不过滤嵌套仓库目录条目（`?? dir/` 形式仍会进入前端列表；任务 A 的 diff 目录守卫已兜底不报错，但条目仍可见）。本任务实现时在 WSL status 解析链路补上与 libgit2 路径一致的"尾部 `/` + 含 `.git`"过滤（`.git` 存在性检查需经 UNC 路径进行）。

### 前端
3. `src/stores/gitStore.ts`：新增 `repositories: GitRepoInfo[]` 与 `activeRepoPath`；`setProject` 时调用 `git_list_repositories`；所有现有 invoke 的 `projectPath` 改为取 `activeRepoPath ?? currentProjectPath`。
4. `src/components/git/GitChangesPanel.tsx`：检测到 ≥2 个仓库时显示仓库切换下拉（显示相对路径），切换后刷新变更列表/分支状态；单仓库时 UI 不变。

## 验收标准

- 用 `D:\github\nested-git-test` 夹具打开 Git 面板：下拉列出主仓库 + sub-repo-a + sub-repo-b + tools/sub-repo-c，**不含** node_modules 里的假仓库。
- 切到 sub-repo-a：能看到其 `config.txt`(M)、`new-file.txt`(??)，可正常 stage/commit。
- 在 sub-repo-a 内改文件，watcher 触发 `git-changed` 事件、面板自动刷新；子仓库 `.git/objects` 写入不触发刷新风暴。
- `npx tsc --noEmit` 通过；`cd src-tauri && cargo test` 全绿（含 `is_relevant` 新单测、扫描排除规则单测）。
- `CHANGELOG.md` V1.2.5 记录本功能；`docs/功能清单.md` 同步更新。

## 影响范围 / 风险

- 文件：`src-tauri/src/commands/git.rs`、`src-tauri/src/git_watcher.rs`、`src-tauri/src/lib.rs`、`src/stores/gitStore.ts`、`src/components/git/GitChangesPanel.tsx`。
- 风险：
  - `lib.rs` 忘记注册新命令 → 前端 invoke 失败（项目已知约定）；
  - 仓库切换后 watcher 仍绑定项目根，属预期行为（递归监听已覆盖子仓库），不要重绑；
  - 扫描限深与排除表要防止大目录（node_modules）拖慢面板首开；
  - Tab 状态/终端等其他消费 `project_path` 的模块不受影响（仅 gitStore 内部改变传参来源）。
