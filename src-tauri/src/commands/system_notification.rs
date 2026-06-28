use log::warn;
use notify_rust::NotificationResponse;
use serde::Serialize;
use std::{env, fs, process::Stdio};
use tauri::{AppHandle, Emitter};

const MAX_NOTIFICATION_TITLE_CHARS: usize = 200;
const MAX_NOTIFICATION_BODY_CHARS: usize = 1000;
const MAX_NOTIFICATION_ACTION_LABEL_CHARS: usize = 80;
const MAX_NOTIFICATION_TAB_ID_CHARS: usize = 200;
const SYSTEM_NOTIFICATION_ACTION_EVENT: &str = "system-notification-action";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemNotificationActionPayload {
    tab_id: String,
}

/// 检测当前是否运行在 WSL 环境中。
///
/// 优先检查 WSL 注入的环境变量，再读取 `/proc/version`，若包含
/// "microsoft" 或 "wsl" 关键字则判定为 WSL。若文件不存在或读取失败
/// （非 Linux），返回 false。
#[tauri::command]
pub fn is_wsl() -> bool {
    if cfg!(windows) {
        return false;
    }

    if env::var_os("WSL_DISTRO_NAME").is_some() || env::var_os("WSL_INTEROP").is_some() {
        return true;
    }

    fs::read_to_string("/proc/version")
        .map(|s| {
            let lower = s.to_lowercase();
            lower.contains("microsoft") || lower.contains("wsl")
        })
        .unwrap_or(false)
}

/// WSL 环境下通过 Windows 主机发送系统通知。
///
/// 使用 PowerShell + WinRT Toast API（Windows 原生），无需额外依赖。
/// 通知从 WSL 内调用 `powershell.exe`，桥接到 Windows 宿主的通知中心。
///
/// 注意：
/// - 标题和正文会做长度与 NUL 字符校验。
/// - 标题和正文中的 XML 特殊字符会自动转义。
/// - PowerShell 单引号会被转义（`'` → `''`）。
/// - 使用 `spawn()` 而非 `output()` 以避免阻塞调用者（异步发送）。
#[tauri::command]
pub async fn send_notification_via_windows(title: String, body: String) -> Result<(), String> {
    if !is_wsl() {
        return Err("windows_notification_bridge_requires_wsl".into());
    }

    validate_notification_title(&title)?;
    validate_notification_body(&body)?;

    let xml = format!(
        r#"<toast><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text><text placement="attribution">来自 CLI-Manager</text></binding></visual></toast>"#,
        xml_escape(&title),
        xml_escape(&body)
    );

    let script = format!(
        r#"
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;
        $xml = [Windows.Data.Xml.Dom.XmlDocument]::new();
        $xml.LoadXml('{}');
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml);
        try {{
          $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('com.cli-manager.app');
          $notifier.Show($toast);
        }} catch {{
          [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('CLI-Manager').Show($toast);
        }}
        "#,
        xml.replace('\'', "''")
    );

    spawn_powershell_notification(&script)
}

#[tauri::command]
pub async fn send_interactive_system_notification(
    app: AppHandle,
    title: String,
    body: String,
    tab_id: String,
    action_label: String,
) -> Result<(), String> {
    validate_notification_title(&title)?;
    validate_notification_body(&body)?;
    validate_notification_text(
        &tab_id,
        MAX_NOTIFICATION_TAB_ID_CHARS,
        "notification_tab_id",
    )?;
    if tab_id.trim().is_empty() {
        return Err("notification_tab_id_empty".into());
    }
    validate_notification_text(
        &action_label,
        MAX_NOTIFICATION_ACTION_LABEL_CHARS,
        "notification_action_label",
    )?;
    if action_label.trim().is_empty() {
        return Err("notification_action_label_empty".into());
    }

    let app_id = app.config().identifier.clone();
    let mut notification = notify_rust::Notification::new();
    notification
        .summary(&title)
        .body(&body)
        .appname("CLI-Manager")
        .auto_icon()
        .action("default", &action_label);

    #[cfg(target_os = "windows")]
    if should_use_registered_windows_app_id() {
        notification.app_id(&app_id);
    }

    #[cfg(target_os = "macos")]
    {
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            app_id.as_str()
        });
    }

    let handle = notification
        .show()
        .map_err(|err| format!("notification_show_failed: {}", err))?;
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(err) = handle.wait_for_response(|response: &NotificationResponse| {
            if matches!(
                response,
                NotificationResponse::Default | NotificationResponse::Action(_)
            ) {
                let payload = SystemNotificationActionPayload {
                    tab_id: tab_id.clone(),
                };
                if let Err(err) = app_handle.emit(SYSTEM_NOTIFICATION_ACTION_EVENT, payload) {
                    warn!("system notification action emit failed: {}", err);
                }
            }
        }) {
            warn!("system notification response wait failed: {}", err);
        }
    });

    Ok(())
}

#[cfg(windows)]
fn spawn_powershell_notification(script: &str) -> Result<(), String> {
    crate::shell_resolver::silent_command("powershell.exe")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to spawn powershell.exe: {}", e))
}

#[cfg(target_os = "windows")]
fn should_use_registered_windows_app_id() -> bool {
    use std::path::MAIN_SEPARATOR as SEP;

    let Ok(exe) = tauri::utils::platform::current_exe() else {
        return false;
    };
    let Some(exe_dir) = exe.parent() else {
        return false;
    };
    let curr_dir = exe_dir.display().to_string();
    !(curr_dir.ends_with(format!("{SEP}target{SEP}debug").as_str())
        || curr_dir.ends_with(format!("{SEP}target{SEP}release").as_str()))
}

#[cfg(not(windows))]
fn spawn_powershell_notification(script: &str) -> Result<(), String> {
    std::process::Command::new("powershell.exe")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to spawn powershell.exe: {}", e))
}

fn validate_notification_title(title: &str) -> Result<(), String> {
    if title.trim().is_empty() {
        return Err("notification_title_empty".into());
    }
    validate_notification_text(title, MAX_NOTIFICATION_TITLE_CHARS, "notification_title")
}

fn validate_notification_body(body: &str) -> Result<(), String> {
    validate_notification_text(body, MAX_NOTIFICATION_BODY_CHARS, "notification_body")
}

fn validate_notification_text(value: &str, max_chars: usize, field: &str) -> Result<(), String> {
    if value.contains('\0') {
        return Err(format!("{}_contains_nul", field));
    }
    if value.chars().count() > max_chars {
        return Err(format!("{}_too_long", field));
    }
    Ok(())
}

/// XML 特殊字符转义（用于 Toast XML），并替换 XML 1.0 不允许的控制字符。
fn xml_escape(s: &str) -> String {
    let mut escaped = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            '\t' | '\n' | '\r' => escaped.push(ch),
            ch if ch.is_control() => escaped.push(' '),
            ch => escaped.push(ch),
        }
    }
    escaped
}
