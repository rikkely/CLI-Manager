use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const CLAUDE_APPROVAL_SCRIPT_NAME: &str = "notify-cli-manager-approval.ps1";
const CLAUDE_FINISHED_SCRIPT_NAME: &str = "notify-cli-manager-finished.ps1";
const CODEX_ATTENTION_SCRIPT_NAME: &str = "notify-cli-manager-codex-attention.ps1";
const CODEX_FINISHED_SCRIPT_NAME: &str = "notify-cli-manager-codex-finished.ps1";
const CLAUDE_SETTINGS_FILE_NAME: &str = "settings.json";
const CODEX_HOOKS_FILE_NAME: &str = "hooks.json";
const CODEX_CONFIG_FILE_NAME: &str = "config.toml";

const HOOK_COMMAND_MARKER: &str = "__hook";
const CLAUDE_LEGACY_SCRIPTS: [&str; 2] = [CLAUDE_APPROVAL_SCRIPT_NAME, CLAUDE_FINISHED_SCRIPT_NAME];
const CODEX_LEGACY_SCRIPTS: [&str; 2] = [CODEX_ATTENTION_SCRIPT_NAME, CODEX_FINISHED_SCRIPT_NAME];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookSettingsStatus {
    claude: ToolHookSettingsStatus,
    codex: ToolHookSettingsStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolHookSettingsStatus {
    config_dir: Option<String>,
    hooks_dir: Option<String>,
    config_path: Option<String>,
    feature_config_path: Option<String>,
    status: HookInstallStatus,
    attention_script_installed: bool,
    finished_script_installed: bool,
    session_start_hook_installed: bool,
    running_hook_installed: bool,
    attention_hook_installed: bool,
    stop_hook_installed: bool,
    failure_hook_installed: bool,
    hooks_feature_installed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum HookInstallStatus {
    DirectoryMissing,
    NotInstalled,
    PartialInstalled,
    Installed,
}

#[tauri::command]
pub async fn hook_settings_get_status(
    selected_dir: Option<String>,
    codex_selected_dir: Option<String>,
) -> Result<HookSettingsStatus, String> {
    Ok(HookSettingsStatus {
        claude: build_claude_status(resolve_claude_dir(selected_dir, false)?)?,
        codex: build_codex_status(resolve_codex_dir(codex_selected_dir, false)?)?,
    })
}

#[tauri::command]
pub async fn hook_settings_install(
    selected_dir: Option<String>,
    codex_selected_dir: Option<String>,
) -> Result<HookSettingsStatus, String> {
    let claude_dir = resolve_claude_dir(selected_dir, true)?
        .ok_or_else(|| "请先选择 Claude 配置目录".to_string())?;
    install_claude_hooks(&claude_dir)?;
    Ok(HookSettingsStatus {
        claude: build_claude_status(Some(claude_dir))?,
        codex: build_codex_status(resolve_codex_dir(codex_selected_dir, false)?)?,
    })
}

#[tauri::command]
pub async fn hook_settings_uninstall(
    selected_dir: Option<String>,
    codex_selected_dir: Option<String>,
) -> Result<HookSettingsStatus, String> {
    let claude_dir = resolve_claude_dir(selected_dir, true)?
        .ok_or_else(|| "请先选择 Claude 配置目录".to_string())?;
    uninstall_claude_hooks(&claude_dir)?;
    Ok(HookSettingsStatus {
        claude: build_claude_status(Some(claude_dir))?,
        codex: build_codex_status(resolve_codex_dir(codex_selected_dir, false)?)?,
    })
}

#[tauri::command]
pub async fn hook_settings_install_codex(
    selected_dir: Option<String>,
    codex_selected_dir: Option<String>,
) -> Result<HookSettingsStatus, String> {
    let codex_dir = resolve_codex_dir(codex_selected_dir, false)?
        .ok_or_else(|| "请先选择 Codex 配置目录".to_string())?;
    install_codex_hooks(&codex_dir)?;
    Ok(HookSettingsStatus {
        claude: build_claude_status(resolve_claude_dir(selected_dir, false)?)?,
        codex: build_codex_status(Some(codex_dir))?,
    })
}

#[tauri::command]
pub async fn hook_settings_uninstall_codex(
    selected_dir: Option<String>,
    codex_selected_dir: Option<String>,
) -> Result<HookSettingsStatus, String> {
    let codex_dir = resolve_codex_dir(codex_selected_dir, false)?
        .ok_or_else(|| "未找到 Codex 配置目录".to_string())?;
    uninstall_codex_hooks(&codex_dir)?;
    Ok(HookSettingsStatus {
        claude: build_claude_status(resolve_claude_dir(selected_dir, false)?)?,
        codex: build_codex_status(Some(codex_dir))?,
    })
}

#[tauri::command]
pub async fn hook_settings_select_dir(
    app: AppHandle,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title(title.as_deref().unwrap_or("Select config directory"))
        .blocking_pick_folder();

    selected
        .map(|file_path| {
            file_path
                .into_path()
                .map(|path| path_to_string(&path))
                .map_err(|e| format!("选择目录失败: {e}"))
        })
        .transpose()
}

fn install_claude_hooks(claude_dir: &Path) -> Result<(), String> {
    let exe = cli_manager_exe()?;
    let settings_path = claude_dir.join(CLAUDE_SETTINGS_FILE_NAME);
    let mut settings = read_json(&settings_path)?;
    ensure_root_object(&settings, "settings.json")?;
    // 先清掉旧版本注册的条目（含历史 .ps1 命令与本应用 __hook 命令），保证安装即升级
    remove_hook_commands(
        &mut settings,
        &["SessionStart", "UserPromptSubmit", "Notification", "Stop", "StopFailure"],
        &CLAUDE_LEGACY_SCRIPTS,
    );
    // SessionStart：会话启动/恢复即回传 sessionId，绑定终端 Tab（不改 Tab 状态），
    // 让实时统计面板无需先发指令即可填充。空 matcher 匹配全部 source。
    add_hook_command(
        &mut settings,
        "SessionStart",
        build_command(&exe, "claude", "SessionStart"),
    );
    add_hook_command(
        &mut settings,
        "UserPromptSubmit",
        build_command(&exe, "claude", "UserPromptSubmit"),
    );
    // 只订阅需要用户介入的通知类型：permission_prompt（等待审批）、
    // idle_prompt（等待输入）；auth_success 等不该把 Tab 置为 attention
    add_hook_command_with_matcher(
        &mut settings,
        "Notification",
        "permission_prompt|idle_prompt",
        build_command(&exe, "claude", "Notification"),
    );
    add_hook_command(&mut settings, "Stop", build_command(&exe, "claude", "Stop"));
    add_hook_command(
        &mut settings,
        "StopFailure",
        build_command(&exe, "claude", "StopFailure"),
    );
    // 清理历史 .ps1 脚本文件（若存在），新方案不再依赖脚本文件
    cleanup_legacy_scripts(&claude_dir.join("hooks"), &CLAUDE_LEGACY_SCRIPTS);
    write_json(&settings_path, &settings)
}

fn uninstall_claude_hooks(claude_dir: &Path) -> Result<(), String> {
    cleanup_legacy_scripts(&claude_dir.join("hooks"), &CLAUDE_LEGACY_SCRIPTS);

    let settings_path = claude_dir.join(CLAUDE_SETTINGS_FILE_NAME);
    let mut settings = read_json(&settings_path)?;
    ensure_root_object(&settings, "settings.json")?;
    remove_hook_commands(
        &mut settings,
        &["SessionStart", "UserPromptSubmit", "Notification", "Stop", "StopFailure"],
        &CLAUDE_LEGACY_SCRIPTS,
    );
    write_json(&settings_path, &settings)
}

fn install_codex_hooks(codex_dir: &Path) -> Result<(), String> {
    let exe = cli_manager_exe()?;
    let hooks_path = codex_dir.join(CODEX_HOOKS_FILE_NAME);
    let mut settings = read_json(&hooks_path)?;
    ensure_root_object(&settings, "hooks.json")?;
    // 先清掉旧版本注册的条目（含历史 .ps1 命令与本应用 __hook 命令），保证安装即升级
    remove_hook_commands(
        &mut settings,
        &["SessionStart", "UserPromptSubmit", "PermissionRequest", "Stop"],
        &CODEX_LEGACY_SCRIPTS,
    );
    // SessionStart：会话启动/恢复即回传 sessionId 绑定终端 Tab（不改 Tab 状态）
    add_hook_command(
        &mut settings,
        "SessionStart",
        build_command(&exe, "codex", "SessionStart"),
    );
    add_hook_command(
        &mut settings,
        "UserPromptSubmit",
        build_command(&exe, "codex", "UserPromptSubmit"),
    );
    add_hook_command(
        &mut settings,
        "PermissionRequest",
        build_command(&exe, "codex", "PermissionRequest"),
    );
    add_hook_command(&mut settings, "Stop", build_command(&exe, "codex", "Stop"));
    ensure_codex_hooks_feature(codex_dir)?;
    // 清理历史 .ps1 脚本文件（若存在），新方案不再依赖脚本文件
    cleanup_legacy_scripts(&codex_dir.join("hooks"), &CODEX_LEGACY_SCRIPTS);
    write_json(&hooks_path, &settings)
}

fn ensure_codex_hooks_feature(codex_dir: &Path) -> Result<(), String> {
    let config_path = codex_dir.join(CODEX_CONFIG_FILE_NAME);
    let content = match fs::read_to_string(&config_path) {
        Ok(value) => value,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("读取 {} 失败: {e}", path_to_string(&config_path))),
    };
    let next_content = set_toml_feature_hooks(&content);
    fs::write(&config_path, next_content)
        .map_err(|e| format!("写入 {} 失败: {e}", path_to_string(&config_path)))
}

fn set_toml_feature_hooks(content: &str) -> String {
    let mut lines: Vec<String> = content.lines().map(ToString::to_string).collect();
    let mut features_header_index = None;
    for (index, line) in lines.iter().enumerate() {
        if line.trim() == "[features]" {
            features_header_index = Some(index);
            break;
        }
    }

    let Some(header_index) = features_header_index else {
        if !lines.is_empty() && lines.last().is_some_and(|line| !line.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.push("[features]".to_string());
        lines.push("hooks = true".to_string());
        return format!("{}\n", lines.join("\n"));
    };

    let mut insert_index = lines.len();
    for index in header_index + 1..lines.len() {
        let trimmed = lines[index].trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            insert_index = index;
            break;
        }
        if trimmed
            .split_once('=')
            .is_some_and(|(key, _)| key.trim() == "hooks")
        {
            lines[index] = "hooks = true".to_string();
            return format!("{}\n", lines.join("\n"));
        }
    }

    lines.insert(insert_index, "hooks = true".to_string());
    format!("{}\n", lines.join("\n"))
}

fn codex_hooks_feature_installed(config_path: &Path) -> Result<bool, String> {
    let content = match fs::read_to_string(config_path) {
        Ok(value) => value,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(format!("读取 {} 失败: {e}", path_to_string(config_path))),
    };
    let mut in_features = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_features = trimmed == "[features]";
            continue;
        }
        if in_features
            && trimmed
                .split_once('=')
                .is_some_and(|(key, value)| key.trim() == "hooks" && value.trim() == "true")
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn uninstall_codex_hooks(codex_dir: &Path) -> Result<(), String> {
    cleanup_legacy_scripts(&codex_dir.join("hooks"), &CODEX_LEGACY_SCRIPTS);

    let hooks_path = codex_dir.join(CODEX_HOOKS_FILE_NAME);
    let mut settings = read_json(&hooks_path)?;
    ensure_root_object(&settings, "hooks.json")?;
    remove_hook_commands(
        &mut settings,
        &["SessionStart", "UserPromptSubmit", "PermissionRequest", "Stop"],
        &CODEX_LEGACY_SCRIPTS,
    );
    write_json(&hooks_path, &settings)
}

fn resolve_claude_dir(
    selected_dir: Option<String>,
    require_existing: bool,
) -> Result<Option<PathBuf>, String> {
    if let Some(dir) = selected_dir.and_then(|value| normalize_selected_dir(&value)) {
        if !dir.is_dir() {
            return Err("选择的 Claude 配置目录不存在".to_string());
        }
        return Ok(Some(dir));
    }

    let Some(home_dir) = home_dir() else {
        return Ok(None);
    };
    let default_dir = home_dir.join(".claude");
    if default_dir.is_dir() {
        Ok(Some(default_dir))
    } else if require_existing {
        Err("未找到默认 Claude 配置目录，请手动选择目录".to_string())
    } else {
        Ok(None)
    }
}

fn resolve_codex_dir(
    selected_dir: Option<String>,
    create_if_missing: bool,
) -> Result<Option<PathBuf>, String> {
    if let Some(dir) = selected_dir.and_then(|value| normalize_selected_dir(&value)) {
        if dir.is_dir() {
            return Ok(Some(dir));
        }
        if create_if_missing {
            fs::create_dir_all(&dir).map_err(|e| format!("创建 Codex 配置目录失败: {e}"))?;
            return Ok(Some(dir));
        }
        return Err("选择的 Codex 配置目录不存在".to_string());
    }

    let Some(home_dir) = home_dir() else {
        return Ok(None);
    };
    let default_dir = home_dir.join(".codex");
    if default_dir.is_dir() {
        Ok(Some(default_dir))
    } else if create_if_missing {
        fs::create_dir_all(&default_dir).map_err(|e| format!("创建 Codex 配置目录失败: {e}"))?;
        Ok(Some(default_dir))
    } else {
        Ok(None)
    }
}

fn normalize_selected_dir(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .filter(|value| !value.is_empty())
        .or_else(|| env::var_os("HOME").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

fn build_claude_status(claude_dir: Option<PathBuf>) -> Result<ToolHookSettingsStatus, String> {
    let Some(claude_dir) = claude_dir else {
        return missing_status();
    };

    let hooks_dir = claude_dir.join("hooks");
    let settings_path = claude_dir.join(CLAUDE_SETTINGS_FILE_NAME);
    // 新方案不再有脚本文件，可执行体可解析即视为"脚本就绪"，命令是否注册才是关键。
    let exe = cli_manager_exe().ok();
    let settings = read_json_if_exists(&settings_path)?;
    let registered = |event: &str| {
        exe.as_deref().is_some_and(|exe| {
            exact_command_registered(&settings, event, &build_command(exe, "claude", event))
        })
    };
    let checks = ToolChecks {
        attention_script_installed: exe.is_some(),
        finished_script_installed: exe.is_some(),
        session_start_hook_installed: registered("SessionStart"),
        running_hook_installed: registered("UserPromptSubmit"),
        attention_hook_installed: registered("Notification"),
        stop_hook_installed: registered("Stop"),
        failure_hook_installed: registered("StopFailure"),
        failure_hook_required: true,
        hooks_feature_installed: true,
    };

    Ok(status_from_checks(
        Some(claude_dir),
        Some(hooks_dir),
        Some(settings_path),
        None,
        checks,
    ))
}

fn build_codex_status(codex_dir: Option<PathBuf>) -> Result<ToolHookSettingsStatus, String> {
    let Some(codex_dir) = codex_dir else {
        return missing_status();
    };

    let hooks_dir = codex_dir.join("hooks");
    let hooks_path = codex_dir.join(CODEX_HOOKS_FILE_NAME);
    let config_path = codex_dir.join(CODEX_CONFIG_FILE_NAME);
    let exe = cli_manager_exe().ok();
    let settings = read_json_if_exists(&hooks_path)?;
    let registered = |event: &str| {
        exe.as_deref().is_some_and(|exe| {
            exact_command_registered(&settings, event, &build_command(exe, "codex", event))
        })
    };
    let checks = ToolChecks {
        attention_script_installed: exe.is_some(),
        finished_script_installed: exe.is_some(),
        session_start_hook_installed: registered("SessionStart"),
        running_hook_installed: registered("UserPromptSubmit"),
        attention_hook_installed: registered("PermissionRequest"),
        stop_hook_installed: registered("Stop"),
        failure_hook_installed: false,
        failure_hook_required: false,
        hooks_feature_installed: codex_hooks_feature_installed(&config_path)?,
    };

    Ok(status_from_checks(
        Some(codex_dir),
        Some(hooks_dir),
        Some(hooks_path),
        Some(config_path),
        checks,
    ))
}

struct ToolChecks {
    attention_script_installed: bool,
    finished_script_installed: bool,
    session_start_hook_installed: bool,
    running_hook_installed: bool,
    attention_hook_installed: bool,
    stop_hook_installed: bool,
    failure_hook_installed: bool,
    failure_hook_required: bool,
    hooks_feature_installed: bool,
}

fn missing_status() -> Result<ToolHookSettingsStatus, String> {
    Ok(ToolHookSettingsStatus {
        config_dir: None,
        hooks_dir: None,
        config_path: None,
        feature_config_path: None,
        status: HookInstallStatus::DirectoryMissing,
        attention_script_installed: false,
        finished_script_installed: false,
        session_start_hook_installed: false,
        running_hook_installed: false,
        attention_hook_installed: false,
        stop_hook_installed: false,
        failure_hook_installed: false,
        hooks_feature_installed: false,
    })
}

fn status_from_checks(
    config_dir: Option<PathBuf>,
    hooks_dir: Option<PathBuf>,
    config_path: Option<PathBuf>,
    feature_config_path: Option<PathBuf>,
    checks: ToolChecks,
) -> ToolHookSettingsStatus {
    let mut values = vec![
        checks.attention_script_installed,
        checks.finished_script_installed,
        checks.session_start_hook_installed,
        checks.running_hook_installed,
        checks.attention_hook_installed,
        checks.stop_hook_installed,
        checks.hooks_feature_installed,
    ];
    if checks.failure_hook_required {
        values.push(checks.failure_hook_installed);
    }
    let status = if values.iter().all(|installed| *installed) {
        HookInstallStatus::Installed
    } else if values.iter().any(|installed| *installed) {
        HookInstallStatus::PartialInstalled
    } else {
        HookInstallStatus::NotInstalled
    };

    ToolHookSettingsStatus {
        config_dir: config_dir.as_deref().map(path_to_string),
        hooks_dir: hooks_dir.as_deref().map(path_to_string),
        config_path: config_path.as_deref().map(path_to_string),
        feature_config_path: feature_config_path.as_deref().map(path_to_string),
        status,
        attention_script_installed: checks.attention_script_installed,
        finished_script_installed: checks.finished_script_installed,
        session_start_hook_installed: checks.session_start_hook_installed,
        running_hook_installed: checks.running_hook_installed,
        attention_hook_installed: checks.attention_hook_installed,
        stop_hook_installed: checks.stop_hook_installed,
        failure_hook_installed: checks.failure_hook_installed,
        hooks_feature_installed: checks.hooks_feature_installed,
    }
}

fn read_json(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(content) => {
            if content.trim().is_empty() {
                Ok(json!({}))
            } else {
                serde_json::from_str(&content)
                    .map_err(|e| format!("解析 {} 失败: {e}", path_to_string(path)))
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(format!("读取 {} 失败: {e}", path_to_string(path))),
    }
}

fn read_json_if_exists(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(content) => {
            if content.trim().is_empty() {
                Ok(json!({}))
            } else {
                serde_json::from_str(&content)
                    .map_err(|e| format!("解析 {} 失败: {e}", path_to_string(path)))
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(format!("读取 {} 失败: {e}", path_to_string(path))),
    }
}

fn ensure_root_object(settings: &Value, file_name: &str) -> Result<(), String> {
    if settings.is_object() {
        Ok(())
    } else {
        Err(format!("{file_name} 根节点必须是 JSON 对象"))
    }
}

fn write_json(path: &Path, settings: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("序列化 {} 失败: {e}", path_to_string(path)))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|e| format!("写入 {} 失败: {e}", path_to_string(path)))
}

fn add_hook_command(settings: &mut Value, event: &str, command: String) {
    add_hook_command_with_matcher(settings, event, "", command);
}

fn add_hook_command_with_matcher(settings: &mut Value, event: &str, matcher: &str, command: String) {
    let root = ensure_object(settings);
    let hooks = ensure_child_object(root, "hooks");
    let event_value = hooks
        .entry(event.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if !event_value.is_array() {
        *event_value = Value::Array(Vec::new());
    }
    if event_has_exact_command(event_value, &command) {
        return;
    }
    if let Value::Array(entries) = event_value {
        entries.push(json!({
            "matcher": matcher,
            "hooks": [
                {
                    "type": "command",
                    "command": command,
                    "timeout": 15
                }
            ]
        }));
    }
}

fn remove_hook_commands(settings: &mut Value, events: &[&str], script_names: &[&str]) {
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else {
        return;
    };

    let mut empty_events = Vec::new();
    for event in events {
        let Some(Value::Array(entries)) = hooks.get_mut(*event) else {
            continue;
        };

        entries.retain_mut(|entry| {
            let Some(entry_object) = entry.as_object_mut() else {
                return true;
            };
            let Some(Value::Array(commands)) = entry_object.get_mut("hooks") else {
                return true;
            };
            commands.retain(|hook| !is_cli_manager_command(hook, script_names));
            !commands.is_empty()
        });

        if entries.is_empty() {
            empty_events.push((*event).to_string());
        }
    }

    for event in empty_events {
        hooks.remove(&event);
    }

    if hooks.is_empty() {
        if let Some(root) = settings.as_object_mut() {
            root.remove("hooks");
        }
    }
}

fn exact_command_registered(settings: &Value, event: &str, command: &str) -> bool {
    settings
        .get("hooks")
        .and_then(|hooks| hooks.get(event))
        .is_some_and(|event_value| event_has_exact_command(event_value, command))
}

fn event_has_exact_command(event_value: &Value, command: &str) -> bool {
    event_value.as_array().is_some_and(|entries| {
        entries.iter().any(|entry| {
            entry
                .get("hooks")
                .and_then(Value::as_array)
                .is_some_and(|hooks| {
                    hooks.iter().any(|hook| {
                        hook.get("command")
                            .and_then(Value::as_str)
                            .is_some_and(|value| value == command)
                    })
                })
        })
    })
}

fn is_cli_manager_command(hook: &Value, legacy_scripts: &[&str]) -> bool {
    hook.get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| {
            // 新方案命令含 __hook 标志；同时兼容识别历史 .ps1 命令，便于安装即升级/卸载清理。
            command.contains(HOOK_COMMAND_MARKER)
                || legacy_scripts
                    .iter()
                    .any(|script_name| command.contains(script_name))
        })
}

fn ensure_object(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value.as_object_mut().expect("value was just made object")
}

fn ensure_child_object<'a>(
    object: &'a mut Map<String, Value>,
    key: &str,
) -> &'a mut Map<String, Value> {
    let value = object
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value.as_object_mut().expect("value was just made object")
}

fn build_command(exe: &str, source: &str, event: &str) -> String {
    // 注册命令直接指向本应用二进制的隐藏子命令，跨平台一致；
    // exe 路径可能含空格（如 macOS .app bundle），统一用双引号包裹。
    format!("\"{exe}\" {HOOK_COMMAND_MARKER} --source {source} --event {event}")
}

fn cli_manager_exe() -> Result<String, String> {
    env::current_exe()
        .map(|path| path_to_string(&path))
        .map_err(|e| format!("获取程序路径失败: {e}"))
}

/// 删除历史遗留的 PowerShell hook 脚本（若存在）；新方案不再写脚本文件。
fn cleanup_legacy_scripts(hooks_dir: &Path, scripts: &[&str]) {
    for name in scripts {
        let _ = fs::remove_file(hooks_dir.join(name));
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn install_codex_rejects_missing_selected_dir_without_creating_it() {
        let tmp = TempDir::new().unwrap();
        let missing_codex_dir = tmp.path().join("missing-codex");

        let err = hook_settings_install_codex(None, Some(path_to_string(&missing_codex_dir)))
            .await
            .unwrap_err();

        assert_eq!(err, "选择的 Codex 配置目录不存在");
        assert!(!missing_codex_dir.exists());
    }

    #[tokio::test]
    async fn install_codex_allows_existing_selected_dir() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let codex_dir = tmp.path().join("codex");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::create_dir_all(&codex_dir).unwrap();

        let status = hook_settings_install_codex(
            Some(path_to_string(&claude_dir)),
            Some(path_to_string(&codex_dir)),
        )
        .await
        .unwrap();

        assert!(matches!(status.codex.status, HookInstallStatus::Installed));
        // 新方案不写脚本文件，改为校验 hooks.json 已注册指向二进制 __hook 的命令
        assert!(codex_dir.join(CODEX_HOOKS_FILE_NAME).is_file());
        assert!(codex_dir.join(CODEX_CONFIG_FILE_NAME).is_file());
        let hooks_json = fs::read_to_string(codex_dir.join(CODEX_HOOKS_FILE_NAME)).unwrap();
        assert!(hooks_json.contains(HOOK_COMMAND_MARKER));
        assert!(hooks_json.contains("--source codex"));
        assert!(!hooks_json.contains(".ps1"));
        assert!(!codex_dir
            .join("hooks")
            .join(CODEX_ATTENTION_SCRIPT_NAME)
            .is_file());
    }

    #[tokio::test]
    async fn install_then_uninstall_claude_removes_hook_commands() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        fs::create_dir_all(&claude_dir).unwrap();

        hook_settings_install(Some(path_to_string(&claude_dir)), None)
            .await
            .unwrap();
        let settings_path = claude_dir.join(CLAUDE_SETTINGS_FILE_NAME);
        let after_install = fs::read_to_string(&settings_path).unwrap();
        assert!(after_install.contains(HOOK_COMMAND_MARKER));
        assert!(after_install.contains("--source claude"));

        hook_settings_uninstall(Some(path_to_string(&claude_dir)), None)
            .await
            .unwrap();
        let after_uninstall = fs::read_to_string(&settings_path).unwrap();
        assert!(!after_uninstall.contains(HOOK_COMMAND_MARKER));
    }

    #[tokio::test]
    async fn install_claude_cleans_legacy_ps1_command() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let hooks_dir = claude_dir.join("hooks");
        fs::create_dir_all(&hooks_dir).unwrap();
        // 预置旧版 .ps1 脚本文件与对应注册命令，验证安装即升级会清掉历史项
        fs::write(hooks_dir.join(CLAUDE_APPROVAL_SCRIPT_NAME), "old").unwrap();
        let legacy = json!({
            "hooks": {
                "Stop": [{
                    "matcher": "",
                    "hooks": [{
                        "type": "command",
                        "command": format!("powershell -File \"{}\" -Event Stop", CLAUDE_APPROVAL_SCRIPT_NAME),
                        "timeout": 15
                    }]
                }]
            }
        });
        fs::write(
            claude_dir.join(CLAUDE_SETTINGS_FILE_NAME),
            serde_json::to_string_pretty(&legacy).unwrap(),
        )
        .unwrap();

        hook_settings_install(Some(path_to_string(&claude_dir)), None)
            .await
            .unwrap();

        let settings = fs::read_to_string(claude_dir.join(CLAUDE_SETTINGS_FILE_NAME)).unwrap();
        assert!(!settings.contains(".ps1"));
        assert!(settings.contains(HOOK_COMMAND_MARKER));
        assert!(!hooks_dir.join(CLAUDE_APPROVAL_SCRIPT_NAME).is_file());
    }
}
