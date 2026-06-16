use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Row, SqliteConnection};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// env key 中出现这些子串即视为机密，值只返回掩码。
const SECRET_KEY_MARKERS: [&str; 5] = ["token", "key", "secret", "auth", "password"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchProvider {
    id: String,
    app_type: String,
    name: String,
    category: Option<String>,
    website_url: Option<String>,
    notes: Option<String>,
    sort_index: Option<i64>,
    created_at: Option<i64>,
    is_current: bool,
    base_url: Option<String>,
    model: Option<String>,
    api_format: Option<String>,
    masked_env: BTreeMap<String, String>,
    config_parse_error: bool,
    /// Raw settings_config JSON text (for display only, not for actual application)
    raw_settings_config: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchProvidersResponse {
    db_path: String,
    providers: Vec<CcSwitchProvider>,
}

pub(crate) fn is_secret_env_key(key: &str) -> bool {
    let lower = key.to_lowercase();
    SECRET_KEY_MARKERS.iter().any(|marker| lower.contains(marker))
}

pub(crate) fn mask_secret(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() > 12 {
        let head: String = chars[..4].iter().collect();
        let tail: String = chars[chars.len() - 4..].iter().collect();
        format!("{head}…{tail}")
    } else {
        "***".to_string()
    }
}

fn env_value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

struct ParsedConfig {
    base_url: Option<String>,
    model: Option<String>,
    masked_env: BTreeMap<String, String>,
}

fn parse_settings_config(raw: &str) -> Option<ParsedConfig> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let mut parsed = ParsedConfig {
        base_url: None,
        model: None,
        masked_env: BTreeMap::new(),
    };
    if let Some(env) = value.get("env").and_then(Value::as_object) {
        for (key, raw_value) in env {
            let text = env_value_text(raw_value);

            // Generic pattern matching: *_BASE_URL / *_API_BASE / *_ENDPOINT
            if key.ends_with("_BASE_URL") || key.ends_with("_API_BASE") || key.ends_with("_ENDPOINT") {
                parsed.base_url = Some(text.clone());
            }
            // Generic pattern matching: *_MODEL
            else if key.ends_with("_MODEL") {
                parsed.model = Some(text.clone());
            }

            let display = if is_secret_env_key(key) {
                mask_secret(&text)
            } else {
                text
            };
            parsed.masked_env.insert(key.clone(), display);
        }
    }
    Some(parsed)
}

fn parse_api_format(meta: &str) -> Option<String> {
    let value: Value = serde_json::from_str(meta).ok()?;
    value
        .get("apiFormat")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn resolve_db_path(app: &tauri::AppHandle, db_path: Option<String>) -> Result<PathBuf, String> {
    let custom = db_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    let path = match custom {
        Some(custom) => PathBuf::from(custom),
        None => app
            .path()
            .home_dir()
            .map_err(|err| format!("home_dir_unavailable: {err}"))?
            .join(".cc-switch")
            .join("cc-switch.db"),
    };
    if path.extension().and_then(|ext| ext.to_str()) != Some("db") {
        return Err("unsupported_format".to_string());
    }
    if !path.is_file() {
        return Err("db_not_found".to_string());
    }
    Ok(path)
}

async fn open_db_readonly(path: &Path) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true);
    SqliteConnection::connect_with(&options)
        .await
        .map_err(|err| format!("db_open_failed: {err}"))
}

fn provider_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<CcSwitchProvider, String> {
    let map_err = |err: sqlx::Error| format!("db_query_failed: {err}");
    let settings_config: String = row.try_get("settings_config").map_err(map_err)?;
    let meta: String = row.try_get("meta").map_err(map_err)?;

    let parsed = parse_settings_config(&settings_config);
    let config_parse_error = parsed.is_none();
    let parsed = parsed.unwrap_or(ParsedConfig {
        base_url: None,
        model: None,
        masked_env: BTreeMap::new(),
    });

    Ok(CcSwitchProvider {
        id: row.try_get("id").map_err(map_err)?,
        app_type: row.try_get("app_type").map_err(map_err)?,
        name: row.try_get("name").map_err(map_err)?,
        category: row.try_get("category").map_err(map_err)?,
        website_url: row.try_get("website_url").map_err(map_err)?,
        notes: row.try_get("notes").map_err(map_err)?,
        sort_index: row.try_get("sort_index").map_err(map_err)?,
        created_at: row.try_get("created_at").map_err(map_err)?,
        is_current: row.try_get("is_current").map_err(map_err)?,
        base_url: parsed.base_url,
        model: parsed.model,
        api_format: parse_api_format(&meta),
        masked_env: parsed.masked_env,
        config_parse_error,
        raw_settings_config: settings_config,
    })
}

#[tauri::command]
pub async fn ccswitch_list_providers(
    app: tauri::AppHandle,
    db_path: Option<String>,
) -> Result<CcSwitchProvidersResponse, String> {
    let path = resolve_db_path(&app, db_path)?;

    let mut conn = open_db_readonly(&path).await?;

    let rows = sqlx::query(
        "SELECT id, app_type, name, settings_config, website_url, category, notes, \
         sort_index, created_at, is_current, meta \
         FROM providers ORDER BY app_type, sort_index, name",
    )
    .fetch_all(&mut conn)
    .await
    .map_err(|err| format!("db_query_failed: {err}"))?;

    let providers = rows
        .iter()
        .map(provider_from_row)
        .collect::<Result<Vec<_>, _>>()?;

    let _ = conn.close().await;

    Ok(CcSwitchProvidersResponse {
        db_path: path.to_string_lossy().into_owned(),
        providers,
    })
}

// ---------- Phase 2：按项目切换供应商 ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchProjectProvider {
    matched_provider_id: Option<String>,
    has_settings_file: bool,
    base_url: Option<String>,
    /// settings.local.json env 中 ANTHROPIC_ 前缀的 key 名（只含 key 名，不含值）。
    local_override_keys: Vec<String>,
}

fn env_object(value: &Value) -> Option<&Map<String, Value>> {
    value.get("env").and_then(Value::as_object)
}

fn env_text(env: &Map<String, Value>, key: &str) -> Option<String> {
    env.get(key).map(env_value_text)
}

/// 纯函数：从 settings.local.json 文本提取 env 中 `ANTHROPIC_` 前缀的 key 名。
/// 只返回 key 名（不含值，避免泄密）；损坏 JSON / 顶层非对象 / 无 env → 空数组。
pub(crate) fn anthropic_env_keys(raw: &str) -> Vec<String> {
    let parsed: Option<Value> = serde_json::from_str(raw).ok();
    parsed
        .as_ref()
        .and_then(env_object)
        .map(|env| {
            env.keys()
                .filter(|key| key.starts_with("ANTHROPIC_"))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// 项目 settings.json 的 env 与 provider env 匹配规则：
/// ANTHROPIC_BASE_URL 相等，且 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY 相等。
pub(crate) fn provider_matches_project_env(
    project_env: &Map<String, Value>,
    provider_env: &Map<String, Value>,
) -> bool {
    let same = |key: &str| match (env_text(project_env, key), env_text(provider_env, key)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    };
    same("ANTHROPIC_BASE_URL") && (same("ANTHROPIC_AUTH_TOKEN") || same("ANTHROPIC_API_KEY"))
}

/// env 替换规则：先移除现有 env 中所有 `ANTHROPIC_` 前缀 key（清掉上一家供应商遗留），
/// 再把 provider env 全量覆盖写入；env 之外的顶层字段保持原样。
/// 现有 env 缺失或不是对象时按空对象处理。
pub(crate) fn replace_anthropic_env(
    settings: &mut Map<String, Value>,
    provider_env: &Map<String, Value>,
) {
    let env_entry = settings
        .entry("env".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !env_entry.is_object() {
        *env_entry = Value::Object(Map::new());
    }
    let env = env_entry.as_object_mut().expect("env entry is an object");
    env.retain(|key, _| !key.starts_with("ANTHROPIC_"));
    for (key, value) in provider_env {
        env.insert(key.clone(), value.clone());
    }
}

/// 纯函数：输入现有 settings.json 文本（None 表示文件不存在）与 provider env，
/// 返回写盘用的新文本。损坏 JSON / 顶层非对象 → `settings_parse_failed`。
pub(crate) fn merge_settings_text(
    existing: Option<&str>,
    provider_env: &Map<String, Value>,
) -> Result<String, String> {
    let mut settings: Value = match existing {
        Some(raw) => {
            serde_json::from_str(raw).map_err(|_| "settings_parse_failed".to_string())?
        }
        None => Value::Object(Map::new()),
    };
    let settings_obj = settings
        .as_object_mut()
        .ok_or_else(|| "settings_parse_failed".to_string())?;
    replace_anthropic_env(settings_obj, provider_env);
    let mut text = serde_json::to_string_pretty(&settings)
        .map_err(|err| format!("settings_write_failed: {err}"))?;
    text.push('\n');
    Ok(text)
}

#[tauri::command]
pub async fn ccswitch_get_project_provider(
    app: tauri::AppHandle,
    project_path: String,
    db_path: Option<String>,
) -> Result<CcSwitchProjectProvider, String> {
    let project_dir = PathBuf::from(project_path.trim());
    if !project_dir.is_dir() {
        return Err("project_not_found".to_string());
    }
    let settings_path = project_dir.join(".claude").join("settings.json");
    let has_settings_file = settings_path.is_file();

    // 读取失败/损坏 JSON 不报错：视为无 env，可由后续切换覆盖修复。
    let parsed_settings: Option<Value> = if has_settings_file {
        fs::read_to_string(&settings_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
    } else {
        None
    };
    let project_env: Map<String, Value> = parsed_settings
        .as_ref()
        .and_then(env_object)
        .cloned()
        .unwrap_or_default();
    let base_url = env_text(&project_env, "ANTHROPIC_BASE_URL");

    // settings.local.json 优先级高于 settings.json，提取其中 ANTHROPIC_ key 名用于前端冲突提示。
    // 文件不存在/损坏 → 空数组，容错不报错。
    let local_settings_path = project_dir.join(".claude").join("settings.local.json");
    let local_override_keys = fs::read_to_string(&local_settings_path)
        .map(|raw| anthropic_env_keys(&raw))
        .unwrap_or_default();

    let mut matched_provider_id = None;
    if !project_env.is_empty() {
        let path = resolve_db_path(&app, db_path)?;
        let mut conn = open_db_readonly(&path).await?;
        let rows = sqlx::query(
            "SELECT id, settings_config FROM providers \
             WHERE app_type = 'claude' ORDER BY sort_index, name",
        )
        .fetch_all(&mut conn)
        .await
        .map_err(|err| format!("db_query_failed: {err}"))?;
        let _ = conn.close().await;

        for row in &rows {
            let map_err = |err: sqlx::Error| format!("db_query_failed: {err}");
            let id: String = row.try_get("id").map_err(map_err)?;
            let settings_config: String = row.try_get("settings_config").map_err(map_err)?;
            let parsed: Option<Value> = serde_json::from_str(&settings_config).ok();
            let Some(provider_env) = parsed.as_ref().and_then(env_object) else {
                continue;
            };
            if provider_matches_project_env(&project_env, provider_env) {
                matched_provider_id = Some(id);
                break;
            }
        }
    }

    Ok(CcSwitchProjectProvider {
        matched_provider_id,
        has_settings_file,
        base_url,
        local_override_keys,
    })
}

#[tauri::command]
pub async fn ccswitch_apply_provider(
    app: tauri::AppHandle,
    project_path: String,
    provider_id: String,
    db_path: Option<String>,
) -> Result<(), String> {
    let project_dir = PathBuf::from(project_path.trim());
    if !project_dir.is_dir() {
        return Err("project_not_found".to_string());
    }

    let path = resolve_db_path(&app, db_path)?;
    let mut conn = open_db_readonly(&path).await?;
    let row = sqlx::query(
        "SELECT settings_config FROM providers WHERE id = ?1 AND app_type = 'claude'",
    )
    .bind(provider_id.trim())
    .fetch_optional(&mut conn)
    .await
    .map_err(|err| format!("db_query_failed: {err}"))?;
    let _ = conn.close().await;

    let row = row.ok_or_else(|| "provider_not_found".to_string())?;
    let settings_config: String = row
        .try_get("settings_config")
        .map_err(|err| format!("db_query_failed: {err}"))?;
    let parsed: Option<Value> = serde_json::from_str(&settings_config).ok();
    let provider_env = parsed
        .as_ref()
        .and_then(env_object)
        .ok_or_else(|| "provider_config_invalid".to_string())?;

    let claude_dir = project_dir.join(".claude");
    let settings_path = claude_dir.join("settings.json");
    let existing = if settings_path.is_file() {
        Some(
            fs::read_to_string(&settings_path)
                .map_err(|err| format!("settings_read_failed: {err}"))?,
        )
    } else {
        None
    };
    let next_text = merge_settings_text(existing.as_deref(), provider_env)?;
    atomic_write_settings(&claude_dir, &settings_path, &next_text)
}

/// 原子写：同目录临时文件 + rename 覆盖，避免写一半留下损坏文件。
fn atomic_write_settings(
    claude_dir: &Path,
    settings_path: &Path,
    text: &str,
) -> Result<(), String> {
    fs::create_dir_all(claude_dir).map_err(|err| format!("settings_write_failed: {err}"))?;
    let tmp_path = claude_dir.join("settings.json.tmp");
    fs::write(&tmp_path, text).map_err(|err| format!("settings_write_failed: {err}"))?;
    if let Err(err) = fs::rename(&tmp_path, settings_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("settings_write_failed: {err}"));
    }
    Ok(())
}

// ---------- Phase 3：恢复全局 + 项目树徽标 ----------

/// 纯函数：删除 settings.json 文本中顶层 `env` 字段（整段删除）。
/// 返回 `Ok(None)` 表示删除后顶层为空对象，调用方应删除文件本身；
/// `Ok(Some(text))` 为应原子写回的新文本。
/// 损坏 JSON / 顶层非对象 → `settings_parse_failed`。
pub(crate) fn strip_env_section(existing: &str) -> Result<Option<String>, String> {
    let mut settings: Value =
        serde_json::from_str(existing).map_err(|_| "settings_parse_failed".to_string())?;
    let settings_obj = settings
        .as_object_mut()
        .ok_or_else(|| "settings_parse_failed".to_string())?;
    settings_obj.remove("env");
    if settings_obj.is_empty() {
        return Ok(None);
    }
    let mut text = serde_json::to_string_pretty(&settings)
        .map_err(|err| format!("settings_write_failed: {err}"))?;
    text.push('\n');
    Ok(Some(text))
}

/// 恢复全局的文件操作部分（project_dir 已校验存在）：
/// settings.json 不存在 → no-op 成功；删 env 后为空 `{}` → 删除文件（`.claude/` 目录保留）。
fn reset_settings_file(project_dir: &Path) -> Result<(), String> {
    let claude_dir = project_dir.join(".claude");
    let settings_path = claude_dir.join("settings.json");
    if !settings_path.is_file() {
        return Ok(());
    }
    let existing = fs::read_to_string(&settings_path)
        .map_err(|err| format!("settings_read_failed: {err}"))?;
    match strip_env_section(&existing)? {
        None => fs::remove_file(&settings_path)
            .map_err(|err| format!("settings_write_failed: {err}")),
        Some(next_text) => atomic_write_settings(&claude_dir, &settings_path, &next_text),
    }
}

#[tauri::command]
pub async fn ccswitch_reset_project_provider(project_path: String) -> Result<(), String> {
    let project_dir = PathBuf::from(project_path.trim());
    if !project_dir.is_dir() {
        return Err("project_not_found".to_string());
    }
    reset_settings_file(&project_dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchProjectBadge {
    path: String,
    has_override: bool,
    provider_name: Option<String>,
}

/// 纯函数：探测单个项目 settings.json 文本的供应商覆盖状态。
/// 文本缺失/损坏/env 无 ANTHROPIC_BASE_URL → (false, None)，单项容错不让整批失败；
/// 有覆盖但匹配不到供应商 → (true, None)（前端显示"自定义"）。
pub(crate) fn probe_settings_text(
    raw: Option<&str>,
    providers: &[(String, Map<String, Value>)],
) -> (bool, Option<String>) {
    let Some(raw) = raw else {
        return (false, None);
    };
    let parsed: Option<Value> = serde_json::from_str(raw).ok();
    let Some(project_env) = parsed.as_ref().and_then(env_object) else {
        return (false, None);
    };
    if env_text(project_env, "ANTHROPIC_BASE_URL").is_none() {
        return (false, None);
    }
    let provider_name = providers
        .iter()
        .find(|(_, provider_env)| provider_matches_project_env(project_env, provider_env))
        .map(|(name, _)| name.clone());
    (true, provider_name)
}

#[tauri::command]
pub async fn ccswitch_probe_projects(
    app: tauri::AppHandle,
    project_paths: Vec<String>,
    db_path: Option<String>,
) -> Result<Vec<CcSwitchProjectBadge>, String> {
    let path = resolve_db_path(&app, db_path)?;
    let mut conn = open_db_readonly(&path).await?;
    let rows = sqlx::query(
        "SELECT name, settings_config FROM providers \
         WHERE app_type = 'claude' ORDER BY sort_index, name",
    )
    .fetch_all(&mut conn)
    .await
    .map_err(|err| format!("db_query_failed: {err}"))?;
    let _ = conn.close().await;

    let mut providers: Vec<(String, Map<String, Value>)> = Vec::new();
    for row in &rows {
        let map_err = |err: sqlx::Error| format!("db_query_failed: {err}");
        let name: String = row.try_get("name").map_err(map_err)?;
        let settings_config: String = row.try_get("settings_config").map_err(map_err)?;
        let parsed: Option<Value> = serde_json::from_str(&settings_config).ok();
        if let Some(provider_env) = parsed.as_ref().and_then(env_object) {
            providers.push((name, provider_env.clone()));
        }
    }

    let badges = project_paths
        .into_iter()
        .map(|project_path| {
            let settings_path = PathBuf::from(project_path.trim())
                .join(".claude")
                .join("settings.json");
            let raw = fs::read_to_string(&settings_path).ok();
            let (has_override, provider_name) = probe_settings_text(raw.as_deref(), &providers);
            CcSwitchProjectBadge {
                path: project_path,
                has_override,
                provider_name,
            }
        })
        .collect();

    Ok(badges)
}

// ---------- Phase 4: Config Snippets ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchConfigSnippet {
    id: String,
    name: String,
    description: Option<String>,
    config_json: String,
    created_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchConfigSnippetsResponse {
    db_path: String,
    snippets: Vec<CcSwitchConfigSnippet>,
}

#[tauri::command]
pub async fn ccswitch_list_config_snippets(
    app: tauri::AppHandle,
    db_path: Option<String>,
) -> Result<CcSwitchConfigSnippetsResponse, String> {
    let path = resolve_db_path(&app, db_path)?;
    let mut conn = open_db_readonly(&path).await?;

    // Error tolerance: check if table exists first
    let table_exists = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='config_snippets'"
    )
    .fetch_optional(&mut conn)
    .await
    .map_err(|err| format!("db_query_failed: {err}"))?
    .is_some();

    if !table_exists {
        // Table doesn't exist, return empty list
        let _ = conn.close().await;
        return Ok(CcSwitchConfigSnippetsResponse {
            db_path: path.to_string_lossy().into_owned(),
            snippets: Vec::new(),
        });
    }

    let rows = sqlx::query(
        "SELECT id, name, description, config_json, created_at \
         FROM config_snippets ORDER BY name",
    )
    .fetch_all(&mut conn)
    .await
    .map_err(|err| format!("db_query_failed: {err}"))?;

    let snippets = rows
        .iter()
        .map(|row| -> Result<CcSwitchConfigSnippet, String> {
            let map_err = |err: sqlx::Error| format!("db_query_failed: {err}");
            Ok(CcSwitchConfigSnippet {
                id: row.try_get("id").map_err(map_err)?,
                name: row.try_get("name").map_err(map_err)?,
                description: row.try_get("description").map_err(map_err)?,
                config_json: row.try_get("config_json").map_err(map_err)?,
                created_at: row.try_get("created_at").map_err(map_err)?,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    let _ = conn.close().await;

    Ok(CcSwitchConfigSnippetsResponse {
        db_path: path.to_string_lossy().into_owned(),
        snippets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_key_detection_matches_known_keys() {
        assert!(is_secret_env_key("ANTHROPIC_AUTH_TOKEN"));
        assert!(is_secret_env_key("ANTHROPIC_API_KEY"));
        assert!(is_secret_env_key("MY_SECRET"));
        assert!(!is_secret_env_key("ANTHROPIC_BASE_URL"));
        assert!(!is_secret_env_key("ANTHROPIC_MODEL"));
        assert!(!is_secret_env_key("ANTHROPIC_DEFAULT_HAIKU_MODEL"));
    }

    #[test]
    fn mask_secret_keeps_only_edges() {
        let masked = mask_secret("sk-abcdefghijklmnopqrstuvwxyz");
        assert_eq!(masked, "sk-a…wxyz");
        assert!(!masked.contains("bcdefghijklmnopqrstuv"));
        assert_eq!(mask_secret("short"), "***");
        assert_eq!(mask_secret(""), "***");
    }

    #[test]
    fn parse_settings_config_extracts_and_masks() {
        let raw = r#"{
            "env": {
                "ANTHROPIC_AUTH_TOKEN": "sk-1234567890abcdef",
                "ANTHROPIC_BASE_URL": "https://api.example.com",
                "ANTHROPIC_MODEL": "claude-fable-5"
            },
            "hooks": {}
        }"#;
        let parsed = parse_settings_config(raw).expect("config should parse");
        assert_eq!(parsed.base_url.as_deref(), Some("https://api.example.com"));
        assert_eq!(parsed.model.as_deref(), Some("claude-fable-5"));
        assert_eq!(
            parsed.masked_env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("sk-1…cdef")
        );
        assert_eq!(
            parsed.masked_env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://api.example.com")
        );
    }

    #[test]
    fn parse_settings_config_rejects_invalid_json() {
        assert!(parse_settings_config("not json").is_none());
    }

    fn obj(json: &str) -> Map<String, Value> {
        serde_json::from_str::<Value>(json)
            .expect("test json should parse")
            .as_object()
            .expect("test json should be an object")
            .clone()
    }

    #[test]
    fn replace_anthropic_env_clears_legacy_and_keeps_user_keys() {
        let mut settings = obj(
            r#"{
                "env": {
                    "ANTHROPIC_BASE_URL": "https://old.example.com",
                    "ANTHROPIC_AUTH_TOKEN": "sk-old",
                    "ANTHROPIC_SMALL_FAST_MODEL": "old-haiku",
                    "HTTP_PROXY": "http://127.0.0.1:7890"
                }
            }"#,
        );
        let provider_env = obj(
            r#"{
                "ANTHROPIC_BASE_URL": "https://new.example.com",
                "ANTHROPIC_API_KEY": "sk-new"
            }"#,
        );
        replace_anthropic_env(&mut settings, &provider_env);
        let env = settings.get("env").unwrap().as_object().unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").and_then(Value::as_str),
            Some("https://new.example.com")
        );
        assert_eq!(
            env.get("ANTHROPIC_API_KEY").and_then(Value::as_str),
            Some("sk-new")
        );
        // 上一家供应商遗留的 ANTHROPIC_ key 必须被清掉
        assert!(env.get("ANTHROPIC_AUTH_TOKEN").is_none());
        assert!(env.get("ANTHROPIC_SMALL_FAST_MODEL").is_none());
        // 用户自有非 ANTHROPIC_ key 保留
        assert_eq!(
            env.get("HTTP_PROXY").and_then(Value::as_str),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn replace_anthropic_env_keeps_other_top_level_fields() {
        let mut settings = obj(
            r#"{
                "env": {"ANTHROPIC_AUTH_TOKEN": "sk-old"},
                "hooks": {"UserPromptSubmit": [{"matcher": "*"}]},
                "permissions": {"allow": ["Bash"]},
                "skipDangerousModePermissionPrompt": true
            }"#,
        );
        let hooks_before = settings.get("hooks").cloned();
        let permissions_before = settings.get("permissions").cloned();
        let provider_env = obj(r#"{"ANTHROPIC_BASE_URL": "https://new.example.com"}"#);
        replace_anthropic_env(&mut settings, &provider_env);
        assert_eq!(settings.get("hooks").cloned(), hooks_before);
        assert_eq!(settings.get("permissions").cloned(), permissions_before);
        assert_eq!(
            settings.get("skipDangerousModePermissionPrompt"),
            Some(&Value::Bool(true))
        );
    }

    #[test]
    fn replace_anthropic_env_creates_env_when_missing_or_invalid() {
        let provider_env = obj(r#"{"ANTHROPIC_BASE_URL": "https://new.example.com"}"#);

        let mut without_env = Map::new();
        replace_anthropic_env(&mut without_env, &provider_env);
        let env = without_env.get("env").unwrap().as_object().unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").and_then(Value::as_str),
            Some("https://new.example.com")
        );

        let mut invalid_env = obj(r#"{"env": "not an object"}"#);
        replace_anthropic_env(&mut invalid_env, &provider_env);
        let env = invalid_env.get("env").unwrap().as_object().unwrap();
        assert_eq!(env.len(), 1);
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").and_then(Value::as_str),
            Some("https://new.example.com")
        );
    }

    #[test]
    fn merge_settings_text_rejects_corrupted_json() {
        let provider_env = obj(r#"{"ANTHROPIC_BASE_URL": "https://new.example.com"}"#);
        assert_eq!(
            merge_settings_text(Some("{ not json"), &provider_env),
            Err("settings_parse_failed".to_string())
        );
        // 合法 JSON 但顶层不是对象，同样视为解析失败
        assert_eq!(
            merge_settings_text(Some("[1, 2]"), &provider_env),
            Err("settings_parse_failed".to_string())
        );
    }

    #[test]
    fn merge_settings_text_handles_missing_file() {
        let provider_env = obj(
            r#"{"ANTHROPIC_BASE_URL": "https://new.example.com", "ANTHROPIC_AUTH_TOKEN": "sk-new"}"#,
        );
        let text = merge_settings_text(None, &provider_env).unwrap();
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            value["env"]["ANTHROPIC_BASE_URL"].as_str(),
            Some("https://new.example.com")
        );
        assert_eq!(value["env"]["ANTHROPIC_AUTH_TOKEN"].as_str(), Some("sk-new"));
    }

    #[test]
    fn provider_match_requires_base_url_and_token() {
        let provider = obj(
            r#"{"ANTHROPIC_BASE_URL": "https://a.com", "ANTHROPIC_AUTH_TOKEN": "sk-1"}"#,
        );

        let by_auth_token = obj(
            r#"{"ANTHROPIC_BASE_URL": "https://a.com", "ANTHROPIC_AUTH_TOKEN": "sk-1"}"#,
        );
        assert!(provider_matches_project_env(&by_auth_token, &provider));

        let wrong_base = obj(
            r#"{"ANTHROPIC_BASE_URL": "https://b.com", "ANTHROPIC_AUTH_TOKEN": "sk-1"}"#,
        );
        assert!(!provider_matches_project_env(&wrong_base, &provider));

        let missing_token = obj(r#"{"ANTHROPIC_BASE_URL": "https://a.com"}"#);
        assert!(!provider_matches_project_env(&missing_token, &provider));

        let provider_with_api_key = obj(
            r#"{"ANTHROPIC_BASE_URL": "https://a.com", "ANTHROPIC_API_KEY": "sk-2"}"#,
        );
        let by_api_key = obj(
            r#"{"ANTHROPIC_BASE_URL": "https://a.com", "ANTHROPIC_API_KEY": "sk-2"}"#,
        );
        assert!(provider_matches_project_env(&by_api_key, &provider_with_api_key));
    }

    // ---------- Phase 3 ----------

    #[test]
    fn strip_env_section_removes_env_and_keeps_other_fields() {
        let raw = r#"{
            "env": {
                "ANTHROPIC_BASE_URL": "https://a.com",
                "ANTHROPIC_AUTH_TOKEN": "sk-1",
                "HTTP_PROXY": "http://127.0.0.1:7890"
            },
            "hooks": {"UserPromptSubmit": [{"matcher": "*"}]},
            "permissions": {"allow": ["Bash"]}
        }"#;
        let text = strip_env_section(raw).unwrap().expect("should keep file");
        let value: Value = serde_json::from_str(&text).unwrap();
        // env 整段删除（含用户自有非 ANTHROPIC_ key）
        assert!(value.get("env").is_none());
        // 其余顶层字段原样保留
        assert!(value.get("hooks").is_some());
        assert!(value.get("permissions").is_some());
    }

    #[test]
    fn strip_env_section_signals_file_deletion_when_empty() {
        // 只剩 env → 删除后顶层为空 → None 表示应删除文件
        let only_env = r#"{"env": {"ANTHROPIC_BASE_URL": "https://a.com"}}"#;
        assert_eq!(strip_env_section(only_env), Ok(None));
        // 本来就是空对象 → 同样应删除文件
        assert_eq!(strip_env_section("{}"), Ok(None));
    }

    #[test]
    fn strip_env_section_rejects_corrupted_json() {
        assert_eq!(
            strip_env_section("{ not json"),
            Err("settings_parse_failed".to_string())
        );
        // 合法 JSON 但顶层非对象，同样视为解析失败
        assert_eq!(
            strip_env_section("[1, 2]"),
            Err("settings_parse_failed".to_string())
        );
    }

    #[test]
    fn reset_settings_file_is_noop_when_file_missing() {
        let dir = std::env::temp_dir().join(format!(
            "ccswitch-reset-noop-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        fs::create_dir_all(&dir).unwrap();
        // settings.json 不存在（连 .claude 都没有）→ no-op 成功
        assert_eq!(reset_settings_file(&dir), Ok(()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn anthropic_env_keys_extracts_only_prefixed_key_names() {
        let raw = r#"{
            "env": {
                "ANTHROPIC_BASE_URL": "https://a.com",
                "ANTHROPIC_AUTH_TOKEN": "sk-secret",
                "HTTP_PROXY": "http://127.0.0.1:7890"
            }
        }"#;
        let keys = anthropic_env_keys(raw);
        assert!(keys.contains(&"ANTHROPIC_BASE_URL".to_string()));
        assert!(keys.contains(&"ANTHROPIC_AUTH_TOKEN".to_string()));
        assert!(!keys.contains(&"HTTP_PROXY".to_string()));
        // 只返回 key 名，不含任何值
        assert!(!keys.iter().any(|k| k.contains("sk-secret")));

        // 损坏 JSON / 无 env → 空数组容错
        assert!(anthropic_env_keys("{ not json").is_empty());
        assert!(anthropic_env_keys(r#"{"hooks": {}}"#).is_empty());
    }

    #[test]
    fn probe_settings_text_tolerates_missing_and_corrupted() {
        let providers = vec![(
            "ProviderA".to_string(),
            obj(r#"{"ANTHROPIC_BASE_URL": "https://a.com", "ANTHROPIC_AUTH_TOKEN": "sk-1"}"#),
        )];

        // 文件缺失 / 损坏 JSON / 无 env → hasOverride=false，不让整批失败
        assert_eq!(probe_settings_text(None, &providers), (false, None));
        assert_eq!(probe_settings_text(Some("{ not json"), &providers), (false, None));
        assert_eq!(probe_settings_text(Some(r#"{"hooks": {}}"#), &providers), (false, None));

        // 匹配到供应商 → 返回名字
        let matched = r#"{"env": {"ANTHROPIC_BASE_URL": "https://a.com", "ANTHROPIC_AUTH_TOKEN": "sk-1"}}"#;
        assert_eq!(
            probe_settings_text(Some(matched), &providers),
            (true, Some("ProviderA".to_string()))
        );

        // 有覆盖但匹配不到 → (true, None)，前端显示"自定义"
        let custom = r#"{"env": {"ANTHROPIC_BASE_URL": "https://other.com", "ANTHROPIC_AUTH_TOKEN": "sk-x"}}"#;
        assert_eq!(probe_settings_text(Some(custom), &providers), (true, None));
    }
}
