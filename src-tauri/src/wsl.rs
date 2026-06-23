// WSL 路径互转与判定工具。
// 用户在 Windows 上把终端 shell 选成 WSL 时，claude/codex 跑在 Linux 内：
// - 会话按 Linux cwd（/mnt/d/...）编码，需要把项目的 Windows 路径转成 WSL 形式做匹配；
// - hook 注册命令里的 exe 必须是 Linux 可执行形式（/mnt/c/...exe），否则 /bin/sh 报 not found。

/// `D:\a\b` -> `/mnt/d/a/b`（盘符小写、反斜杠转正斜杠）。
/// 仅当输入形如 `<盘符>:\...` 或 `<盘符>:/...` 时返回 Some，否则 None（已是 Linux 路径/UNC 等不转）。
pub fn windows_path_to_wsl(path: &str) -> Option<String> {
    let path = path.trim();
    let bytes = path.as_bytes();
    if bytes.len() < 2 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
        return None;
    }
    // 第三个字符必须是路径分隔符，避免把 `C:relative` 这类奇异形式误转
    let rest = &path[2..];
    if !rest.starts_with('\\') && !rest.starts_with('/') {
        return None;
    }
    let drive = path[..1].to_ascii_lowercase();
    let tail = rest.replace('\\', "/");
    let tail = tail.trim_start_matches('/');
    if tail.is_empty() {
        Some(format!("/mnt/{drive}"))
    } else {
        Some(format!("/mnt/{drive}/{tail}"))
    }
}

/// 判断一个配置目录路径是否指向 WSL（`\\wsl.localhost\...` 或 `\\wsl$\...`，大小写不敏感）。
pub fn is_wsl_config_dir(path: &str) -> bool {
    let normalized = path.trim().replace('/', "\\").to_ascii_lowercase();
    normalized.starts_with("\\\\wsl.localhost\\") || normalized.starts_with("\\\\wsl$\\")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_drive_paths() {
        assert_eq!(
            windows_path_to_wsl(r"D:\work\pythonProject\CLI-Manager").as_deref(),
            Some("/mnt/d/work/pythonProject/CLI-Manager")
        );
        assert_eq!(
            windows_path_to_wsl(r"C:\Users\me\app.exe").as_deref(),
            Some("/mnt/c/Users/me/app.exe")
        );
        // 正斜杠输入与盘根
        assert_eq!(
            windows_path_to_wsl("E:/data").as_deref(),
            Some("/mnt/e/data")
        );
        assert_eq!(windows_path_to_wsl(r"F:\").as_deref(), Some("/mnt/f"));
    }

    #[test]
    fn rejects_non_drive_paths() {
        assert_eq!(windows_path_to_wsl("/mnt/d/work"), None);
        assert_eq!(windows_path_to_wsl(r"\\wsl.localhost\Ubuntu\home"), None);
        assert_eq!(windows_path_to_wsl("relative/path"), None);
        assert_eq!(windows_path_to_wsl("C:relative"), None);
    }

    #[test]
    fn detects_wsl_config_dir() {
        assert!(is_wsl_config_dir(
            r"\\wsl.localhost\Ubuntu-22.04\home\me\.claude"
        ));
        assert!(is_wsl_config_dir(r"\\wsl$\Ubuntu\home\me\.claude"));
        assert!(is_wsl_config_dir(r"\\WSL.LOCALHOST\Ubuntu\home")); // 大小写不敏感
        assert!(!is_wsl_config_dir(r"C:\Users\me\.claude"));
        assert!(!is_wsl_config_dir(r"\\server\share\.claude")); // 普通 UNC 不算
    }
}
