use crate::webdav::{WebDavClient, WebDavConfig};
use chrono::Local;
use serde::{Deserialize, Serialize};
use log::{info, error};
use std::fs::{self, File};
use std::path::Path;

const SYNC_FILE_PATH: &str = "cli-manager/sync.json";
const SYNC_DIR_PATH: &str = "cli-manager";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncData {
    pub version: u32,
    pub device_id: String,
    pub last_modified: String,
    pub data: SyncPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncPayload {
    pub projects: Vec<serde_json::Value>,
    pub groups: Vec<serde_json::Value>,
    pub command_templates: Vec<serde_json::Value>,
    pub settings: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictInfo {
    pub local_modified: String,
    pub remote_modified: String,
    pub local_projects: usize,
    pub remote_projects: usize,
    pub local_groups: usize,
    pub remote_groups: usize,
    pub local_templates: usize,
    pub remote_templates: usize,
}

pub fn detect_conflict(local: &SyncData, remote: &SyncData) -> ConflictInfo {
    ConflictInfo {
        local_modified: local.last_modified.clone(),
        remote_modified: remote.last_modified.clone(),
        local_projects: local.data.projects.len(),
        remote_projects: remote.data.projects.len(),
        local_groups: local.data.groups.len(),
        remote_groups: remote.data.groups.len(),
        local_templates: local.data.command_templates.len(),
        remote_templates: remote.data.command_templates.len(),
    }
}

pub async fn test_connection(config: WebDavConfig) -> Result<bool, String> {
    let client = WebDavClient::new(config);
    client.test_connection().await.map_err(|e| e.message)
}

pub async fn upload(config: WebDavConfig, data: SyncData) -> Result<(), String> {
    info!("Creating WebDAV client for {}", config.url);
    let client = WebDavClient::new(config);

    info!("Ensuring directory exists: {}", SYNC_DIR_PATH);
    client
        .ensure_directory(SYNC_DIR_PATH)
        .await
        .map_err(|e| {
            error!("Failed to ensure directory: {}", e);
            e.message
        })?;

    info!("Serializing sync data");
    let json = serde_json::to_vec(&data)
        .map_err(|e| format!("Failed to serialize sync data: {}", e))?;

    info!("Uploading to {}", SYNC_FILE_PATH);
    client
        .upload(SYNC_FILE_PATH, json)
        .await
        .map_err(|e| {
            error!("Upload failed: {}", e);
            e.message
        })?;

    info!("Upload completed successfully");
    Ok(())
}

pub async fn download(config: WebDavConfig) -> Result<SyncData, String> {
    let client = WebDavClient::new(config);

    let data = client
        .download(SYNC_FILE_PATH)
        .await
        .map_err(|e| e.message)?;

    let sync_data: SyncData = serde_json::from_slice(&data)
        .map_err(|e| format!("Failed to parse sync data: {}", e))?;

    Ok(sync_data)
}

pub fn local_export(dir: &str, data: &SyncData) -> Result<String, String> {
    let dir_path = Path::new(dir);
    if !dir_path.exists() {
        fs::create_dir_all(dir_path).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    if !dir_path.is_dir() {
        return Err("提供的路径不是目录".to_string());
    }

    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let filename = format!("cli-manager-sync-{}.zip", timestamp);
    let zip_path = dir_path.join(&filename);

    let file = File::create(&zip_path).map_err(|e| format!("创建 zip 文件失败: {}", e))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    writer
        .start_file("sync.json", options)
        .map_err(|e| format!("写入 zip 失败: {}", e))?;
    // 直接序列化到 zip writer，避免先 to_string_pretty 再 write_all 的中间 String 分配。
    serde_json::to_writer(&mut writer, data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    writer
        .finish()
        .map_err(|e| format!("完成 zip 失败: {}", e))?;

    info!("Local sync exported to {}", zip_path.display());
    Ok(zip_path.to_string_lossy().into_owned())
}

pub fn local_import(zip_path: &str) -> Result<SyncData, String> {
    let path = Path::new(zip_path);
    if !path.exists() || !path.is_file() {
        return Err("zip 文件不存在".to_string());
    }

    let file = File::open(path).map_err(|e| format!("打开 zip 失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("读取 zip 失败: {}", e))?;
    let mut entry = archive
        .by_name("sync.json")
        .map_err(|e| {
            error!("zip 中找不到 sync.json: {}", e);
            format!("无效的同步文件: {}", e)
        })?;

    let data: SyncData = serde_json::from_reader(&mut entry)
        .map_err(|e| format!("解析数据失败: {}", e))?;
    Ok(data)
}