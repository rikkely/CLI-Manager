#[cfg(target_os = "windows")]
use log::{info, warn};
#[cfg(target_os = "windows")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use tauri::{path::BaseDirectory, Manager};
use tauri::{AppHandle, Runtime};

const CONPTY_RESOURCE_ROOT: &str = "resources/conpty";
const CONPTY_DLL: &str = "conpty.dll";
const OPENCONSOLE_EXE: &str = "OpenConsole.exe";

pub fn initialize<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "windows")]
    {
        match bundled_conpty_dir(app).and_then(prepend_conpty_dir_to_path) {
            Ok(Some(dir)) => info!(
                "bundled ConPTY sideload enabled: dir={}",
                dir.to_string_lossy()
            ),
            Ok(None) => info!("bundled ConPTY sideload skipped: unsupported architecture"),
            Err(err) => warn!("bundled ConPTY sideload unavailable: {err}"),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }
}

#[cfg(target_os = "windows")]
fn bundled_conpty_dir<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, String> {
    let Some(arch_dir) = current_arch_resource_dir() else {
        return Ok(None);
    };
    let resource = format!("{CONPTY_RESOURCE_ROOT}/{arch_dir}");
    let dir = app
        .path()
        .resolve(resource, BaseDirectory::Resource)
        .map_err(|err| format!("resolve_resource_failed: {err}"))?;
    if !has_conpty_runtime_files(&dir) {
        return Err(format!(
            "missing bundled ConPTY files in {}",
            dir.to_string_lossy()
        ));
    }
    Ok(Some(dir))
}

#[cfg(target_os = "windows")]
fn current_arch_resource_dir() -> Option<&'static str> {
    if cfg!(target_arch = "x86_64") {
        Some("x64")
    } else if cfg!(target_arch = "x86") {
        Some("x86")
    } else if cfg!(target_arch = "aarch64") {
        Some("arm64")
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn has_conpty_runtime_files(dir: &Path) -> bool {
    dir.join(CONPTY_DLL).is_file() && dir.join(OPENCONSOLE_EXE).is_file()
}

#[cfg(target_os = "windows")]
fn prepend_conpty_dir_to_path(dir: Option<PathBuf>) -> Result<Option<PathBuf>, String> {
    let Some(dir) = dir else {
        return Ok(None);
    };
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut entries: Vec<PathBuf> = std::env::split_paths(&current).collect();
    if entries.iter().any(|entry| same_path(entry, &dir)) {
        return Ok(Some(dir));
    }
    entries.insert(0, dir.clone());
    let next = std::env::join_paths(entries).map_err(|err| format!("join_path_failed: {err}"))?;
    // This runs during Tauri setup before CLI-Manager creates any PTY sessions.
    unsafe {
        std::env::set_var("PATH", next);
    }
    Ok(Some(dir))
}

#[cfg(target_os = "windows")]
fn same_path(left: &Path, right: &Path) -> bool {
    left.to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .eq_ignore_ascii_case(right.to_string_lossy().trim_end_matches(['\\', '/']))
}

#[cfg(test)]
#[cfg(target_os = "windows")]
mod tests {
    use super::*;

    #[test]
    fn current_arch_resource_dir_matches_supported_windows_targets() {
        assert!(matches!(
            current_arch_resource_dir(),
            Some("x64") | Some("x86") | Some("arm64")
        ));
    }

    #[test]
    fn conpty_runtime_files_require_dll_and_openconsole() {
        let temp = tempfile::tempdir().unwrap();
        assert!(!has_conpty_runtime_files(temp.path()));

        std::fs::write(temp.path().join(CONPTY_DLL), b"dll").unwrap();
        assert!(!has_conpty_runtime_files(temp.path()));

        std::fs::write(temp.path().join(OPENCONSOLE_EXE), b"exe").unwrap();
        assert!(has_conpty_runtime_files(temp.path()));
    }

    #[test]
    fn same_path_is_case_insensitive_and_ignores_trailing_separator() {
        assert!(same_path(
            Path::new(r"C:\App\resources\conpty\x64\"),
            Path::new(r"c:\app\resources\conpty\x64")
        ));
    }
}
