# History Resume Conversation

## Goal

Add a "resume conversation" action in history sessions so a user can continue a previous Claude or Codex session from the correct project directory in a new internal terminal.

## What I Already Know

- GitHub issue #51 asks for history sessions to support continuing a conversation.
- The action should auto-detect the project directory.
- Claude sessions should start with `claude --resume <session-id>`.
- Codex sessions should start with `codex resume <session-id>`.
- Existing unrelated dirty files must not be touched.

## Assumptions

- The history session payload already contains enough source and directory metadata, or the backend can derive it from existing history files.
- The implementation should reuse existing terminal creation APIs and stores instead of adding a new terminal subsystem.

## Requirements

- Add a visible resume action in the history session UI.
- Detect whether the selected history session belongs to Claude or Codex.
- Resolve the working directory from the session metadata.
- Create a new internal terminal for the resolved project directory.
- Send the appropriate resume command for Claude or Codex.
- Show a user-facing error when source, session id, or project directory cannot be resolved.

## Technical Approach

- Reuse the backend's existing history project scan (`cwd`) and expose it as an optional history summary/detail field.
- Reuse `terminalStore.createSession(...)` with `startupCmd` instead of adding a new terminal IPC path.
- Match the resolved `cwd` to an existing project when possible so project env/shell settings survive; otherwise use the `cwd` directly.

## Decision (ADR-lite)

Context: History sessions already know source/session id and backend code already scans `cwd`, but frontend does not receive it.

Decision: Add `cwd` to the existing history DTOs and trigger resume through the existing terminal creation flow.

Consequences: This is backward-compatible because `cwd` is optional, but `HistorySessionSummary/Detail` are widely imported, so static type-check is required.

## Acceptance Criteria

- [ ] Claude history session can be resumed with `claude --resume <id>` in the detected project directory.
- [ ] Codex history session can be resumed with `codex resume <id>` in the detected project directory.
- [ ] Unsupported or incomplete history sessions do not silently create a broken terminal.
- [ ] TypeScript check passes.

## Definition of Done

- Static checks pass for affected frontend code.
- Manual verification items are listed for desktop runtime behavior.
- No unrelated dirty files are modified.

## Out of Scope

- Changing CLI versions or adding dependencies.
- Modifying application configuration files.
- Resuming unsupported tools beyond Claude and Codex.

## Technical Notes

- Project stack: React 19 + TypeScript + Vite 7 frontend, Rust/Tauri backend.
- Relevant specs read: frontend component/state/quality guidelines, backend terminal runtime monitoring contracts, shared cross-layer and reuse guides.
- User approved the proposed minimal implementation plan.
