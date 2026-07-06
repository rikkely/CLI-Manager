use crate::app_paths;
use crate::{
    MIGRATION_ADD_CLI_ARGS_DESCRIPTION, MIGRATION_ADD_CLI_ARGS_SQL, MIGRATION_ADD_CLI_ARGS_VERSION,
    MIGRATION_ADD_WORKTREE_ISOLATION_DESCRIPTION, MIGRATION_ADD_WORKTREE_ISOLATION_SQL,
    MIGRATION_ADD_WORKTREE_ISOLATION_VERSION,
    MIGRATION_CREATE_SESSION_FAVORITE_SNAPSHOTS_DESCRIPTION,
    MIGRATION_CREATE_SESSION_FAVORITE_SNAPSHOTS_SQL,
    MIGRATION_CREATE_SESSION_FAVORITE_SNAPSHOTS_VERSION,
};
use serde::Serialize;
use sha2::{Digest, Sha384};
use sqlx::sqlite::{SqliteConnectOptions, SqliteRow};
use sqlx::{Connection, Row, SqliteConnection};
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

const SQLX_MIGRATIONS_TABLE: &str = "_sqlx_migrations";
const KNOWN_DRIFT_START_VERSION: i64 = 13;
const KNOWN_DRIFT_END_VERSION: i64 = 15;

const FAVORITE_SNAPSHOT_COLUMNS: [&str; 11] = [
    "session_key",
    "session_id",
    "source",
    "project_key",
    "file_path",
    "title",
    "created_at",
    "updated_at",
    "message_count",
    "detail_json",
    "snapshot_at",
];

const WORKTREE_PROJECT_COLUMNS: [&str; 2] = ["worktree_strategy", "worktree_root"];
const WORKTREE_COLUMNS: [&str; 10] = [
    "id",
    "project_id",
    "name",
    "branch",
    "path",
    "base_branch",
    "deps_prompt_dismissed",
    "status",
    "created_at",
    "updated_at",
];

#[derive(Debug, Clone, PartialEq, Eq)]
struct MigrationRow {
    version: i64,
    description: String,
    checksum: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExpectedMigration {
    version: i64,
    description: &'static str,
    sql: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SchemaState {
    Absent,
    Complete,
    Partial,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SchemaFeatures {
    favorite_snapshots: SchemaState,
    cli_args: SchemaState,
    worktree_isolation: SchemaState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbMigrationRepairResult {
    repaired: bool,
    status: String,
}

#[tauri::command]
pub async fn db_repair_known_migration_drift() -> Result<DbMigrationRepairResult, String> {
    let db_path = app_paths::db_path()?;
    if !db_path.is_file() {
        return Ok(DbMigrationRepairResult {
            repaired: false,
            status: "db_missing".to_string(),
        });
    }

    let mut conn = open_cli_manager_db(&db_path).await?;
    repair_known_migration_drift(&mut conn).await
}

async fn open_cli_manager_db(path: &Path) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .busy_timeout(Duration::from_secs(15));
    SqliteConnection::connect_with(&options)
        .await
        .map_err(|err| format!("db_open_failed: {err}"))
}

async fn repair_known_migration_drift(
    conn: &mut SqliteConnection,
) -> Result<DbMigrationRepairResult, String> {
    if !table_exists(conn, SQLX_MIGRATIONS_TABLE).await? {
        return Ok(DbMigrationRepairResult {
            repaired: false,
            status: "migration_table_missing".to_string(),
        });
    }

    let features = detect_schema_features(conn).await?;
    let expected = expected_migrations_for_features(&features)?;
    let existing = read_known_migration_rows(conn).await?;

    if existing == expected_rows(&expected) {
        return Ok(DbMigrationRepairResult {
            repaired: false,
            status: "already_consistent".to_string(),
        });
    }

    rewrite_known_migration_rows(conn, &expected).await?;
    Ok(DbMigrationRepairResult {
        repaired: true,
        status: "repaired_known_migration_drift".to_string(),
    })
}

fn expected_migrations_for_features(
    features: &SchemaFeatures,
) -> Result<Vec<ExpectedMigration>, String> {
    let mut expected = Vec::new();

    match features.favorite_snapshots {
        SchemaState::Complete => expected.push(ExpectedMigration {
            version: MIGRATION_CREATE_SESSION_FAVORITE_SNAPSHOTS_VERSION,
            description: MIGRATION_CREATE_SESSION_FAVORITE_SNAPSHOTS_DESCRIPTION,
            sql: MIGRATION_CREATE_SESSION_FAVORITE_SNAPSHOTS_SQL,
        }),
        SchemaState::Absent => {}
        SchemaState::Partial => return Err("migration_repair_partial_favorite_schema".to_string()),
    }

    match features.cli_args {
        SchemaState::Complete => expected.push(ExpectedMigration {
            version: MIGRATION_ADD_CLI_ARGS_VERSION,
            description: MIGRATION_ADD_CLI_ARGS_DESCRIPTION,
            sql: MIGRATION_ADD_CLI_ARGS_SQL,
        }),
        SchemaState::Absent => {}
        SchemaState::Partial => return Err("migration_repair_partial_cli_args_schema".to_string()),
    }

    match features.worktree_isolation {
        SchemaState::Complete => expected.push(ExpectedMigration {
            version: MIGRATION_ADD_WORKTREE_ISOLATION_VERSION,
            description: MIGRATION_ADD_WORKTREE_ISOLATION_DESCRIPTION,
            sql: MIGRATION_ADD_WORKTREE_ISOLATION_SQL,
        }),
        SchemaState::Absent => {}
        SchemaState::Partial => return Err("migration_repair_partial_worktree_schema".to_string()),
    }

    expected.sort_by_key(|migration| migration.version);
    Ok(expected)
}

fn expected_rows(expected: &[ExpectedMigration]) -> Vec<MigrationRow> {
    expected
        .iter()
        .map(|migration| MigrationRow {
            version: migration.version,
            description: migration.description.to_string(),
            checksum: migration_checksum(migration.sql),
        })
        .collect()
}

fn migration_checksum(sql: &str) -> Vec<u8> {
    Sha384::digest(sql.as_bytes()).to_vec()
}

async fn read_known_migration_rows(
    conn: &mut SqliteConnection,
) -> Result<Vec<MigrationRow>, String> {
    let rows = sqlx::query(
        "SELECT version, description, checksum FROM _sqlx_migrations
         WHERE version BETWEEN ?1 AND ?2
         ORDER BY version",
    )
    .bind(KNOWN_DRIFT_START_VERSION)
    .bind(KNOWN_DRIFT_END_VERSION)
    .fetch_all(&mut *conn)
    .await
    .map_err(|err| format!("migration_repair_query_failed: {err}"))?;

    rows.iter().map(migration_row_from_sqlite).collect()
}

fn migration_row_from_sqlite(row: &SqliteRow) -> Result<MigrationRow, String> {
    Ok(MigrationRow {
        version: row
            .try_get("version")
            .map_err(|err| format!("migration_repair_row_failed: {err}"))?,
        description: row
            .try_get("description")
            .map_err(|err| format!("migration_repair_row_failed: {err}"))?,
        checksum: row
            .try_get("checksum")
            .map_err(|err| format!("migration_repair_row_failed: {err}"))?,
    })
}

async fn rewrite_known_migration_rows(
    conn: &mut SqliteConnection,
    expected: &[ExpectedMigration],
) -> Result<(), String> {
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *conn)
        .await
        .map_err(|err| format!("migration_repair_begin_failed: {err}"))?;

    let result = rewrite_known_migration_rows_in_transaction(conn, expected).await;
    if result.is_ok() {
        sqlx::query("COMMIT")
            .execute(&mut *conn)
            .await
            .map_err(|err| format!("migration_repair_commit_failed: {err}"))?;
    } else {
        let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
    }
    result
}

async fn rewrite_known_migration_rows_in_transaction(
    conn: &mut SqliteConnection,
    expected: &[ExpectedMigration],
) -> Result<(), String> {
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version BETWEEN ?1 AND ?2")
        .bind(KNOWN_DRIFT_START_VERSION)
        .bind(KNOWN_DRIFT_END_VERSION)
        .execute(&mut *conn)
        .await
        .map_err(|err| format!("migration_repair_delete_failed: {err}"))?;

    for migration in expected {
        sqlx::query(
            "INSERT INTO _sqlx_migrations
             (version, description, success, checksum, execution_time)
             VALUES (?1, ?2, TRUE, ?3, 0)",
        )
        .bind(migration.version)
        .bind(migration.description)
        .bind(migration_checksum(migration.sql))
        .execute(&mut *conn)
        .await
        .map_err(|err| format!("migration_repair_insert_failed: {err}"))?;
    }

    Ok(())
}

async fn detect_schema_features(conn: &mut SqliteConnection) -> Result<SchemaFeatures, String> {
    let projects_columns = table_columns(conn, "projects").await?;
    let favorite_columns = table_columns(conn, "session_favorite_snapshots").await?;
    let worktree_columns = table_columns(conn, "worktrees").await?;

    Ok(SchemaFeatures {
        favorite_snapshots: classify_table_schema(&favorite_columns, &FAVORITE_SNAPSHOT_COLUMNS),
        cli_args: if projects_columns.contains("cli_args") {
            SchemaState::Complete
        } else {
            SchemaState::Absent
        },
        worktree_isolation: classify_worktree_schema(&projects_columns, &worktree_columns),
    })
}

fn classify_table_schema(columns: &HashSet<String>, required: &[&str]) -> SchemaState {
    if columns.is_empty() {
        return SchemaState::Absent;
    }
    if has_columns(columns, required) {
        SchemaState::Complete
    } else {
        SchemaState::Partial
    }
}

fn classify_worktree_schema(
    projects_columns: &HashSet<String>,
    worktree_columns: &HashSet<String>,
) -> SchemaState {
    let has_project_columns = has_columns(projects_columns, &WORKTREE_PROJECT_COLUMNS);
    let has_worktree_table = !worktree_columns.is_empty();
    let has_worktree_columns = has_columns(worktree_columns, &WORKTREE_COLUMNS);

    if !has_project_columns && !has_worktree_table {
        return SchemaState::Absent;
    }
    if has_project_columns && has_worktree_columns {
        SchemaState::Complete
    } else {
        SchemaState::Partial
    }
}

fn has_columns(columns: &HashSet<String>, required: &[&str]) -> bool {
    required.iter().all(|column| columns.contains(*column))
}

async fn table_exists(conn: &mut SqliteConnection, table: &str) -> Result<bool, String> {
    let exists: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1")
            .bind(table)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|err| format!("migration_repair_schema_query_failed: {err}"))?;
    Ok(exists.is_some())
}

async fn table_columns(
    conn: &mut SqliteConnection,
    table: &'static str,
) -> Result<HashSet<String>, String> {
    if !table_exists(conn, table).await? {
        return Ok(HashSet::new());
    }

    let query = match table {
        "projects" => "PRAGMA table_info(projects)",
        "session_favorite_snapshots" => "PRAGMA table_info(session_favorite_snapshots)",
        "worktrees" => "PRAGMA table_info(worktrees)",
        _ => return Err("migration_repair_unsupported_table".to_string()),
    };
    let rows = sqlx::query(query)
        .fetch_all(&mut *conn)
        .await
        .map_err(|err| format!("migration_repair_schema_query_failed: {err}"))?;

    let mut columns = HashSet::new();
    for row in rows {
        let name: String = row
            .try_get("name")
            .map_err(|err| format!("migration_repair_schema_row_failed: {err}"))?;
        columns.insert(name);
    }
    Ok(columns)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Executor;

    #[test]
    fn maps_complete_feature_schema_to_current_migration_versions() {
        let features = SchemaFeatures {
            favorite_snapshots: SchemaState::Complete,
            cli_args: SchemaState::Complete,
            worktree_isolation: SchemaState::Complete,
        };

        let expected = expected_migrations_for_features(&features).unwrap();
        let versions: Vec<i64> = expected.iter().map(|migration| migration.version).collect();

        assert_eq!(
            versions,
            vec![
                MIGRATION_CREATE_SESSION_FAVORITE_SNAPSHOTS_VERSION,
                MIGRATION_ADD_CLI_ARGS_VERSION,
                MIGRATION_ADD_WORKTREE_ISOLATION_VERSION
            ]
        );
    }

    #[test]
    fn rejects_partial_worktree_schema() {
        let features = SchemaFeatures {
            favorite_snapshots: SchemaState::Absent,
            cli_args: SchemaState::Complete,
            worktree_isolation: SchemaState::Partial,
        };

        assert_eq!(
            expected_migrations_for_features(&features).unwrap_err(),
            "migration_repair_partial_worktree_schema"
        );
    }

    #[tokio::test]
    async fn rewrites_old_worktree_lineage_rows_to_current_versions() {
        let mut conn = SqliteConnection::connect(":memory:").await.unwrap();
        create_migration_table(&mut conn).await;
        create_complete_feature_schema(&mut conn).await;

        insert_migration_row(
            &mut conn,
            13,
            MIGRATION_ADD_CLI_ARGS_DESCRIPTION,
            MIGRATION_ADD_CLI_ARGS_SQL,
        )
        .await;
        insert_migration_row(
            &mut conn,
            14,
            MIGRATION_ADD_WORKTREE_ISOLATION_DESCRIPTION,
            MIGRATION_ADD_WORKTREE_ISOLATION_SQL,
        )
        .await;
        insert_migration_row(
            &mut conn,
            15,
            MIGRATION_CREATE_SESSION_FAVORITE_SNAPSHOTS_DESCRIPTION,
            MIGRATION_CREATE_SESSION_FAVORITE_SNAPSHOTS_SQL,
        )
        .await;

        let result = repair_known_migration_drift(&mut conn).await.unwrap();
        let rows = read_known_migration_rows(&mut conn).await.unwrap();

        assert!(result.repaired);
        assert_eq!(
            rows,
            expected_rows(
                &expected_migrations_for_features(&SchemaFeatures {
                    favorite_snapshots: SchemaState::Complete,
                    cli_args: SchemaState::Complete,
                    worktree_isolation: SchemaState::Complete,
                })
                .unwrap()
            )
        );
    }

    #[tokio::test]
    async fn moves_cli_args_only_lineage_forward_and_leaves_missing_features_to_sqlx() {
        let mut conn = SqliteConnection::connect(":memory:").await.unwrap();
        create_migration_table(&mut conn).await;
        conn.execute(
            "CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                cli_args TEXT NOT NULL DEFAULT ''
            )",
        )
        .await
        .unwrap();
        insert_migration_row(
            &mut conn,
            13,
            MIGRATION_ADD_CLI_ARGS_DESCRIPTION,
            MIGRATION_ADD_CLI_ARGS_SQL,
        )
        .await;

        let result = repair_known_migration_drift(&mut conn).await.unwrap();
        let rows = read_known_migration_rows(&mut conn).await.unwrap();

        assert!(result.repaired);
        assert_eq!(
            rows,
            vec![MigrationRow {
                version: MIGRATION_ADD_CLI_ARGS_VERSION,
                description: MIGRATION_ADD_CLI_ARGS_DESCRIPTION.to_string(),
                checksum: migration_checksum(MIGRATION_ADD_CLI_ARGS_SQL),
            }]
        );
    }

    async fn create_migration_table(conn: &mut SqliteConnection) {
        conn.execute(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
        )
        .await
        .unwrap();
    }

    async fn create_complete_feature_schema(conn: &mut SqliteConnection) {
        conn.execute(
            "CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                cli_args TEXT NOT NULL DEFAULT '',
                worktree_strategy TEXT NOT NULL DEFAULT 'prompt',
                worktree_root TEXT NOT NULL DEFAULT ''
            )",
        )
        .await
        .unwrap();
        conn.execute(
            "CREATE TABLE session_favorite_snapshots (
                session_key TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                source TEXT NOT NULL,
                project_key TEXT NOT NULL,
                file_path TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                message_count INTEGER NOT NULL,
                branch TEXT,
                detail_json TEXT NOT NULL,
                snapshot_at TEXT NOT NULL
            )",
        )
        .await
        .unwrap();
        conn.execute(
            "CREATE TABLE worktrees (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                branch TEXT NOT NULL,
                path TEXT NOT NULL,
                base_branch TEXT NOT NULL DEFAULT '',
                deps_prompt_dismissed INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .await
        .unwrap();
    }

    async fn insert_migration_row(
        conn: &mut SqliteConnection,
        version: i64,
        description: &str,
        sql: &str,
    ) {
        sqlx::query(
            "INSERT INTO _sqlx_migrations
             (version, description, success, checksum, execution_time)
             VALUES (?1, ?2, TRUE, ?3, 0)",
        )
        .bind(version)
        .bind(description)
        .bind(migration_checksum(sql))
        .execute(conn)
        .await
        .unwrap();
    }
}
