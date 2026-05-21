use std::path::Path;

#[tauri::command]
pub async fn check_paths_exist(paths: Vec<String>) -> Result<Vec<bool>, String> {
    tokio::task::spawn_blocking(move || {
        paths.iter().map(|p| Path::new(p).exists()).collect()
    })
    .await
    .map_err(|e| e.to_string())
}
