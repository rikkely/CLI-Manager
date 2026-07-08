use serde::Serialize;
use std::env;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct TerminalShellProfile {
    id: String,
    label: String,
    platform: String,
    kind: String,
    command: String,
    enabled: bool,
    detected: bool,
}

fn profile(platform: &str, command: &str, label: &str) -> TerminalShellProfile {
    TerminalShellProfile {
        id: format!("known:{command}"),
        label: label.to_string(),
        platform: platform.to_string(),
        kind: "known".to_string(),
        command: command.to_string(),
        enabled: true,
        detected: true,
    }
}

fn path_candidate(name: &str) -> Option<PathBuf> {
    let direct = PathBuf::from(name);
    if direct.exists() {
        return Some(direct);
    }
    env::var_os("PATH").and_then(|path| {
        env::split_paths(&path)
            .map(|dir| dir.join(name))
            .find(|candidate| candidate.exists())
    })
}

fn command_exists(name: &str) -> bool {
    path_candidate(name).is_some()
}

#[cfg(target_os = "windows")]
fn wsl_available() -> bool {
    let Some(wsl) = crate::wsl::find_wsl_exe() else {
        return false;
    };
    let wsl_exe = wsl.to_string_lossy().to_string();
    crate::shell_resolver::silent_command(&wsl_exe)
        .args(["-l", "-q"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn scan_windows() -> Vec<TerminalShellProfile> {
    let mut profiles = Vec::new();
    if command_exists("powershell.exe") {
        profiles.push(profile("windows", "powershell", "PowerShell"));
    }
    if command_exists("cmd.exe") {
        profiles.push(profile("windows", "cmd", "CMD"));
    }
    if command_exists("pwsh.exe") {
        profiles.push(profile("windows", "pwsh", "PowerShell 7"));
    }
    if crate::shell_resolver::resolve_git_bash_exe().is_some() {
        profiles.push(profile("windows", "gitbash", "Git Bash"));
    }
    if wsl_available() {
        profiles.push(profile("windows", "wsl", "WSL"));
    }
    profiles
}

#[cfg(target_os = "macos")]
fn scan_macos() -> Vec<TerminalShellProfile> {
    let mut profiles = Vec::new();
    if command_exists("zsh") {
        profiles.push(profile("macos", "zsh", "Zsh"));
    }
    if command_exists("bash") {
        profiles.push(profile("macos", "bash", "Bash"));
    }
    if command_exists("fish") {
        profiles.push(profile("macos", "fish", "Fish"));
    }
    if command_exists("sh") {
        profiles.push(profile("macos", "sh", "Sh"));
    }
    if command_exists("pwsh") {
        profiles.push(profile("macos", "pwsh", "PowerShell 7"));
    }
    profiles
}

#[cfg(target_os = "linux")]
fn scan_linux() -> Vec<TerminalShellProfile> {
    let mut profiles = Vec::new();
    if command_exists("bash") {
        profiles.push(profile("linux", "bash", "Bash"));
    }
    if command_exists("zsh") {
        profiles.push(profile("linux", "zsh", "Zsh"));
    }
    if command_exists("fish") {
        profiles.push(profile("linux", "fish", "Fish"));
    }
    if command_exists("sh") {
        profiles.push(profile("linux", "sh", "Sh"));
    }
    if command_exists("pwsh") {
        profiles.push(profile("linux", "pwsh", "PowerShell 7"));
    }
    profiles
}

#[tauri::command]
pub fn terminal_shell_scan() -> Result<Vec<TerminalShellProfile>, String> {
    #[cfg(target_os = "windows")]
    {
        return Ok(scan_windows());
    }
    #[cfg(target_os = "macos")]
    {
        return Ok(scan_macos());
    }
    #[cfg(target_os = "linux")]
    {
        return Ok(scan_linux());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Ok(Vec::new())
    }
}
