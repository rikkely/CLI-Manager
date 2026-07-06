# PRD: 修复嵌套 git 子仓库导致的扫描报错 (os error 123)

- Issue: https://github.com/dark-hxx/CLI-Manager/issues/85
- Changelog Target: V1.2.5
- 类型: Bugfix（方案 A，兼容性修复）

## 背景 / 根因

主仓库下嵌套子 git 仓库（非 submodule）时：

1. libgit2 status（`collect_git_changes_from_repo`，`src-tauri/src/commands/git.rs:517`）不会递归进入子仓库，而是返回一条**带尾部斜杠的未跟踪目录条目**（如 `sub-repo-a/`）；
2. 前端 Git 面板把它当普通文件渲染，请求 diff 时走 `git_get_file_diff` 的未跟踪分支（`git.rs:764-783`）；
3. 后端对目录路径执行 `std::fs::read_to_string`，Windows 报原始 OS 错误（错误码随环境浮动：os error 5 / 3 / 123，用户报的是 123 "文件名、目录名或卷标语法不正确"）。

错误串 `读取文件失败` 全仓库仅 `git.rs:768` 一处，已精确定位。

## 需求

> **勘误（实测发现）**：Git 面板实际调用的是 `git_get_changes`（git.rs:179），其内部有一段与 `collect_git_changes_from_repo` 重复的内联 status 收集循环——首轮只改后者导致 UI 无效果。最终实现为提取 `is_nested_repo_entry()` 工具函数，两个循环共用。

1. `git_get_changes` 与 `collect_git_changes_from_repo`：识别"尾部 `/` 且该目录含 `.git`"的条目（`is_nested_repo_entry`），不再作为普通未跟踪文件混入变更列表。
2. `git_get_file_diff`：未跟踪分支读取前加目录守卫——join 后路径 `is_dir()` 时返回友好中文提示（如"该条目是嵌套 Git 仓库目录，无法显示文件 diff"），不再抛原始 OS 错误。两处都改，互为兜底。

## 验收标准

- 测试夹具：`D:\github\nested-git-test`（主仓库含已修改/未跟踪文件 + 一级子仓库 sub-repo-a/sub-repo-b + 二级子仓库 tools/sub-repo-c + node_modules 假 .git）。
- 用该夹具作为项目打开 Git 面板：变更列表正常显示 `README.md`(M)、`untracked.txt`(??)，不出现 os error 123/5/3 报错。
- 子仓库目录条目不再以可点击文件形式出现（或点击后得到友好提示而非报错）。
- `cd src-tauri && cargo test` 全绿；新增针对目录守卫的单测。

## 影响范围 / 风险

- 仅 `src-tauri/src/commands/git.rs` 两个函数，约 20 行；无 IPC 签名变化、无迁移、无前端改动。
- 风险：无兼容性风险；注意不要误伤正常的未跟踪子目录文件（`recurse_untracked_dirs(true)` 已展开普通目录，只有嵌套仓库才会以 `dir/` 形式出现，需以"含 .git"为判定条件）。
