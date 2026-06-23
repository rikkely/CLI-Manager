use log::LevelFilter;

#[tauri::command]
pub async fn set_debug_logging(enabled: bool) -> Result<(), String> {
    let level = if enabled {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };
    log::set_max_level(level);
    log::info!(
        "debug logging {}",
        if enabled { "enabled" } else { "disabled" }
    );
    Ok(())
}
