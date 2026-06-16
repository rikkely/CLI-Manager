use std::fs;
use std::path::{Path, PathBuf};

/// 查询指定路径的当前 git 分支
///
/// 通过读取 `.git/HEAD` 解析分支名，避免 spawn `git` 子进程（Windows 上进程创建较慢，
/// 且本命令被实时统计面板按秒级轮询调用）。整段同步 IO 包在 `spawn_blocking` 内，
/// 不阻塞 tokio runtime 工作线程。
///
/// # Returns
/// * `Ok(Some(branch))` - 普通分支（HEAD 为 `ref: refs/heads/<branch>`）
/// * `Ok(None)` - 非 git 仓库、detached HEAD，或读取失败
#[tauri::command]
pub async fn get_current_git_branch(path: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || resolve_current_branch(Path::new(&path)))
        .await
        .map_err(|e| format!("git 分支查询任务失败: {e}"))
}

/// 读取 `.git/HEAD` 解析当前分支名。
/// detached HEAD（HEAD 直接为 commit hash）返回 `None`，与 `git branch --show-current` 语义一致。
fn resolve_current_branch(project_path: &Path) -> Option<String> {
    let git_dir = resolve_git_dir(&project_path.join(".git"))?;
    let head = fs::read_to_string(git_dir.join("HEAD")).ok()?;
    // 普通分支：`ref: refs/heads/<branch>`；分支名可能含 "/"（如 feature/foo），保留剩余全部。
    let reference = head.trim().strip_prefix("ref:")?.trim();
    let branch = reference.strip_prefix("refs/heads/")?.trim();
    (!branch.is_empty()).then(|| branch.to_string())
}

/// 解析真实 git 目录：
/// - `.git` 为目录（普通仓库）：直接使用
/// - `.git` 为文件（worktree / submodule）：内容形如 `gitdir: <path>`，指向真实 git 目录
fn resolve_git_dir(git_path: &Path) -> Option<PathBuf> {
    let metadata = fs::metadata(git_path).ok()?;
    if metadata.is_dir() {
        return Some(git_path.to_path_buf());
    }

    let content = fs::read_to_string(git_path).ok()?;
    let gitdir = content.trim().strip_prefix("gitdir:")?.trim();
    if gitdir.is_empty() {
        return None;
    }

    let gitdir_path = Path::new(gitdir);
    let resolved = if gitdir_path.is_absolute() {
        gitdir_path.to_path_buf()
    } else {
        // 相对路径相对于 `.git` 文件所在目录
        git_path.parent()?.join(gitdir_path)
    };
    Some(resolved)
}
