# History Session Contracts

## Scenario: Favorite Session Snapshots

### 1. Scope / Trigger

- Trigger: changing history session favorites, session metadata storage, or behavior when original Claude/Codex history JSONL files are missing.

### 2. Signatures

- SQLite table: `session_meta`
  - `session_key TEXT PRIMARY KEY`
  - `starred INTEGER NOT NULL DEFAULT 0`
  - `alias TEXT NOT NULL DEFAULT ''`
  - `tags_json TEXT NOT NULL DEFAULT '[]'`
- SQLite table: `session_favorite_snapshots`
  - `session_key TEXT PRIMARY KEY`
  - `source TEXT NOT NULL`
  - `session_id TEXT NOT NULL`
  - `project_key TEXT NOT NULL`
  - `file_path TEXT NOT NULL`
  - `detail_json TEXT NOT NULL`
- Store action: `historyStore.updateMeta(sessionKey, { starred })`
- Backend detail command still remains the source-of-truth read path while the JSONL exists: `history_get_session`.

### 3. Contracts

- `session_meta.starred` is the favorite flag used for sorting and UI state.
- `session_favorite_snapshots.detail_json` stores a normalized `HistorySessionDetail` snapshot taken when the user favorites a session.
- Favoriting a session must save both the metadata flag and the snapshot.
- Unfavoriting a session must remove the snapshot.
- The history list should prefer live scanned JSONL sessions, then add favorite snapshots only for sessions missing from the scanned result.
- Opening a session should prefer `history_get_session`; if that fails and a favorite snapshot exists, the UI may show the snapshot as read-only historical content.

### 4. Validation & Error Matrix

- Source JSONL exists -> load via backend and ignore snapshot for freshness.
- Source JSONL missing + favorite snapshot exists -> show snapshot.
- Source JSONL missing + no snapshot -> keep existing backend error behavior.
- Snapshot JSON is malformed -> log a warning and do not show that snapshot.
- Project/source filter is active -> include only snapshots matching the same source and project filter.

### 5. Good/Base/Bad Cases

- Good: user favorites a session, deletes the original JSONL, reopens history, and can still open the saved transcript.
- Base: source JSONL still exists; live backend parsing is used and the snapshot is only a fallback.
- Bad: favorite stores only `session_meta.starred`, because deleted JSONL files make the favorite invisible.
- Bad: snapshot rows are shown without checking `session_meta.starred`, because canceled favorites would come back.

### 6. Tests Required

- Run `npx tsc --noEmit` after frontend store/type changes.
- Run `cd src-tauri && cargo check` after adding or changing migrations.
- Manual desktop check:
  - Favorite one Claude or Codex history session.
  - Confirm it remains listed after the original history JSONL is moved away.
  - Open it and verify the saved transcript appears.
  - Cancel favorite and verify the snapshot item disappears.

### 7. Wrong vs Correct

#### Wrong

```typescript
await db.execute("UPDATE session_meta SET starred = 1 WHERE session_key = $1", [sessionKey]);
```

#### Correct

```typescript
await updateMeta(sessionKey, { starred: true });
// updateMeta writes session_meta and session_favorite_snapshots together.
```

## Scenario: External History Project Sync Prompt

### 1. Scope / Trigger

- Trigger: changing how Claude/Codex history projects are detected, prompted, or materialized into the maintained project list.

### 2. Signatures

- Store action: `externalSessionSyncStore.openInitialDialog()`
- Store action: `externalSessionSyncStore.openManualDialog()`
- Store action: `externalSessionSyncStore.syncProjectCandidates(keys: string[])`
- History refresh caller: `HistoryWorkspace.handleRefreshSessions()`

### 3. Contracts

- Startup detection is only for empty maintained-project installs. `openInitialDialog()` must load project state first and return without scanning when `projectStore.projects.length > 0`.
- Manual detection is user-triggered from the history session list refresh action. It must still run when maintained projects exist.
- Manual detection should prompt only for history candidates whose project path/source is not already represented by a maintained project.
- No-candidate manual scans should use a toast and keep the sync dialog closed.
- Candidate and dialog copy must use `useI18n()` / `translateCurrent()` in both `zh-CN` and `en-US`.

### 4. Validation & Error Matrix

- Startup + projects exist -> mark initial prompt handled, no scan, no dialog.
- Startup + no projects + candidates exist -> show initial sync dialog with all candidates selected.
- Startup + no projects + no candidates -> mark initial prompt handled, no dialog.
- Manual refresh + missing project candidates exist -> refresh history list, then show manual sync dialog.
- Manual refresh + no missing project candidates -> refresh history list, show no-candidates toast, keep dialog closed.
- Scan failure -> clear scanning state and show scan-failed toast for manual scans; log warning for startup scans.

### 5. Good/Base/Bad Cases

- Good: a user with an existing project list clicks history refresh and only sees a sync prompt when history contains a new, unmaintained project.
- Base: a fresh install with no projects still gets the first-run detection prompt.
- Bad: startup scans every launch even though the user already maintains projects.
- Bad: history refresh opens an empty sync dialog when there are no missing projects.

### 6. Tests Required

- Run `npx tsc --noEmit` after frontend store/component changes.
- Manually verify the history refresh button reloads sessions and opens the sync dialog only when missing projects exist.
- Manually verify Settings -> General language switching updates the sync dialog, tooltips/aria labels where visible, and toasts.

### 7. Wrong vs Correct

#### Wrong

```typescript
void useExternalSessionSyncStore.getState().openInitialDialog();
```

#### Correct

```typescript
await ensureProjectStoreLoaded("startup");
if (useProjectStore.getState().projects.length > 0) {
  set({ initialSyncPromptHandled: true, scanningProjects: false, projectCandidates: [] });
  await persistCurrentState(get());
  return;
}
```
