# Fix Codex realtime stats session id root cause

## Goal

Fix the Codex terminal realtime stats panel showing zero token/session cards even when Codex JSONL logs contain token_count data. The root cause is that the backend exposes Codex session_id as the rollout file stem, while CLI hooks report the real Codex session UUID. The frontend strict binding check then treats the loaded session as unbound.

## What I already know

* User selected the root fix, not a frontend filename-compatibility workaround.
* Latest files under `~/.codex/sessions` still contain `event_msg.payload.info.total_token_usage`; token data exists.
* Codex hook scripts report `sessionId = hookInput.session_id`, e.g. `019ed4a1-d197-75d0-950c-28cb3bbed404`.
* Current backend `build_session_computation` uses `path.file_stem()` as `session_id`, e.g. `rollout-2026-06-17T16-10-35-019ed4a1-d197-75d0-950c-28cb3bbed404`.
* `history_list_sessions` can fuzzy-match the UUID by query, but `TerminalStatsPanel` uses strict equality in `tokensBound`, so the token cards are intentionally zeroed.
* User explicitly requires that Claude Code usage must not be affected.

## Requirements

* Codex session summaries and details must prefer JSONL `session_meta.payload.id` for `session_id`.
* If a Codex file lacks `session_meta.payload.id`, keep the existing file-stem fallback so older or malformed logs remain readable.
* Claude behavior must stay unchanged: Claude summaries/details continue using the existing file-stem session id, Claude token deduplication remains unchanged, and Claude realtime stats must not receive any Codex-specific compatibility branch.
* Do not add frontend rollout filename matching. Existing strict binding should work after backend identity normalization.
* Add or update Rust tests for Codex session id normalization.

## Acceptance Criteria

* [ ] When Codex JSONL contains `session_meta.payload.id`, `history_list_sessions` returns that UUID as `session_id`.
* [ ] `history_get_session` returns a `session_id` matching hook `sessionId`.
* [ ] Codex files without `session_meta.payload.id` still fall back to the file stem.
* [ ] A Claude-style JSONL without `session_meta.payload.id` returns the same file-stem `session_id` as before.
* [ ] Existing Codex token_count delta tests still pass.
* [ ] Existing Claude streamed-usage dedup tests still pass.
* [ ] Relevant Rust tests pass.

## Definition of Done

* Backend history identity contract is fixed.
* Frontend strict binding needs no rollout filename compatibility.
* No user Codex config, hook file, or history log is modified.
* No unrelated refactor.

## Technical Approach

Extract the real Codex session id from `session_meta.payload.id` during JSONL scanning and carry it through the summary scan. When building `CachedSessionComputation.session_id`, prefer that extracted id and fall back to `path.file_stem()`. This keeps Claude Code unchanged because Claude logs do not expose this Codex `session_meta.payload.id` field.

## Decision (ADR-lite)

**Context**: Realtime stats must bind the current terminal hook session id to the matching history session. Backend and hook currently expose different Codex identities.

**Decision**: Normalize Codex history `session_id` at the backend history boundary to the JSONL metadata UUID.

**Consequences**: Realtime stats, history detail, and search use the same identity. Existing local metadata keys may change from rollout stem to UUID for Codex sessions, but file path remains part of the frontend session key.

## Out of Scope

* Do not edit `~/.codex/hooks.json`, `config.toml`, or installed hook scripts.
* Do not rewrite Codex history files.
* Do not redesign realtime stats UI.
* Do not solve the separate case where a plain terminal starts `codex` manually without hook env injection.

## Technical Notes

* Relevant files: `src-tauri/src/commands/history.rs`, `src/components/terminal/TerminalStatsPanel.tsx`, `src/stores/historyStore.ts`.
* Current frontend gate: `latestSession?.session_id === terminalSession?.cliSessionId`.
* Current backend source: `build_session_computation` uses `path.file_stem()` for `session_id`.
* Contract: `.trellis/spec/backend/history-stats-contracts.md` requires terminal realtime stats to bind strictly to current `TerminalSession.cliSessionId`.
