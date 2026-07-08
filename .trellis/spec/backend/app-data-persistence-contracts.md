# App Data Persistence Contracts

## Scenario: Stable user data survives update

### 1. Scope / Trigger

- Trigger: changing CLI-Manager app data paths, store files, startup legacy migration, or SQLite recovery behavior.
- Goal: app updates, repair installs, and quick relaunches must not reset user projects, settings, sessions, or sync configuration.

### 2. Signatures

- Backend data path command: `app_get_data_paths() -> Result<CliManagerDataPaths, String>`.
- Backend startup migration: `migrate_legacy_app_files(app: &AppHandle<R>) -> Result<(), String>`.
- Backend DB repair command: `db_repair_known_migration_drift(app: AppHandle) -> Result<DbMigrationRepairResult, String>`.
- Stable data directory: `<home>/.cli-manager`.
- Stable store files: `settings.json`, `sessions.json`, `sync-config.json`, `external-session-sync.json`.
- Stable SQLite DB: `cli-manager.db`.

### 3. Contracts

- All durable CLI-Manager user data must resolve under `.cli-manager`, not versioned or identifier-dependent Tauri data folders.
- Store migration from legacy Tauri app data must be non-destructive:
  - copy the legacy store file when the target file is missing;
  - merge only missing top-level JSON object keys when the target file already exists;
  - never overwrite an existing target key;
  - backup the target file before writing a merged target.
- Legacy SQLite DB recovery may copy the legacy DB family only when the legacy DB has user rows and the current DB has no user rows.
- SQLite DB family operations must include `cli-manager.db`, `cli-manager.db-wal`, and `cli-manager.db-shm`.
- Current DB user data always wins over legacy DB user data.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Legacy store missing | No-op. |
| Target store missing | Copy legacy store to `.cli-manager`. |
| Both stores are JSON objects | Add only keys missing from target. |
| Either store is non-object or invalid JSON | Skip merge; do not corrupt target. |
| Target store has existing key | Keep target value. |
| Legacy DB has rows and current DB has none | Backup current DB family, copy legacy DB family. |
| Current DB has any user rows | Do not copy legacy DB. |
| Recovery fails | Log warning and continue normal migration repair. |

### 5. Good/Base/Bad Cases

- Good: after update, a customized `settings.json` keeps existing values and receives only newly missing legacy keys.
- Base: clean install has no legacy files and starts with normal defaults.
- Bad: copying a whole legacy `settings.json` over a newer target file.
- Bad: replacing a current DB that already contains user projects or templates.

### 6. Tests Required

- Rust unit tests for missing-store copy, JSON object merge, and unchanged target when legacy has no new keys.
- Rust unit tests for legacy DB recovery when current DB has no user rows and rejection when current DB has user rows.
- `cargo check` after backend path or DB repair changes.
- `cargo test --lib` or focused `cargo test app_paths db_repair --lib` after persistence migration changes.
- `npx tsc --noEmit` after changing frontend path payloads or store consumers.

### 7. Wrong vs Correct

#### Wrong

```rust
copy_if_missing(&old_store_dir.join("settings.json"), &data_dir.join("settings.json"))?;
```

This misses new legacy keys when an empty target file already exists, and a full overwrite would be unsafe.

#### Correct

```rust
migrate_store_file(&old_store_dir.join("settings.json"), &data_dir.join("settings.json"))?;
```

The migration copies missing files and otherwise merges only missing JSON object keys.
