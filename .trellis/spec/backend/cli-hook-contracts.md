# CLI Hook Contracts

Concrete contracts for Claude/Codex hook integration.

## Scenario: Sub-Agent Transcript Hook

### 1. Scope / Trigger

- Trigger: a CLI emits `SubagentStart`, or Claude emits `PreToolUse`/`PostToolUse` for `Agent`/`Task` as fallback lifecycle signals; CLI-Manager opens a read-only transcript pane for that child agent and marks it finished after the matching stop signal.
- Applies to: hook installation, hidden `__hook` client, local TCP bridge payload, frontend `CliHookPayload`, and transcript subscription.

### 2. Signatures

- Installed hook command: `<cli-manager-exe> __hook --source <claude|codex> --event <event>`.
- Hook command quoting: Windows-native exe paths are wrapped by a PowerShell command with single-quote escaping; WSL/macOS/Linux exe paths are POSIX shell single-quoted (`'...'\''...'`). Keep the command shape `<exe> __hook --source <source> --event <event>`.
- Bridge event name: `claude-hook-notification`.
- Frontend subscribe command: `subagent_transcript_subscribe({ key, transcriptPath, cwd, sessionId, agentId }) -> { path, initialContent }`.
- Frontend store action on start/update: `openSubagentTranscript(payload)`.
- Frontend store action on stop: `finishSubagentTranscript(payload)`.
- Frontend transcript state: `SubagentTranscriptContent { content: string; ended: boolean; source?: SubagentTranscriptSource; truncatedBytes?: number; resetSeq: number }`.
- Frontend transcript view prop: `SubagentTranscriptView({ sessionId, title, isVisible })`.
- Agent tool fallback hook names: `AgentToolStart` (from PreToolUse with matcher Agent), `AgentToolStop` (from PostToolUse with matcher Agent).

### 3. Contracts

- Common payload fields: `tabId`, `source`, `event`, `title`, `message`, `sessionId`, `cwd`, `timestamp`, optional `wslDistroName`, optional `reasoningEffort`.
- Claude Code effort display is hook-derived, not history-derived: `__hook` reads `effort.level` (plus flat legacy keys such as `reasoning_effort` / `effort_level`) and falls back to `$CLAUDE_EFFORT`. The frontend may use that value as a realtime-only fallback when `HistorySessionUsage.reasoning_effort` is absent.
- Claude Agent tool fallback events are normalized as `AgentToolStart` from `PreToolUse` and `AgentToolStop` from `PostToolUse`; hook installer must use a matcher limited to `Agent`/`Task`.
- Claude sub-agent fields: `agentId`, `toolUseId`, `agentType`, `agentTranscriptPath`.
- Codex sub-agent fields: `agentId`, `agentType`, `transcriptPath`.
- Frontend transcript source resolution:
  - Use `agentTranscriptPath` only when it is present and differs from `transcriptPath`; this is `child-jsonl` mode.
  - Do not silently render the full parent `transcriptPath` as child output when `agentTranscriptPath` is missing or equals `transcriptPath`; degrade to `parent-jsonl` filtered mode or `lifecycle-only` mode.
  - Backend derivation from `cwd/sessionId/agentId` remains available for explicit transcript subscriptions, but frontend must not use it to disguise a parent transcript as child output.
  - WSL sub-agent transcript derivation requires `wslDistroName` from the hook environment (`WSL_DISTRO_NAME`); explicit Linux transcript paths are converted to `\\wsl.localhost\<distro>\...` before tailing.
  - If `wslDistroName` is missing but `cwd` is a WSL UNC path such as `\\wsl.localhost\Ubuntu\data\repo`, frontend and backend may derive the distro from the UNC prefix. The derived distro is only a fallback for child transcript discovery/subscription; it must not make explicit `/home/...` paths look like WSL when no distro or UNC cwd is available.
  - Claude may emit `ToolStart` / `ToolStop` payloads carrying `agentId` instead of normalized `AgentToolStart` / `AgentToolStop` in some WSL hook paths. Treat `source=claude` plus `ToolStart|ToolStop` plus non-empty `agentId` as a sub-agent transcript lifecycle hint, but do not treat ordinary tool events without `agentId` as sub-agents.
  - Explicit native POSIX transcript paths such as `/Users/...` or `/home/...` must be tailed as native paths when `wslDistroName` is missing. Do not infer a default WSL distro for explicit `/...` paths.
  - `AgentToolStart` should create/update a `pending` pane only; it must not subscribe to the parent transcript.
  - `AgentToolStop` and Claude `ToolStop` with `agentId` may upgrade the matching pending pane to `child-jsonl` when they have an independent `agentTranscriptPath` or enough `cwd/sessionId/agentId` data to derive `subagents/agent-<agentId>.jsonl`.
- `SubagentStop` may also carry the first independent child transcript path. When a matching pane already exists, the frontend must call `openSubagentTranscript(payload)` and await subscription/initial backfill before `finishSubagentTranscript(payload)`, regardless of CLI source.
- Subscribe response fields:
  - `path`: resolved child JSONL path actually tailed by the backend.
  - `initialContent`: existing complete JSONL lines already present before tail startup. The frontend must append this immediately; the backend tail starts after the consumed offset to avoid duplicate output.
- `SubagentStart` and `SubagentStop` must be installed/uninstalled together for each source. Claude `PreToolUse`/`PostToolUse` Agent/Task fallback hooks must be installed/uninstalled with the Claude subagent hooks.
- Stop routing priority: match by `agentId`; if missing, close only when exactly one transcript pane belongs to the parent `tabId`.
- Transcript rendering performance contract:
  - Backend transcript tail emits complete JSONL lines only; the frontend may parse appended suffixes incrementally when `resetSeq` is unchanged and `content.length` only grows.
  - Frontend increments `resetSeq` whenever `reset=true` or content is front-trimmed. A `resetSeq` change is the only signal that consumers must discard parse cache and rebuild from the retained tail.
  - A hidden transcript pane (`isVisible=false`) must not subscribe to or parse `content`; it may keep rendering its cached snapshot and must catch up once visible again.
  - The transcript view must cap rendered message rows (currently 300) and display an omitted-count marker rather than rendering an unbounded list.
  - `MarkdownContent` used for transcript messages must remain memo-safe; do not pass fresh object props that defeat memoization on every append.

### 4. Validation & Error Matrix

- Empty or overlong `tabId` -> bridge rejects with `400 invalid payload`.
- Unknown `source` -> bridge rejects with `400 invalid payload`.
- Event not allowed for its source -> bridge rejects with `400 invalid payload`.
- Missing explicit transcript path and missing derivation fields -> `subagent_transcript_subscribe` returns the specific missing field error.
- WSL derivation requested but `wsl.exe` cannot return `$HOME` -> subscription fails and the frontend keeps the degraded transcript source state.
- Child transcript already has complete lines at subscribe time -> backend returns them in `initialContent` and starts tailing from that offset; an incomplete final line must wait for completion before emit.
- Missing or ambiguous stop target -> frontend does nothing; it must not guess and close multiple child panes.
- `appendSubagentTranscript` receives an unknown key -> ignore it; multi-window broadcasts must not create stray transcript state.
- Appended transcript content exceeds the retention cap -> retain the latest tail, increment `truncatedBytes`, emit the existing OOM diagnostic, and increment `resetSeq` so view caches rebuild safely.

### 5. Good/Base/Bad Cases

- Good: Codex `SubagentStart` includes `transcript_path`; frontend subscribes directly to that path.
- Good: Codex `SubagentStart` only has the parent `transcriptPath`, then `SubagentStop` includes `agentTranscriptPath`; frontend upgrades the existing pane, appends subscribe `initialContent`, then marks it ended.
- Good: Claude `SubagentStart` misses an independent child path, then `SubagentStop` provides `agentTranscriptPath`; frontend upgrades the existing pane before finish instead of ending in degraded state.
- Good: Claude in WSL emits `ToolStop` with `agentId`, parent `transcriptPath`, UNC `cwd`, and no `wslDistroName`; frontend opens/updates a degraded child pane, derives the distro from `cwd`, and backend subscribes to the derived child path without rendering the parent transcript as child output.
- Base: Claude `SubagentStart` includes `agent_transcript_path`; frontend uses it unchanged.
- Good: `SubagentStop` includes `agent_id`; frontend marks the pane ended and closes it after the grace delay.
- Good: a hidden child transcript pane receives 1MB of JSONL append traffic; the store retains content, but the hidden view does not re-parse or re-render until it becomes visible.
- Good: a child transcript grows past the rendered row cap; the UI renders the newest rows plus an omitted-count marker instead of thousands of DOM nodes.
- Good: Claude hook stdin includes `effort.level = "high"`; the bridge emits `reasoningEffort: "high"` and the current terminal's stats card shows the effort even when the JSONL history usage lacks `reasoning_effort`.
- Bad: `SubagentStop` calls `finishSubagentTranscript` before awaiting the late child transcript subscription; the pane can close with empty output.
- Bad: A new hook event is installed but not added to the bridge whitelist; the hook silently posts but the bridge rejects it.
- Bad: `SubagentStop` has no `agent_id` while multiple child panes share one parent; frontend must not close all of them.
- Bad: deriving Claude effort from the model name or global settings when the current hook payload/env has no effort; concurrent sessions can use different `/effort` values.
- Bad: parsing the full retained transcript and re-rendering every Markdown message on every 250ms tail append; this blocks terminal typing and tab switching.

### 6. Tests Required

- Hook install/uninstall tests assert `SubagentStart`/`SubagentStop` and, for Claude, `PreToolUse`/`PostToolUse` Agent tool fallback commands are written and removed for the affected source.
- Rust unit test: `read_new_lines` returns only complete JSONL lines and the consumed offset used for subscribe `initialContent`.
- Rust unit test: explicit `/Users/...` transcript paths stay native without `wslDistroName`; explicit `/home/...` paths convert to WSL UNC only when a distro is provided.
- Rust unit test: WSL UNC `cwd` can provide a fallback distro for derived child transcript paths when `wslDistroName` is missing, and explicit `wslDistroName` still takes precedence.
- Rust unit test: non-Windows hook exe paths with spaces or single quotes are POSIX single-quote escaped.
- Rust compile check must pass after bridge payload or command signature changes.
- Rust unit test: `hook_client` extracts `reasoningEffort` from Claude `effort.level`.
- TypeScript type-check must pass after `CliHookPayload` field changes.
- Frontend regression test or manual profiling: while a child transcript is hidden and appends continue, React render count/CPU for `SubagentTranscriptView` should not grow with append frequency; when shown again, it catches up from retained content.

### 7. Wrong vs Correct

#### Wrong

```ts
// Falls back to the parent session transcript and can make multiple child panes
// render the same main conversation as if it were child output.
transcriptPath: payload.agentTranscriptPath ?? payload.transcriptPath ?? null
```

#### Correct

```ts
const source = resolveSubagentTranscriptSource(payload);
if (source.kind === "child-jsonl") {
  const { initialContent } = await subscribe(source.transcriptPath);
  append(initialContent);
} else {
  showDegradedSourceState(source.kind, source.reason);
}
```

#### Wrong

```tsx
// Every append reparses the whole retained JSONL and rerenders every Markdown row,
// including panes hidden by display:none.
const transcript = useTerminalStore((s) => s.subagentTranscripts[sessionId]);
const messages = useMemo(() => parseTranscript(transcript.content), [transcript.content]);
```

#### Correct

```tsx
// Hidden panes do not subscribe to high-frequency content. Visible panes parse
// only the appended suffix unless resetSeq changed.
const transcript = useTerminalStore((s) => (isVisible ? s.subagentTranscripts[sessionId] : undefined));
const messages = useIncrementalTranscriptCache(transcript?.content, transcript?.resetSeq);
```

## Scenario: System-Level Hook Notifications

### 1. Scope / Trigger

- Trigger: a `claude-hook-notification` payload should also surface as an OS-level notification while preserving the existing in-app toast and tab status behavior.
- Applies to: frontend hook event listener, persisted hook notification settings, Tauri notification permission, and WSL-to-Windows notification bridge commands.

### 2. Signatures

- Frontend event: `listen<CliHookPayload>("claude-hook-notification", handler)`.
- Frontend setting fields: `systemNotificationsEnabled: boolean` and `systemNotificationEvents: Record<HookEventType, boolean>`.
- Hook event union for system notifications: `SessionStart | UserPromptSubmit | Notification | Stop | StopFailure | PermissionRequest`.
- Backend command: `is_wsl() -> bool`.
- Backend command: `send_notification_via_windows(title: String, body: String) -> Result<(), String>`.
- Backend command: `send_interactive_system_notification(title: String, body: String, tabId: String, actionLabel: String) -> Result<(), String>`.
- Backend-to-frontend activation event: `system-notification-action` with `{ tabId }`.
- Non-WSL frontend notifier: `send_interactive_system_notification({ title, body, tabId, actionLabel })`.

### 3. Contracts

- System notifications are **additive**: they must not replace app toast cards or tab status indicators.
- Default event settings: `Stop`, `StopFailure`, `PermissionRequest`, and `Notification` enabled; `SessionStart` and `UserPromptSubmit` disabled.
- Project name priority: `tabTitle` -> basename of `payload.cwd` -> `"未知项目"`.
- Title format: `CLI-Manager`; the OS notification should be attributed to the app rather than the CLI process.
- Body format: emoji + `Claude Code`/`Codex CLI` + project/event phrase, optionally appending `payload.message`.
- WSL fallback path: frontend first tries the interactive native notification command; only if that send path throws and `is_wsl` is true may it call `send_notification_via_windows`.
- Backend guard: `send_notification_via_windows` must reject non-WSL calls so Windows native app instances cannot accidentally show a `Windows PowerShell` source/icon.
- Non-WSL path: frontend checks/requests notification permission before `send_interactive_system_notification`; Windows native app instances must not route through PowerShell because that makes the toast appear as `Windows PowerShell`.
- Click behavior: native interactive notifications emit `system-notification-action`; the frontend shows/focuses the app and activates the owning terminal `tabId`. If the tab no longer exists, the app is focused and the user sees a target-closed toast.

### 4. Validation & Error Matrix

- `systemNotificationsEnabled === false` -> no system notification, no error.
- `systemNotificationEvents[payload.event] !== true` -> no system notification, no error.
- Event outside `HookEventType` (e.g. transcript-only hook events) -> no system notification, no error.
- Non-WSL notification permission denied -> no system notification; log warning only.
- `is_wsl` command failure or notification API failure -> catch and log warning; app toast/tab state must continue.
- WSL bridge title/body too long or containing NUL -> command returns `Err(String)`; frontend catches and logs warning.
- `powershell.exe` unavailable in WSL -> command returns `Err(String)`; frontend catches and logs warning.

### 5. Good/Base/Bad Cases

- Good: `Stop` for a tab titled `CLI-Manager` sends title `CLI-Manager` with body like `✅ Claude Code 在 CLI-Manager 的任务已完成` and still updates the tab status.
- Good: WSL fallback `PermissionRequest` sends through `send_notification_via_windows` without asking Tauri notification permission, and the Toast XML includes `来自 CLI-Manager` attribution.
- Good: native Windows/macOS/Linux `PermissionRequest` emits `system-notification-action` after notification click and activates the matching terminal tab.
- Base: `SessionStart` updates session binding but sends no system notification under default settings.
- Bad: system notification failure prevents `showClaudeHookToast` or `handleCliHookEvent` from running; notification errors must stay isolated.
- Bad: Windows native app instances route through PowerShell and show source `Windows PowerShell`; they must use the Tauri notification plugin path.
- Bad: notification click activation bypasses the shared frontend target activation helper and diverges from app toast behavior.

### 6. Tests Required

- TypeScript type-check must pass after changes to `HookEventType`, settings migration, or notification event filtering.
- Rust compile check must pass after changes to `is_wsl`, `send_notification_via_windows`, or interactive notification command signatures.
- Manual activation test point: clicking a native notification focuses the app and activates the matching tab; if the tab is closed, it focuses the app and shows the target-closed toast.
- Manual Windows/macOS/Linux smoke test: enabled event produces an OS notification with expected title/body.
- Manual WSL smoke test: enabled event produces a Windows Toast through `powershell.exe`.
- Settings UI test point: toggling one event preserves the other `systemNotificationEvents` values.
- Regression test point: app toast and tab indicators still work when system notifications are disabled or fail.

### 7. Wrong vs Correct

#### Wrong

```ts
await sendSystemNotification(payload, tabTitle);
showClaudeHookToast(payload, tabId);
```

#### Correct

```ts
showClaudeHookToast(payload, tabId);
void sendSystemNotification(payload, tabTitle);
```

## Scenario: CLI Hook Protection Through cc-switch Common Config

### 1. Scope / Trigger

- Trigger: Claude/Codex Hook install/status/uninstall must survive external cc-switch provider switches that rewrite CLI settings.
- Applies to: `src-tauri/src/commands/hook_settings.rs`, frontend Hook settings/status callers, persisted `ccSwitchDbPath`, and cc-switch SQLite `settings.common_config_claude` / `settings.common_config_codex`.
- This scenario is global/user-level only. Do not implement project-local `.claude/settings.local.json` or Claude managed settings from this path.

### 2. Signatures

```rust
pub async fn hook_settings_get_status(
    app: AppHandle,
    selected_dir: Option<String>,
    codex_selected_dir: Option<String>,
    cc_switch_db_path: Option<String>,
    auto_repair: Option<bool>,
) -> Result<HookSettingsStatus, String>

pub async fn hook_settings_install(
    app: AppHandle,
    selected_dir: Option<String>,
    codex_selected_dir: Option<String>,
    cc_switch_db_path: Option<String>,
) -> Result<HookSettingsStatus, String>

pub async fn hook_settings_uninstall(
    app: AppHandle,
    selected_dir: Option<String>,
    codex_selected_dir: Option<String>,
    cc_switch_db_path: Option<String>,
) -> Result<HookSettingsStatus, String>

pub async fn hook_settings_install_codex(
    app: AppHandle,
    selected_dir: Option<String>,
    codex_selected_dir: Option<String>,
    cc_switch_db_path: Option<String>,
) -> Result<HookSettingsStatus, String>

pub async fn hook_settings_uninstall_codex(
    app: AppHandle,
    selected_dir: Option<String>,
    codex_selected_dir: Option<String>,
    cc_switch_db_path: Option<String>,
) -> Result<HookSettingsStatus, String>
```

```ts
interface HookSettingsStatus {
  claude: ToolHookSettingsStatus;
  codex: ToolHookSettingsStatus;
  ccSwitch: {
    state: "notDetected" | "notSynced" | "synced" | "invalidDb" | "unavailable" | "syncFailed";
    dbPath: string | null;
    message: string | null;
    wslMismatch: boolean;
  };
  claudeAutoRepaired: boolean;
}
```

### 3. Contracts

- Frontend must pass `ccSwitchDbPath: settings.ccSwitchDbPath ?? undefined`; `null`/missing means platform default `~/.cc-switch/cc-switch.db`.
- Backend must reuse the cc-switch DB resolver: explicit custom paths are validated and never silently replaced by defaults.
- Installing Claude Hook writes normal Claude `settings.json` hooks first, then best-effort merges the same CLI-Manager-owned hook commands into `settings.common_config_claude`.
- Installing Codex Hook writes normal Codex `hooks.json` commands and `config.toml` feature flags first, then best-effort merges the TOML `[features].hooks = true` flag plus any current CLI-Manager-owned Codex `[hooks.state.*]` trust blocks into `settings.common_config_codex`. Codex hook commands remain in `hooks.json`; `common_config_codex` is not JSON.
- Hook settings UI shows the cc-switch protection card once, above system notification settings. Do not duplicate it in both Claude and Codex sections.
- Claude common-config merge may remove/replace only CLI-Manager-owned hook commands (`__hook` marker or known legacy scripts); it must preserve non-hook fields and non-CLI-Manager hook entries. Codex common-config merge may only add or replace the TOML `features.hooks` flag and marker-owned `[hooks.state.*]` trust blocks for the current user-level Codex `hooks.json`; it must preserve other TOML fields and unrelated hook state.
- `settings.value` is nullable in cc-switch DBs. A `NULL` value for `common_config_<tool>` is treated as missing config, not as `db_query_failed`.
- When `common_config_codex` has no `[features]` table, insert the `[features]` block before the first existing TOML table header; append only when the snippet has top-level keys and no tables. This avoids leaking later text-concatenated provider keys into `[features]` while preserving tables such as `[projects.'\\?\F:\...']`, `[windows]`, and `[tui]`.
- Common-config writes use `sqlx` and an explicit transaction. Do not add `rusqlite`.
- If cc-switch is missing or common-config sync fails, Hook installation still succeeds and the returned `ccSwitch.state` explains the protection status.
- WSL config paths must not be paired with a host cc-switch DB silently; return `unavailable` with `wslMismatch: true`.
- `autoRepair: true` means "the user previously installed Claude Hook"; if CLI-Manager-owned hooks are missing or partial, backend may reinstall them and return `claudeAutoRepaired: true`.

### 4. Validation & Error Matrix

| Condition | `ccSwitch.state` / behavior |
|-----------|-----------------------------|
| Default DB path missing | `notDetected`; Hook install/status succeeds |
| Explicit DB path missing or not `.db` | `invalidDb`; do not fallback to default |
| WSL CLI config dir + host DB path | `unavailable`, `wslMismatch: true` |
| Missing `settings` table | `unavailable`; Hook install succeeds |
| Invalid `common_config_claude` JSON | `syncFailed`, message `common_config_parse_failed`; do not overwrite |
| Existing `common_config_codex` TOML | preserve existing TOML fields and set `[features].hooks = true`; do not parse as JSON |
| Existing `common_config_codex` row with `NULL` value | treat as missing config; write minimal `[features]\nhooks = true` TOML |
| Current Codex `config.toml` has trusted CLI-Manager `hooks.state` entries | copy those state blocks into `common_config_codex` with CLI-Manager marker comments |
| Current Codex `config.toml` has unrelated or project-local `.codex/hooks.json` state | do not copy into `common_config_codex` |
| SQLite open/query/write failure | `syncFailed` with stable `db_*`/`db_write_failed` message |
| Existing non-CLI-Manager hooks | preserved on install, reinstall, and uninstall |

### 5. Good/Base/Bad Cases

- Good: User selected a moved cc-switch DB in Settings -> Provider; Hook install syncs the relevant `common_config_<tool>` key at that exact path and returns `synced`.
- Good: `common_config_codex` contains top-level Codex keys plus `[projects.'\\?\F:\idea-work\business-center']`, `[windows]`, and `[tui]`; Hook install preserves all existing lines and inserts `[features].hooks = true` before the first table.
- Good: Codex has already trusted CLI-Manager entries in user-level `~/.codex/config.toml`; Hook install copies only those current `~/.codex/hooks.json:<event>:<entry>:<hook>` state blocks into `common_config_codex`.
- Base: cc-switch is not installed; Hook install still writes normal CLI settings and returns `notDetected`.
- Base: Codex hooks are installed but no trust hash exists yet; common-config sync still writes `[features].hooks = true` and does not fabricate `trusted_hash` values.
- Base: user previously installed Hook, cc-switch rewrites `settings.json`, and startup calls status with `autoRepair: true`; backend restores missing hooks and frontend shows one lightweight notice.
- Bad: invalid explicit DB path falls back to `%USERPROFILE%/.cc-switch/cc-switch.db`; this can write the wrong database and is forbidden.
- Bad: merging common config replaces provider env, MCP, permissions, or third-party hooks; only CLI-Manager hook entries are owned here.
- Bad: appending a new `[features]` table after the last existing TOML table in a common-config snippet; downstream text concatenation can put provider keys in the wrong TOML table scope.
- Bad: copying every `[hooks.state.*]` entry from Codex config; this can leak project-local or user-owned hook trust into cc-switch global common config.

### 6. Tests Required

- Rust unit tests for Claude common-config merge preserving existing fields and non-CLI-Manager hooks, and Codex TOML common-config preserving existing fields while enabling `[features].hooks`.
- Rust regression tests for Codex common-config with the real cc-switch `settings(key TEXT PRIMARY KEY, value TEXT)` shape, including nullable `value` and Windows project table keys.
- Rust regression tests for copying only current user-level CLI-Manager Codex `hooks.state` blocks into `common_config_codex`, replacing stale marker-owned hashes, and excluding project-local `.codex/hooks.json` state.
- Rust unit tests for strip/uninstall preserving non-CLI-Manager hooks.
- Rust regression test that Claude common-config status requires every installed event, including Claude `Notification`; Codex common-config status requires `[features].hooks = true`.
- Rust unit test that invalid Claude common-config JSON returns `common_config_parse_failed`.
- TypeScript type-check after adding payload fields or new frontend status states.
- Manual smoke points: no cc-switch DB, default DB present, custom selected DB, invalid selected DB, and WSL Claude config mismatch.

### 7. Wrong vs Correct

#### Wrong

```rust
// Do not hard-code a local Windows user path or silently fallback from an invalid explicit DB.
let db = PathBuf::from(r"C:\Users\Admini\.cc-switch\cc-switch.db");
```

#### Correct

```rust
let path = resolve_ccswitch_db_path_for_hook(&app, cc_switch_db_path, &claude_dir)?;
```
