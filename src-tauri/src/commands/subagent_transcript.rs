//! 子 Agent 转录 tail 桥接：订阅一个子 Agent 的转录 jsonl 文件，按行增量向前端推送。
//!
//! 设计取舍：转录文件是短生命周期、append-only 的小文件，且在 SubagentStart 触发时
//! 可能尚未创建。相比 fs-watcher，每订阅一个轻量轮询线程在「文件还不存在 / 被截断 / 跨平台」
//! 上更稳。仅按 `\n` 边界发送完整行，残行留到下次轮询，避免把 jsonl 行/UTF-8 截断。
//!
//! 路径定位：优先用 hook 负载里的 `agentTranscriptPath`；否则由 `cwd + 父 sessionId + agentId`
//! 推导 `<home>/.claude/projects/<slug(cwd)>/<sessionId>/subagents/agent-<agentId>.jsonl`。
//! WSL（Claude 跑在 Linux、上报 Linux 路径）暂不在本版支持：解析不出 Windows 可访问路径时
//! 优雅降级（订阅失败/不 tail），不影响 CLI 与既有功能。

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use log::info;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const EVENT_NAME: &str = "subagent-transcript-append";
const POLL_MS: u64 = 250;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppendPayload {
    /// 订阅键（由前端给定，通常是 agentId），用于把增量路由到对应转录 pane。
    key: String,
    /// 本次新增的完整行（含末尾换行）。
    content: String,
    /// true 表示首次推送或文件被截断，前端应「替换」而非「追加」。
    reset: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeResult {
    pub path: String,
    pub initial_content: String,
}

/// 持有每个订阅的停止开关（drop/置位即让对应轮询线程退出）。
#[derive(Default)]
pub struct SubagentTranscriptBridge {
    entries: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl SubagentTranscriptBridge {
    pub fn new() -> Self {
        Self::default()
    }

    /// 订阅一个转录文件并开始 tail。替换同 key 的旧订阅。路径为空返回错误。
    pub fn subscribe(
        &self,
        app_handle: AppHandle,
        key: String,
        path: String,
    ) -> Result<SubscribeResult, String> {
        if path.trim().is_empty() {
            return Err("empty_transcript_path".to_string());
        }
        // 先停掉同 key 旧订阅，避免重复线程。
        self.unsubscribe(&key);

        let stop = Arc::new(AtomicBool::new(false));
        {
            let mut guard = self
                .entries
                .lock()
                .map_err(|_| "lock_poisoned".to_string())?;
            guard.insert(key.clone(), stop.clone());
        }

        let path_buf = PathBuf::from(&path);
        let (initial_content, initial_offset) = read_new_lines(&path_buf, 0)
            .map(|(content, offset, _)| (content, offset))
            .unwrap_or_else(|| (String::new(), 0));
        let has_initial_content = initial_offset > 0;
        let thread_key = key.clone();
        let thread_path = path.clone();
        thread::spawn(move || {
            tail_loop(
                app_handle,
                thread_key,
                thread_path,
                initial_offset,
                has_initial_content,
                stop,
            )
        });
        info!("[subagent_transcript] subscribe: {key}");
        Ok(SubscribeResult {
            path,
            initial_content,
        })
    }

    /// 停止并移除指定订阅。
    pub fn unsubscribe(&self, key: &str) {
        if let Ok(mut guard) = self.entries.lock() {
            if let Some(stop) = guard.remove(key) {
                stop.store(true, Ordering::Relaxed);
                info!("[subagent_transcript] unsubscribe: {key}");
            }
        }
    }
}

/// 轮询循环：每 POLL_MS 读取自上次 offset 起的新完整行并推送，直到 stop 置位。
fn tail_loop(
    app_handle: AppHandle,
    key: String,
    path: String,
    initial_offset: u64,
    initial_started: bool,
    stop: Arc<AtomicBool>,
) {
    let path = PathBuf::from(path);
    let mut offset = initial_offset;
    let mut started = initial_started;

    while !stop.load(Ordering::Relaxed) {
        if let Some((content, new_offset, shrank)) = read_new_lines(&path, offset) {
            let reset = shrank || !started;
            started = true;
            offset = new_offset;
            let payload = AppendPayload {
                key: key.clone(),
                content,
                reset,
            };
            let _ = app_handle.emit(EVENT_NAME, payload);
        }
        thread::sleep(Duration::from_millis(POLL_MS));
    }
}

/// 从 `offset` 起读取新内容，仅返回到最后一个换行为止的完整行。
/// 返回 `(完整行内容, 新 offset, 是否因文件变短而重置)`；无新完整行时返回 None。
fn read_new_lines(path: &Path, offset: u64) -> Option<(String, u64, bool)> {
    let len = fs::metadata(path).ok()?.len();
    let (start, shrank) = if len < offset {
        (0u64, true)
    } else {
        (offset, false)
    };
    if len <= start {
        return None;
    }

    let mut file = File::open(path).ok()?;
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;

    // 只发送到最后一个换行；残行留到下次（换行是 ASCII，切点同时是 UTF-8 边界）。
    let last_nl = buf.iter().rposition(|&b| b == b'\n')?;
    let complete = &buf[..=last_nl];
    let consumed = start + complete.len() as u64;
    Some((
        String::from_utf8_lossy(complete).to_string(),
        consumed,
        shrank,
    ))
}

/// cwd → Claude projects 目录 slug：把 `:`、`\`、`/` 全部替换为 `-`，其余保留。
/// 例：`D:\work\pythonProject\CLI-Manager` → `D--work-pythonProject-CLI-Manager`。
fn slug_for_cwd(cwd: &str) -> String {
    cwd.chars()
        .map(|c| {
            if matches!(c, ':' | '\\' | '/') {
                '-'
            } else {
                c
            }
        })
        .collect()
}

/// 由 home + cwd + 父 sessionId + agentId 推导子 Agent 转录 jsonl 路径。
fn derive_transcript_path(home: &Path, cwd: &str, session_id: &str, agent_id: &str) -> String {
    home.join(".claude")
        .join("projects")
        .join(slug_for_cwd(cwd))
        .join(session_id)
        .join("subagents")
        .join(format!("agent-{agent_id}.jsonl"))
        .to_string_lossy()
        .to_string()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var_os("HOME").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

/// 解析转录路径：优先显式 `agentTranscriptPath`，否则由 cwd+sessionId+agentId 推导。
fn resolve_transcript_path(
    transcript_path: Option<String>,
    cwd: Option<String>,
    session_id: Option<String>,
    agent_id: Option<String>,
) -> Result<String, String> {
    let trimmed = |value: Option<String>| {
        value
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };

    if let Some(explicit) = trimmed(transcript_path) {
        return Ok(explicit);
    }

    let home = home_dir().ok_or_else(|| "no_home_dir".to_string())?;
    let cwd = trimmed(cwd).ok_or_else(|| "missing_cwd".to_string())?;
    let session_id = trimmed(session_id).ok_or_else(|| "missing_session_id".to_string())?;
    let agent_id = trimmed(agent_id).ok_or_else(|| "missing_agent_id".to_string())?;
    Ok(derive_transcript_path(&home, &cwd, &session_id, &agent_id))
}

/// 订阅子 Agent 转录并开始 tail；返回最终解析到的文件路径（供前端展示/调试）。
#[tauri::command]
pub async fn subagent_transcript_subscribe(
    app_handle: AppHandle,
    bridge: State<'_, SubagentTranscriptBridge>,
    key: String,
    transcript_path: Option<String>,
    cwd: Option<String>,
    session_id: Option<String>,
    agent_id: Option<String>,
) -> Result<SubscribeResult, String> {
    if key.trim().is_empty() {
        return Err("missing_key".to_string());
    }
    let path = resolve_transcript_path(transcript_path, cwd, session_id, agent_id)?;
    bridge.subscribe(app_handle, key, path)
}

/// 取消订阅并停止 tail 线程。
#[tauri::command]
pub async fn subagent_transcript_unsubscribe(
    bridge: State<'_, SubagentTranscriptBridge>,
    key: String,
) -> Result<(), String> {
    bridge.unsubscribe(&key);
    Ok(())
}

/// 扫描 subagents 目录，返回发现的 agent-*.jsonl 文件列表（仅文件名，不含路径）。
/// 用于 AgentToolStart fallback：当 hook payload 缺少 agentId 时，前端短时轮询此命令发现新 child。
#[tauri::command]
pub async fn subagent_transcript_discover(
    cwd: String,
    session_id: String,
) -> Result<Vec<String>, String> {
    let home = home_dir().ok_or_else(|| "no_home_dir".to_string())?;
    let subagents_dir = home
        .join(".claude")
        .join("projects")
        .join(slug_for_cwd(&cwd))
        .join(session_id)
        .join("subagents");

    if !subagents_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = std::fs::read_dir(&subagents_dir).map_err(|e| e.to_string())?;
    let mut agent_files = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("agent-") && name.ends_with(".jsonl") {
                    agent_files.push(name.to_string());
                }
            }
        }
    }

    Ok(agent_files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_replaces_separators_only() {
        assert_eq!(
            slug_for_cwd(r"D:\work\pythonProject\CLI-Manager"),
            "D--work-pythonProject-CLI-Manager"
        );
        assert_eq!(slug_for_cwd("/home/u/proj"), "-home-u-proj");
        assert_eq!(slug_for_cwd("C:/a/b"), "C--a-b");
    }

    #[test]
    fn derive_builds_subagent_jsonl_path() {
        let home = Path::new(r"C:\Users\me");
        let path =
            derive_transcript_path(home, r"D:\work\pythonProject\CLI-Manager", "sess-1", "a99");
        let norm = path.replace('\\', "/");
        assert!(
            norm.ends_with(
                ".claude/projects/D--work-pythonProject-CLI-Manager/sess-1/subagents/agent-a99.jsonl"
            ),
            "got {path}"
        );
    }

    #[test]
    fn resolve_prefers_explicit_transcript_path() {
        let got =
            resolve_transcript_path(Some("  /tmp/a.jsonl ".to_string()), None, None, None).unwrap();
        assert_eq!(got, "/tmp/a.jsonl");
    }

    #[test]
    fn resolve_requires_parts_when_no_explicit_path() {
        let err = resolve_transcript_path(None, None, None, None).unwrap_err();
        // 缺 home 或缺 cwd 都应报错（不静默编出错误路径）。
        assert!(err == "missing_cwd" || err == "no_home_dir", "got {err}");
    }

    #[test]
    fn read_new_lines_returns_offset_for_complete_lines_only() {
        let path = std::env::temp_dir().join(format!(
            "cli-manager-subagent-transcript-{}.jsonl",
            std::process::id()
        ));
        fs::write(&path, "{\"a\":1}\n{\"b\":2}\n{\"partial\":").unwrap();

        let (content, offset, shrank) = read_new_lines(&path, 0).unwrap();
        assert_eq!(content, "{\"a\":1}\n{\"b\":2}\n");
        assert_eq!(offset as usize, content.len());
        assert!(!shrank);

        fs::write(&path, "{\"a\":1}\n{\"b\":2}\n{\"c\":3}\n").unwrap();
        let (content, next_offset, shrank) = read_new_lines(&path, offset).unwrap();
        assert_eq!(content, "{\"c\":3}\n");
        assert_eq!(next_offset as usize, "{\"a\":1}\n{\"b\":2}\n{\"c\":3}\n".len());
        assert!(!shrank);

        let _ = fs::remove_file(path);
    }
}
