use crate::webdav::{WebDavClient, WebDavConfig};
use serde::{Deserialize, Serialize};
use log::{info, error};

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
    let json = serde_json::to_string(&data)
        .map_err(|e| format!("Failed to serialize sync data: {}", e))?;

    info!("Uploading to {}", SYNC_FILE_PATH);
    client
        .upload(SYNC_FILE_PATH, json.into_bytes())
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