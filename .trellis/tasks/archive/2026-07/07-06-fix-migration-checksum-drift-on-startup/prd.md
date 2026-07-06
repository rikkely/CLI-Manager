# fix migration checksum drift on startup

## Goal

Fix intermittent startup project loading failures caused by SQLx migration checksum drift after branch merges reused migration versions 13-15 for different schema changes.

## Changelog Target

V1.2.6

## Requirements

* Starting the app must recover from the known migration version drift involving `add_cli_args_to_projects`, `add_worktree_isolation_tables`, and `create_session_favorite_snapshots_table`.
* Recovery must be idempotent and limited to known safe schema states.
* Recovery must not delete user data or rerun unsafe `ALTER TABLE` migrations.
* Normal database loading must keep using Tauri SQL migrations after repair.

## Acceptance Criteria

* [ ] Databases that already applied old `13 = add_cli_args_to_projects` can load after repair.
* [ ] Databases that already applied worktree/favorite tables under old version numbers can load after repair.
* [ ] Unknown or partially applied schema states fail explicitly instead of being silently rewritten.
* [ ] Rust checks/tests and TypeScript type checks pass for touched code paths.

## Definition of Done

* Tests added or updated for migration repair classification.
* `CHANGELOG.md` updated under `V1.2.6`.
* No proactive `npm run build`, `npm run dev`, `npm run tauri build`, or `npm run tauri dev`.

## Technical Approach

Add a backend repair command that inspects the real SQLite schema and rewrites only `_sqlx_migrations` rows for the known 13-15 drift to match the current migration definitions. Call this once before first `Database.load`, then let the existing SQLx migrator run normally.

## Decision (ADR-lite)

Context: SQLx stores migration checksums by version. This repo had branch history where migration 13 was used for both `cli_args` and favorite snapshots, then worktree isolation added another variant. Changing the static migration order alone would only fix one lineage and break another.

Decision: Keep the current intended migration order, but add a narrowly scoped compatibility repair for known already-applied schema states.

Consequences: `getDb()` gains a startup preflight because all frontend database access flows through it. The repair must stay idempotent and conservative.

## Out of Scope

* Generic migration editor or user-facing database repair UI.
* Repairing arbitrary corrupt SQLite databases.
* Changing project schema beyond the already defined migrations.

## Technical Notes

* Current `src-tauri/src/lib.rs` has `13 = create_session_favorite_snapshots_table`, `14 = add_cli_args_to_projects`, `15 = add_worktree_isolation_tables`.
* `origin/feat/worktree-parallel-task-isolation-wip` previously had `13 = add_cli_args_to_projects`, `14 = add_worktree_isolation_tables`, `15 = create_session_favorite_snapshots_table`.
* SQLx computes migration checksum as SHA-384 over the SQL string and stores it in `_sqlx_migrations.checksum`.
