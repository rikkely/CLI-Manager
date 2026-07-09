//! 会话历史消息级编辑：编辑 / 删除 / 插入历史消息并写回 CLI 本地 JSONL。
//!
//! 安全模型：
//! - 路径复用 `validate_session_file_ref`（canonicalize + history scope 校验）。
//! - 双守卫：文件指纹（`expected_updated_at`）拦截外部并发改动；目标行 role + 规范文本
//!   复核拦截行号漂移。守卫失败返回稳定错误码，前端据此重载会话。
//! - 首次写入某文件前整文件备份到 `.cli-manager/history-backups/`，支持一键还原。
//! - 写回 tmp + rename 原子替换；除目标行外其余行原始字节不动。
//!
//! 格式语义：
//! - Claude 行（type=user/assistant）：content 字符串直接替换；块数组只替换首个 text 块、
//!   删除多余 text 块、非文本块（image/tool_use/tool_result）原位保留。删除行后把所有
//!   `parentUuid == 被删行 uuid` 的行重链到被删行的 parentUuid；插入行生成新 uuid 并接管锚点的子链。
//! - Codex 行（type=response_item message）：payload.content 文本块替换，并就近同步配对的
//!   `event_msg`（user_message/agent_message）——模型上下文与 TUI 重放必须一致（与互转功能同口径）。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::history::{
    build_session_detail, extract_editable_text, history_roots, invalidate_history_caches,
    now_rfc3339, parse_message, session_file_fingerprint, validate_session_file_ref,
    HistorySessionDetail, SessionFileRef,
};
use crate::app_paths;

const TEXT_BLOCK_TYPES: [&str; 3] = ["text", "input_text", "output_text"];
/// event_msg 配对查找的窗口：Codex 写入器把配对行放在 response_item 附近。
const CODEX_EVENT_PAIR_SEARCH_WINDOW: usize = 50;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEditOutcome {
    pub detail: HistorySessionDetail,
    pub before_text: Option<String>,
    pub after_text: Option<String>,
    pub backup_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryBackupStatus {
    pub has_backup: bool,
    pub backup_path: Option<String>,
    pub backup_at: Option<i64>,
}

/// 按 '\n' 切分并记录末尾换行，未改动的行（含可能的行尾 '\r'）原样回写。
/// 切分口径与扫描侧 `BufRead::lines` 一致，保证 line_index 双向可互指。
struct SessionFileLines {
    lines: Vec<String>,
    ends_with_newline: bool,
}

fn read_session_file_lines(path: &Path) -> Result<SessionFileLines, String> {
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let ends_with_newline = raw.ends_with('\n');
    let mut lines: Vec<String> = raw.split('\n').map(str::to_string).collect();
    if ends_with_newline {
        lines.pop();
    }
    Ok(SessionFileLines {
        lines,
        ends_with_newline,
    })
}

fn write_session_file_lines(path: &Path, file_lines: &SessionFileLines) -> Result<(), String> {
    let mut content = file_lines.lines.join("\n");
    if file_lines.ends_with_newline {
        content.push('\n');
    }
    let tmp = path.with_extension("jsonl.cli-manager-tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|err| err.to_string())?;
    fs::rename(&tmp, path).map_err(|err| {
        let _ = fs::remove_file(&tmp);
        err.to_string()
    })
}

fn ensure_fingerprint(path: &Path, expected_updated_at: i64) -> Result<(), String> {
    if session_file_fingerprint(path).updated_at != expected_updated_at {
        return Err("history_file_changed".to_string());
    }
    Ok(())
}

fn parse_line_value(file_lines: &SessionFileLines, line_index: usize) -> Result<Value, String> {
    let line = file_lines
        .lines
        .get(line_index)
        .ok_or_else(|| "history_line_conflict".to_string())?;
    serde_json::from_str::<Value>(line.trim()).map_err(|_| "history_line_conflict".to_string())
}

/// 行级复核：目标行必须仍解析出同 role 的消息，且规范文本与前端加载时一致。
/// 前端 `expected_text = editable_text ?? content`，两侧口径见 scan 的省略规则。
fn ensure_line_matches(value: &Value, expected_role: &str, expected_text: &str) -> Result<String, String> {
    let parsed = parse_message(value).ok_or_else(|| "history_line_conflict".to_string())?;
    if parsed.role != expected_role {
        return Err("history_line_conflict".to_string());
    }
    let editable = extract_editable_text(value).ok_or_else(|| "message_not_editable".to_string())?;
    if editable != expected_text && parsed.content != expected_text {
        return Err("history_line_conflict".to_string());
    }
    Ok(editable)
}

fn apply_text_to_line(value: &mut Value, new_text: &str) -> Result<(), String> {
    let root_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let content = if root_type == "user" || root_type == "assistant" {
        value
            .get_mut("message")
            .and_then(|message| message.get_mut("content"))
    } else if root_type == "response_item" {
        value
            .get_mut("payload")
            .and_then(|payload| payload.get_mut("content"))
    } else {
        None
    };
    apply_text_to_content(content.ok_or_else(|| "message_not_editable".to_string())?, new_text)
}

fn apply_text_to_content(content: &mut Value, new_text: &str) -> Result<(), String> {
    match content {
        Value::String(_) => {
            *content = Value::String(new_text.to_string());
            Ok(())
        }
        Value::Array(blocks) => {
            let mut replaced = false;
            let mut kept: Vec<Value> = Vec::with_capacity(blocks.len());
            for mut block in blocks.drain(..) {
                let block_type = block
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if TEXT_BLOCK_TYPES.contains(&block_type.as_str()) {
                    // 首个文本块承接新文本；多余文本块删除（其内容已并入编辑框），非文本块原位保留。
                    if replaced {
                        continue;
                    }
                    match block.get_mut("text") {
                        Some(slot) => *slot = Value::String(new_text.to_string()),
                        None => return Err("message_not_editable".to_string()),
                    }
                    replaced = true;
                }
                kept.push(block);
            }
            if !replaced {
                return Err("message_not_editable".to_string());
            }
            *content = Value::Array(kept);
            Ok(())
        }
        _ => Err("message_not_editable".to_string()),
    }
}

fn is_codex_message_line(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("response_item")
}

fn is_claude_message_line(value: &Value) -> bool {
    matches!(
        value.get("type").and_then(Value::as_str),
        Some("user") | Some("assistant")
    )
}

fn codex_event_payload_type(role: &str) -> &'static str {
    if role == "assistant" {
        "agent_message"
    } else {
        "user_message"
    }
}

fn is_matching_codex_event(line: &str, event_type: &str, message_text: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
        return false;
    };
    if value.get("type").and_then(Value::as_str) != Some("event_msg") {
        return false;
    }
    let Some(payload) = value.get("payload") else {
        return false;
    };
    payload.get("type").and_then(Value::as_str) == Some(event_type)
        && payload.get("message").and_then(Value::as_str) == Some(message_text)
}

/// 就近查找 response_item 的 TUI 配对行：先向后（写入器默认相邻），再向前兜底。
fn find_codex_event_pair(
    file_lines: &SessionFileLines,
    response_line: usize,
    role: &str,
    message_text: &str,
) -> Option<usize> {
    let event_type = codex_event_payload_type(role);
    let end = file_lines
        .lines
        .len()
        .min(response_line.saturating_add(CODEX_EVENT_PAIR_SEARCH_WINDOW));
    for idx in (response_line + 1)..end {
        if is_matching_codex_event(&file_lines.lines[idx], event_type, message_text) {
            return Some(idx);
        }
    }
    let start = response_line.saturating_sub(CODEX_EVENT_PAIR_SEARCH_WINDOW);
    for idx in (start..response_line).rev() {
        if is_matching_codex_event(&file_lines.lines[idx], event_type, message_text) {
            return Some(idx);
        }
    }
    None
}

fn rewrite_codex_event_message(file_lines: &mut SessionFileLines, event_line: usize, new_text: &str) -> Result<(), String> {
    let mut value = parse_line_value(file_lines, event_line)?;
    if let Some(slot) = value
        .get_mut("payload")
        .and_then(|payload| payload.get_mut("message"))
    {
        *slot = Value::String(new_text.to_string());
    }
    file_lines.lines[event_line] = serialize_line(&value)?;
    Ok(())
}

fn serialize_line(value: &Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|err| err.to_string())
}

/// Claude 删除/插入后的父链修复：所有 parentUuid 指向 `from_uuid` 的行改指 `to_parent`。
fn relink_claude_children(file_lines: &mut SessionFileLines, from_uuid: &str, to_parent: &Value) {
    for line in &mut file_lines.lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(mut value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if value.get("parentUuid").and_then(Value::as_str) != Some(from_uuid) {
            continue;
        }
        value["parentUuid"] = to_parent.clone();
        if let Ok(encoded) = serialize_line(&value) {
            *line = encoded;
        }
    }
}

/// 锚点行缺失模板字段（cwd/sessionId 等）时，从文件其他行取第一个非空值兜底。
fn claude_template_field(file_lines: &SessionFileLines, anchor: &Value, key: &str) -> Value {
    let anchor_value = anchor.get(key).cloned().unwrap_or(Value::Null);
    if !anchor_value.is_null() {
        return anchor_value;
    }
    for line in &file_lines.lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if let Some(found) = value.get(key) {
            if !found.is_null() {
                return found.clone();
            }
        }
    }
    Value::Null
}

fn build_claude_inserted_line(
    file_lines: &SessionFileLines,
    anchor: &Value,
    role: &str,
    text: &str,
    new_uuid: &str,
) -> Value {
    let content = if role == "assistant" {
        // Claude resume 要求 assistant content 为块数组（与互转写入器同口径）。
        json!([{ "type": "text", "text": text }])
    } else {
        Value::String(text.to_string())
    };
    json!({
        "parentUuid": anchor.get("uuid").cloned().unwrap_or(Value::Null),
        "isSidechain": anchor.get("isSidechain").cloned().unwrap_or(json!(false)),
        "userType": json!("external"),
        "cwd": claude_template_field(file_lines, anchor, "cwd"),
        "sessionId": claude_template_field(file_lines, anchor, "sessionId"),
        "version": anchor.get("version").cloned().unwrap_or(json!("cli-manager-edit")),
        "gitBranch": claude_template_field(file_lines, anchor, "gitBranch"),
        "type": role,
        "message": { "role": role, "content": content },
        "uuid": new_uuid,
        "timestamp": anchor
            .get("timestamp")
            .cloned()
            .unwrap_or_else(|| json!(now_rfc3339())),
    })
}

fn build_codex_inserted_lines(anchor: &Value, role: &str, text: &str) -> (Value, Value) {
    let block_type = if role == "assistant" {
        "output_text"
    } else {
        "input_text"
    };
    let timestamp = anchor
        .get("timestamp")
        .cloned()
        .unwrap_or_else(|| json!(now_rfc3339()));
    let response = json!({
        "timestamp": timestamp,
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": role,
            "content": [{ "type": block_type, "text": text }]
        }
    });
    let event = json!({
        "timestamp": timestamp,
        "type": "event_msg",
        "payload": {
            "type": codex_event_payload_type(role),
            "message": text
        }
    });
    (response, event)
}

fn backup_file_path(session_path: &Path, backups_dir: &Path) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(session_path.to_string_lossy().as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    let stem = session_path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "session".to_string());
    backups_dir.join(format!("{}__{}.jsonl.bak", &digest[..16], stem))
}

/// 首改备份：该文件的备份已存在时保持不动（还原语义 = 回到最早一次编辑前）。
fn ensure_backup(session_path: &Path, backups_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(backups_dir).map_err(|err| err.to_string())?;
    let backup = backup_file_path(session_path, backups_dir);
    if !backup.exists() {
        fs::copy(session_path, &backup).map_err(|err| err.to_string())?;
    }
    Ok(backup)
}

fn resolve_backups_dir() -> Result<PathBuf, String> {
    app_paths::history_backups_dir()
}

fn ensure_non_empty_text(text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("empty_message_text".to_string());
    }
    Ok(())
}

fn ensure_insert_role(role: &str) -> Result<(), String> {
    if role != "user" && role != "assistant" {
        return Err("invalid_insert_role".to_string());
    }
    Ok(())
}

fn finish_edit(
    file_ref: &SessionFileRef,
    before_text: Option<String>,
    after_text: Option<String>,
    backup: PathBuf,
) -> Result<HistoryEditOutcome, String> {
    invalidate_history_caches();
    let detail = build_session_detail(file_ref, false)?;
    Ok(HistoryEditOutcome {
        detail,
        before_text,
        after_text,
        backup_path: Some(backup.to_string_lossy().to_string()),
    })
}

fn update_message_in_file(
    file_ref: &SessionFileRef,
    backups_dir: &Path,
    line_index: usize,
    expected_role: &str,
    expected_text: &str,
    new_text: &str,
    expected_updated_at: i64,
) -> Result<HistoryEditOutcome, String> {
    ensure_non_empty_text(new_text)?;
    ensure_fingerprint(&file_ref.path, expected_updated_at)?;
    let mut file_lines = read_session_file_lines(&file_ref.path)?;
    let mut value = parse_line_value(&file_lines, line_index)?;
    let before_text = ensure_line_matches(&value, expected_role, expected_text)?;
    let backup = ensure_backup(&file_ref.path, backups_dir)?;

    if is_codex_message_line(&value) {
        if let Some(pair_line) =
            find_codex_event_pair(&file_lines, line_index, expected_role, &before_text)
        {
            rewrite_codex_event_message(&mut file_lines, pair_line, new_text)?;
        }
    }
    apply_text_to_line(&mut value, new_text)?;
    file_lines.lines[line_index] = serialize_line(&value)?;
    write_session_file_lines(&file_ref.path, &file_lines)?;
    finish_edit(file_ref, Some(before_text), Some(new_text.to_string()), backup)
}

fn delete_message_in_file(
    file_ref: &SessionFileRef,
    backups_dir: &Path,
    line_index: usize,
    expected_role: &str,
    expected_text: &str,
    expected_updated_at: i64,
) -> Result<HistoryEditOutcome, String> {
    ensure_fingerprint(&file_ref.path, expected_updated_at)?;
    let mut file_lines = read_session_file_lines(&file_ref.path)?;
    let value = parse_line_value(&file_lines, line_index)?;
    let before_text = ensure_line_matches(&value, expected_role, expected_text)?;
    let backup = ensure_backup(&file_ref.path, backups_dir)?;

    let mut remove_indices = vec![line_index];
    if is_codex_message_line(&value) {
        if let Some(pair_line) =
            find_codex_event_pair(&file_lines, line_index, expected_role, &before_text)
        {
            remove_indices.push(pair_line);
        }
    }
    // 由高到低移除，避免前面的删除使后面的索引失效。
    remove_indices.sort_unstable();
    for idx in remove_indices.into_iter().rev() {
        file_lines.lines.remove(idx);
    }

    if is_claude_message_line(&value) {
        if let Some(removed_uuid) = value.get("uuid").and_then(Value::as_str) {
            let new_parent = value.get("parentUuid").cloned().unwrap_or(Value::Null);
            relink_claude_children(&mut file_lines, removed_uuid, &new_parent);
        }
    }
    write_session_file_lines(&file_ref.path, &file_lines)?;
    finish_edit(file_ref, Some(before_text), None, backup)
}

fn insert_message_in_file(
    file_ref: &SessionFileRef,
    backups_dir: &Path,
    after_line_index: usize,
    role: &str,
    text: &str,
    expected_updated_at: i64,
) -> Result<HistoryEditOutcome, String> {
    ensure_insert_role(role)?;
    ensure_non_empty_text(text)?;
    ensure_fingerprint(&file_ref.path, expected_updated_at)?;
    let mut file_lines = read_session_file_lines(&file_ref.path)?;
    let anchor = parse_line_value(&file_lines, after_line_index)?;
    // 锚点必须是带规范文本的消息行：文本消息之间是回合边界，插入不会拆散 tool 配对。
    let anchor_text =
        extract_editable_text(&anchor).ok_or_else(|| "message_not_editable".to_string())?;
    let backup = ensure_backup(&file_ref.path, backups_dir)?;

    if is_claude_message_line(&anchor) {
        let anchor_uuid = anchor
            .get("uuid")
            .and_then(Value::as_str)
            .ok_or_else(|| "message_not_editable".to_string())?
            .to_string();
        let new_uuid = Uuid::new_v4().to_string();
        let inserted = build_claude_inserted_line(&file_lines, &anchor, role, text, &new_uuid);
        // 先把锚点的既有子链接管到新消息，再插入新行（新行自身不受重链影响）。
        relink_claude_children(&mut file_lines, &anchor_uuid, &json!(new_uuid.clone()));
        file_lines
            .lines
            .insert(after_line_index + 1, serialize_line(&inserted)?);
    } else if is_codex_message_line(&anchor) {
        let anchor_role = anchor
            .get("payload")
            .and_then(|payload| payload.get("role"))
            .and_then(Value::as_str)
            .unwrap_or("user");
        // 落点跳过锚点自身的 TUI 配对行，避免插进 response_item 与 event_msg 之间。
        let mut insert_at = after_line_index + 1;
        if let Some(pair_line) =
            find_codex_event_pair(&file_lines, after_line_index, anchor_role, &anchor_text)
        {
            if pair_line > after_line_index {
                insert_at = pair_line + 1;
            }
        }
        let (response, event) = build_codex_inserted_lines(&anchor, role, text);
        file_lines.lines.insert(insert_at, serialize_line(&event)?);
        file_lines
            .lines
            .insert(insert_at, serialize_line(&response)?);
    } else {
        return Err("message_not_editable".to_string());
    }

    write_session_file_lines(&file_ref.path, &file_lines)?;
    finish_edit(file_ref, None, Some(text.to_string()), backup)
}

fn restore_backup_for_file(
    file_ref: &SessionFileRef,
    backups_dir: &Path,
) -> Result<HistoryEditOutcome, String> {
    let backup = backup_file_path(&file_ref.path, backups_dir);
    if !backup.exists() {
        return Err("backup_not_found".to_string());
    }
    let content = fs::read(&backup).map_err(|err| err.to_string())?;
    let tmp = file_ref.path.with_extension("jsonl.cli-manager-tmp");
    fs::write(&tmp, &content).map_err(|err| err.to_string())?;
    fs::rename(&tmp, &file_ref.path).map_err(|err| {
        let _ = fs::remove_file(&tmp);
        err.to_string()
    })?;
    finish_edit(file_ref, None, None, backup)
}

fn backup_status_for_file(file_ref: &SessionFileRef, backups_dir: &Path) -> HistoryBackupStatus {
    let backup = backup_file_path(&file_ref.path, backups_dir);
    if !backup.exists() {
        return HistoryBackupStatus {
            has_backup: false,
            backup_path: None,
            backup_at: None,
        };
    }
    let backup_at = fs::metadata(&backup)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);
    HistoryBackupStatus {
        has_backup: true,
        backup_path: Some(backup.to_string_lossy().to_string()),
        backup_at,
    }
}

fn validated_file_ref(
    file_path: &str,
    claude_config_dir: Option<String>,
    codex_config_dir: Option<String>,
    source: &str,
    project_key: &str,
) -> Result<SessionFileRef, String> {
    let roots = history_roots(claude_config_dir, codex_config_dir);
    validate_session_file_ref(file_path, source, project_key, &roots)
}

#[tauri::command]
pub async fn history_update_message(
    file_path: String,
    claude_config_dir: Option<String>,
    codex_config_dir: Option<String>,
    source: String,
    project_key: String,
    line_index: usize,
    expected_role: String,
    expected_text: String,
    new_text: String,
    expected_updated_at: i64,
) -> Result<HistoryEditOutcome, String> {
    tokio::task::spawn_blocking(move || {
        let file_ref = validated_file_ref(
            &file_path,
            claude_config_dir,
            codex_config_dir,
            &source,
            &project_key,
        )?;
        let backups_dir = resolve_backups_dir()?;
        update_message_in_file(
            &file_ref,
            &backups_dir,
            line_index,
            &expected_role,
            &expected_text,
            &new_text,
            expected_updated_at,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn history_delete_message(
    file_path: String,
    claude_config_dir: Option<String>,
    codex_config_dir: Option<String>,
    source: String,
    project_key: String,
    line_index: usize,
    expected_role: String,
    expected_text: String,
    expected_updated_at: i64,
) -> Result<HistoryEditOutcome, String> {
    tokio::task::spawn_blocking(move || {
        let file_ref = validated_file_ref(
            &file_path,
            claude_config_dir,
            codex_config_dir,
            &source,
            &project_key,
        )?;
        let backups_dir = resolve_backups_dir()?;
        delete_message_in_file(
            &file_ref,
            &backups_dir,
            line_index,
            &expected_role,
            &expected_text,
            expected_updated_at,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn history_insert_message(
    file_path: String,
    claude_config_dir: Option<String>,
    codex_config_dir: Option<String>,
    source: String,
    project_key: String,
    after_line_index: usize,
    role: String,
    text: String,
    expected_updated_at: i64,
) -> Result<HistoryEditOutcome, String> {
    tokio::task::spawn_blocking(move || {
        let file_ref = validated_file_ref(
            &file_path,
            claude_config_dir,
            codex_config_dir,
            &source,
            &project_key,
        )?;
        let backups_dir = resolve_backups_dir()?;
        insert_message_in_file(
            &file_ref,
            &backups_dir,
            after_line_index,
            &role,
            &text,
            expected_updated_at,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn history_restore_session_backup(
    file_path: String,
    claude_config_dir: Option<String>,
    codex_config_dir: Option<String>,
    source: String,
    project_key: String,
) -> Result<HistoryEditOutcome, String> {
    tokio::task::spawn_blocking(move || {
        let file_ref = validated_file_ref(
            &file_path,
            claude_config_dir,
            codex_config_dir,
            &source,
            &project_key,
        )?;
        let backups_dir = resolve_backups_dir()?;
        restore_backup_for_file(&file_ref, &backups_dir)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn history_get_backup_status(
    file_path: String,
    claude_config_dir: Option<String>,
    codex_config_dir: Option<String>,
    source: String,
    project_key: String,
) -> Result<HistoryBackupStatus, String> {
    tokio::task::spawn_blocking(move || {
        let file_ref = validated_file_ref(
            &file_path,
            claude_config_dir,
            codex_config_dir,
            &source,
            &project_key,
        )?;
        let backups_dir = resolve_backups_dir()?;
        Ok(backup_status_for_file(&file_ref, &backups_dir))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_text(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    fn file_ref(path: &Path, source: &str) -> SessionFileRef {
        SessionFileRef {
            source: source.to_string(),
            project_key: "CLI-Manager".to_string(),
            path: path.to_path_buf(),
        }
    }

    fn fingerprint_updated_at(path: &Path) -> i64 {
        session_file_fingerprint(path).updated_at
    }

    fn claude_fixture() -> String {
        [
            r#"{"type":"summary","summary":"noise"}"#,
            r#"{"parentUuid":null,"type":"user","uuid":"u1","cwd":"D:\\work","sessionId":"s1","timestamp":"2026-07-01T00:00:00Z","message":{"role":"user","content":"question one"}}"#,
            r#"{"parentUuid":"u1","type":"assistant","uuid":"a1","timestamp":"2026-07-01T00:00:01Z","message":{"role":"assistant","content":[{"type":"text","text":"answer one"}]}}"#,
            r#"{"parentUuid":"a1","type":"user","uuid":"u2","timestamp":"2026-07-01T00:00:02Z","message":{"role":"user","content":"question two"}}"#,
        ]
        .join("\n")
            + "\n"
    }

    fn codex_fixture() -> String {
        [
            r#"{"type":"session_meta","payload":{"id":"s1","cwd":"D:\\work"}}"#,
            r#"{"type":"response_item","timestamp":"2026-07-01T00:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"question one"}]}}"#,
            r#"{"type":"event_msg","timestamp":"2026-07-01T00:00:00Z","payload":{"type":"user_message","message":"question one"}}"#,
            r#"{"type":"response_item","timestamp":"2026-07-01T00:00:01Z","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"answer one"}]}}"#,
            r#"{"type":"event_msg","timestamp":"2026-07-01T00:00:01Z","payload":{"type":"agent_message","message":"answer one"}}"#,
        ]
        .join("\n")
            + "\n"
    }

    fn read_lines(path: &Path) -> Vec<Value> {
        std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn update_claude_string_content_and_keep_other_lines() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("session.jsonl");
        let backups = temp.path().join("backups");
        write_text(&session, &claude_fixture());
        let updated_at = fingerprint_updated_at(&session);

        let outcome = update_message_in_file(
            &file_ref(&session, "claude"),
            &backups,
            1,
            "user",
            "question one",
            "edited question",
            updated_at,
        )
        .unwrap();

        assert_eq!(outcome.before_text.as_deref(), Some("question one"));
        assert_eq!(outcome.after_text.as_deref(), Some("edited question"));
        let lines = read_lines(&session);
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[1]["message"]["content"], json!("edited question"));
        // 其他行原样保留
        assert_eq!(lines[1]["uuid"], json!("u1"));
        assert_eq!(lines[2]["message"]["content"][0]["text"], json!("answer one"));
        // detail 反映新文本
        assert!(outcome
            .detail
            .messages
            .iter()
            .any(|message| message.content == "edited question"));
    }

    #[test]
    fn update_claude_block_content_preserves_non_text_blocks() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("session.jsonl");
        let backups = temp.path().join("backups");
        write_text(
            &session,
            concat!(
                r#"{"type":"user","uuid":"u1","message":{"role":"user","content":[{"type":"text","text":"before"},{"type":"image","source":{"type":"base64"}},{"type":"text","text":"tail"}]}}"#,
                "\n",
            ),
        );
        let updated_at = fingerprint_updated_at(&session);

        update_message_in_file(
            &file_ref(&session, "claude"),
            &backups,
            0,
            "user",
            "before\n\ntail",
            "rewritten",
            updated_at,
        )
        .unwrap();

        let lines = read_lines(&session);
        let blocks = lines[0]["message"]["content"].as_array().unwrap();
        // 首个 text 块替换、多余 text 块删除、image 块保留
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], json!("text"));
        assert_eq!(blocks[0]["text"], json!("rewritten"));
        assert_eq!(blocks[1]["type"], json!("image"));
    }

    #[test]
    fn update_codex_message_syncs_event_pair() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("rollout-session.jsonl");
        let backups = temp.path().join("backups");
        write_text(&session, &codex_fixture());
        let updated_at = fingerprint_updated_at(&session);

        update_message_in_file(
            &file_ref(&session, "codex"),
            &backups,
            3,
            "assistant",
            "answer one",
            "fixed answer",
            updated_at,
        )
        .unwrap();

        let lines = read_lines(&session);
        assert_eq!(
            lines[3]["payload"]["content"][0]["text"],
            json!("fixed answer")
        );
        // TUI 重放行同步更新
        assert_eq!(lines[4]["payload"]["message"], json!("fixed answer"));
        // 用户消息行不受影响
        assert_eq!(lines[2]["payload"]["message"], json!("question one"));
    }

    #[test]
    fn delete_claude_message_relinks_parent_chain() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("session.jsonl");
        let backups = temp.path().join("backups");
        write_text(&session, &claude_fixture());
        let updated_at = fingerprint_updated_at(&session);

        delete_message_in_file(
            &file_ref(&session, "claude"),
            &backups,
            2,
            "assistant",
            "answer one",
            updated_at,
        )
        .unwrap();

        let lines = read_lines(&session);
        assert_eq!(lines.len(), 3);
        // u2 原本挂在 a1 下，删除 a1 后重链到 a1 的父节点 u1
        let u2 = lines
            .iter()
            .find(|line| line["uuid"] == json!("u2"))
            .unwrap();
        assert_eq!(u2["parentUuid"], json!("u1"));
    }

    #[test]
    fn delete_codex_message_removes_event_pair() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("rollout-session.jsonl");
        let backups = temp.path().join("backups");
        write_text(&session, &codex_fixture());
        let updated_at = fingerprint_updated_at(&session);

        delete_message_in_file(
            &file_ref(&session, "codex"),
            &backups,
            1,
            "user",
            "question one",
            updated_at,
        )
        .unwrap();

        let lines = read_lines(&session);
        assert_eq!(lines.len(), 3);
        assert!(lines.iter().all(|line| {
            line["payload"]["message"] != json!("question one")
                && line["payload"]["content"][0]["text"] != json!("question one")
        }));
    }

    #[test]
    fn insert_claude_message_links_uuid_chain() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("session.jsonl");
        let backups = temp.path().join("backups");
        write_text(&session, &claude_fixture());
        let updated_at = fingerprint_updated_at(&session);

        insert_message_in_file(
            &file_ref(&session, "claude"),
            &backups,
            2,
            "user",
            "injected context",
            updated_at,
        )
        .unwrap();

        let lines = read_lines(&session);
        assert_eq!(lines.len(), 5);
        let inserted = &lines[3];
        assert_eq!(inserted["message"]["content"], json!("injected context"));
        assert_eq!(inserted["parentUuid"], json!("a1"));
        assert_eq!(inserted["sessionId"], json!("s1"));
        let new_uuid = inserted["uuid"].as_str().unwrap().to_string();
        // 原 a1 的子节点 u2 重链到新消息
        let u2 = lines
            .iter()
            .find(|line| line["uuid"] == json!("u2"))
            .unwrap();
        assert_eq!(u2["parentUuid"], json!(new_uuid));
    }

    #[test]
    fn insert_codex_message_writes_response_and_event_pair_after_anchor_pair() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("rollout-session.jsonl");
        let backups = temp.path().join("backups");
        write_text(&session, &codex_fixture());
        let updated_at = fingerprint_updated_at(&session);

        insert_message_in_file(
            &file_ref(&session, "codex"),
            &backups,
            1,
            "user",
            "injected context",
            updated_at,
        )
        .unwrap();

        let lines = read_lines(&session);
        assert_eq!(lines.len(), 7);
        // 落点在锚点的 event_msg 配对行之后：session_meta, q1 pair, 新增 pair, answer pair
        assert_eq!(
            lines[3]["payload"]["content"][0]["text"],
            json!("injected context")
        );
        assert_eq!(lines[3]["payload"]["role"], json!("user"));
        assert_eq!(lines[4]["payload"]["type"], json!("user_message"));
        assert_eq!(lines[4]["payload"]["message"], json!("injected context"));
        assert_eq!(
            lines[5]["payload"]["content"][0]["text"],
            json!("answer one")
        );
    }

    #[test]
    fn stale_fingerprint_rejects_write() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("session.jsonl");
        let backups = temp.path().join("backups");
        write_text(&session, &claude_fixture());

        let err = update_message_in_file(
            &file_ref(&session, "claude"),
            &backups,
            1,
            "user",
            "question one",
            "edited",
            fingerprint_updated_at(&session) + 1,
        )
        .err().unwrap();

        assert_eq!(err, "history_file_changed");
        // 文件未被改动
        assert_eq!(std::fs::read_to_string(&session).unwrap(), claude_fixture());
    }

    #[test]
    fn line_conflict_and_non_editable_lines_reject_write() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("session.jsonl");
        let backups = temp.path().join("backups");
        write_text(&session, &claude_fixture());
        let updated_at = fingerprint_updated_at(&session);

        // 行内容与期望不符
        let conflict = update_message_in_file(
            &file_ref(&session, "claude"),
            &backups,
            1,
            "user",
            "totally different",
            "edited",
            updated_at,
        )
        .err().unwrap();
        assert_eq!(conflict, "history_line_conflict");

        // 非消息行不可编辑
        let not_editable = update_message_in_file(
            &file_ref(&session, "claude"),
            &backups,
            0,
            "user",
            "noise",
            "edited",
            updated_at,
        )
        .err().unwrap();
        assert_eq!(not_editable, "history_line_conflict");
    }

    #[test]
    fn backup_created_once_and_restore_recovers_original() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("session.jsonl");
        let backups = temp.path().join("backups");
        write_text(&session, &claude_fixture());

        let first = update_message_in_file(
            &file_ref(&session, "claude"),
            &backups,
            1,
            "user",
            "question one",
            "first edit",
            fingerprint_updated_at(&session),
        )
        .unwrap();
        let backup_path = PathBuf::from(first.backup_path.clone().unwrap());
        assert!(backup_path.exists());
        let backup_content = std::fs::read_to_string(&backup_path).unwrap();
        assert_eq!(backup_content, claude_fixture());

        // 第二次编辑不覆盖既有备份
        update_message_in_file(
            &file_ref(&session, "claude"),
            &backups,
            1,
            "user",
            "first edit",
            "second edit",
            fingerprint_updated_at(&session),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(&backup_path).unwrap(),
            claude_fixture()
        );

        // 还原回最初内容
        restore_backup_for_file(&file_ref(&session, "claude"), &backups).unwrap();
        assert_eq!(std::fs::read_to_string(&session).unwrap(), claude_fixture());

        let status = backup_status_for_file(&file_ref(&session, "claude"), &backups);
        assert!(status.has_backup);
        assert!(status.backup_at.is_some());
    }

    #[test]
    fn empty_text_and_invalid_role_are_rejected() {
        let temp = TempDir::new().unwrap();
        let session = temp.path().join("session.jsonl");
        let backups = temp.path().join("backups");
        write_text(&session, &claude_fixture());
        let updated_at = fingerprint_updated_at(&session);
        let session_ref = file_ref(&session, "claude");

        assert_eq!(
            update_message_in_file(&session_ref, &backups, 1, "user", "question one", "  ", updated_at)
                .err().unwrap(),
            "empty_message_text"
        );
        assert_eq!(
            insert_message_in_file(&session_ref, &backups, 1, "system", "text", updated_at)
                .err().unwrap(),
            "invalid_insert_role"
        );
    }
}
