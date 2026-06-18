// 隐藏子命令 `__hook` 的实现：作为 Claude/Codex 的 hook 命令被高频调用。
// 取代旧版 PowerShell 脚本，做到 Windows / macOS / Linux 跨平台一致。
//
// 流程：读取注入的回调环境变量 + stdin 事件 JSON，向本地通知服务
// POST 一条事件，然后无条件退出。任何缺失/失败都静默 exit(0)，绝不打断 CLI。
use std::env;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::exit;
use std::time::Duration;

use serde_json::{json, Value};

/// `main` 在初始化 Tauri runtime 之前调用本函数并退出，因此这里
/// 不依赖任何 Tauri/WebView 状态，冷启动开销极小。
pub fn run_and_exit(source: &str, event: &str) -> ! {
    // 忽略一切错误：hook 失败不能影响被监听的 CLI。
    let _ = try_notify(source, event);
    exit(0);
}

fn try_notify(source: &str, event: &str) -> Option<()> {
    // 三个回调环境变量由 PTY 注入（claude_hook::apply_env）。缺任一即未启用回调，直接退出。
    let tab_id = non_empty_env("CLI_MANAGER_TAB_ID")?;
    let port = non_empty_env("CLI_MANAGER_NOTIFY_PORT")?;
    let token = non_empty_env("CLI_MANAGER_NOTIFY_TOKEN")?;

    let mut stdin_raw = String::new();
    let _ = std::io::stdin().read_to_string(&mut stdin_raw);
    let hook_input: Value = serde_json::from_str(stdin_raw.trim()).unwrap_or(Value::Null);

    let message = first_string(&hook_input, &["message", "prompt", "notification", "reason"]);
    let session_id = hook_input
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::to_string);
    let cwd = env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string());

    // 字段名为 camelCase，对应 claude_hook::ClaudeHookRequest 的 serde(rename_all = "camelCase")。
    let payload = json!({
        "tabId": tab_id,
        "source": source,
        "event": event,
        "title": title_for(source, event),
        "message": message,
        "sessionId": session_id,
        "cwd": cwd,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    let body = serde_json::to_vec(&payload).ok()?;

    post(&port, &token, &body)
}

fn post(port: &str, token: &str, body: &[u8]) -> Option<()> {
    let port: u16 = port.parse().ok()?;
    let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));

    let head = format!(
        "POST /api/claude-hook HTTP/1.1\r\n\
         Host: 127.0.0.1\r\n\
         Authorization: Bearer {token}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).ok()?;
    stream.write_all(body).ok()?;
    stream.flush().ok()?;

    // 读掉响应，确保服务端处理完再退出（内容不关心）。
    let mut sink = [0u8; 256];
    let _ = stream.read(&mut sink);
    Some(())
}

fn non_empty_env(key: &str) -> Option<String> {
    env::var(key).ok().filter(|value| !value.trim().is_empty())
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str).map(str::to_string))
}

/// 与旧 PowerShell 脚本保持一致的标题文案；前端在缺省时会自行兜底（App.tsx）。
fn title_for(source: &str, event: &str) -> &'static str {
    match (source, event) {
        ("codex", "SessionStart") => "Codex CLI session started",
        ("codex", "UserPromptSubmit") => "Codex CLI running",
        ("codex", "Stop") => "Codex CLI done",
        ("codex", _) => "Codex CLI needs attention", // PermissionRequest
        (_, "SessionStart") => "Claude Code session started",
        (_, "UserPromptSubmit") => "Claude Code running",
        (_, "Stop") => "Claude Code done",
        (_, "StopFailure") => "Claude Code failed",
        (_, _) => "Claude Code needs attention", // Notification
    }
}
