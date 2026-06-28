import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { getDb } from "../lib/db";
import { translateCurrent } from "../lib/i18n";
import { logError } from "../lib/logger";
import type { CliHookPayload, CliHookEventName } from "./terminalStore";

export type ReplayEventKind =
  | "session"
  | "prompt"
  | "tool"
  | "mcp"
  | "skill"
  | "subtask"
  | "permission"
  | "notification"
  | "snapshot"
  | "error";

export type ReplayEventStatus = "recorded" | "running" | "completed" | "failed" | "attention" | "saved" | "planned";

export interface ReplaySession {
  sessionKey: string;
  tabId: string;
  cliSessionId: string | null;
  source: string | null;
  projectPath: string | null;
  title: string;
  startedAt: string;
  updatedAt: string;
  status: ReplayEventStatus;
  eventCount: number;
}

export interface ReplayEvent {
  id: number | null;
  sessionKey: string;
  eventIndex: number;
  kind: ReplayEventKind;
  title: string;
  detail: string;
  timestamp: string;
  durationMs: number | null;
  status: ReplayEventStatus;
  tags: string[];
  payload: Record<string, unknown>;
}

export interface ReplaySnapshotFile {
  path: string;
  status: string;
  staged: boolean;
  added: number;
  deleted: number;
}

export interface ReplayWorktreeSnapshot {
  projectPath: string;
  head: string;
  branch: string | null;
  dirty: boolean;
  patch: string;
  files: ReplaySnapshotFile[];
}

interface ReplaySessionRow {
  session_key: string;
  tab_id: string;
  cli_session_id: string | null;
  source: string | null;
  project_path: string | null;
  title: string;
  started_at: string;
  updated_at: string;
  status: ReplayEventStatus;
  event_count: number;
}

interface ReplayEventRow {
  id: number;
  session_key: string;
  event_index: number;
  kind: ReplayEventKind;
  title: string;
  detail: string | null;
  timestamp: string;
  duration_ms: number | null;
  status: ReplayEventStatus;
  tags_json: string;
  payload_json: string;
}

interface ReplayStore {
  sessions: ReplaySession[];
  eventsBySession: Record<string, ReplayEvent[]>;
  selectedSessionKey: string | null;
  loading: boolean;
  ready: boolean;
  error: string | null;
  ensureReady: () => Promise<void>;
  loadRecentSessions: (limit?: number) => Promise<void>;
  loadSession: (sessionKey: string) => Promise<void>;
  selectSession: (sessionKey: string) => Promise<void>;
  recordCliHookEvent: (payload: CliHookPayload) => Promise<void>;
  captureCodeSnapshot: (sessionKey: string, projectPath: string, reason?: string) => Promise<ReplayEvent | null>;
}

let initPromise: Promise<void> | null = null;

function normalizeTimestamp(value: string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function trimOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function mapSession(row: ReplaySessionRow): ReplaySession {
  return {
    sessionKey: row.session_key,
    tabId: row.tab_id,
    cliSessionId: row.cli_session_id,
    source: row.source,
    projectPath: row.project_path,
    title: row.title,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    status: row.status,
    eventCount: row.event_count,
  };
}

function mapEvent(row: ReplayEventRow): ReplayEvent {
  return {
    id: row.id,
    sessionKey: row.session_key,
    eventIndex: row.event_index,
    kind: row.kind,
    title: row.title,
    detail: row.detail ?? "",
    timestamp: row.timestamp,
    durationMs: row.duration_ms,
    status: row.status,
    tags: parseJsonArray(row.tags_json),
    payload: parseJsonObject(row.payload_json),
  };
}

function classifyPayload(payload: CliHookPayload): Pick<ReplayEvent, "kind" | "title" | "detail" | "status" | "tags" | "durationMs"> {
  const event = payload.event;
  const source = trimOptional(payload.source) ?? "cli";
  const tags = [source, event];
  const agentType = trimOptional(payload.agentType);
  const toolUseId = trimOptional(payload.toolUseId);
  const toolName = trimOptional(payload.toolName);
  const mcpServer = trimOptional(payload.mcpServer);
  const skillName = trimOptional(payload.skillName);
  const haystack = `${payload.title ?? ""} ${payload.message ?? ""} ${agentType ?? ""} ${toolName ?? ""} ${mcpServer ?? ""} ${skillName ?? ""}`.toLowerCase();

  if (agentType) tags.push(agentType);
  if (toolUseId) tags.push("tool");
  if (toolName) tags.push(toolName);
  if (mcpServer || haystack.includes("mcp__")) tags.push("mcp");
  if (skillName || haystack.includes("skill")) tags.push("skill");
  if (mcpServer) tags.push(mcpServer);
  if (skillName) tags.push(skillName);

  const titleFromPayload = trimOptional(payload.title);
  const message = trimOptional(payload.message);
  const toolTitle = toolName ?? titleFromPayload;
  const toolDetail = mcpServer
    ? `MCP ${mcpServer}${toolName ? ` · ${toolName}` : ""}`
    : skillName
      ? `Skill ${skillName}`
      : message ?? toolName ?? "Tool event";
  const toolKind: ReplayEventKind = mcpServer ? "mcp" : skillName ? "skill" : "tool";

  const eventMap: Record<CliHookEventName, Pick<ReplayEvent, "kind" | "title" | "detail" | "status" | "durationMs">> = {
    SessionStart: {
      kind: "session",
      title: titleFromPayload ?? "SessionStart",
      detail: message ?? "CLI session bound to terminal tab",
      status: "recorded",
      durationMs: null,
    },
    UserPromptSubmit: {
      kind: "prompt",
      title: titleFromPayload ?? "UserPromptSubmit",
      detail: message ?? "User prompt submitted",
      status: "running",
      durationMs: null,
    },
    Notification: {
      kind: "notification",
      title: titleFromPayload ?? "Notification",
      detail: message ?? "CLI notification",
      status: "attention",
      durationMs: null,
    },
    Stop: {
      kind: "session",
      title: titleFromPayload ?? "Stop",
      detail: message ?? "AI response completed",
      status: "completed",
      durationMs: null,
    },
    StopFailure: {
      kind: "error",
      title: titleFromPayload ?? "StopFailure",
      detail: message ?? "AI response failed",
      status: "failed",
      durationMs: null,
    },
    PermissionRequest: {
      kind: "permission",
      title: titleFromPayload ?? "PermissionRequest",
      detail: message ?? "Permission requested",
      status: "attention",
      durationMs: null,
    },
    SubagentStart: {
      kind: "subtask",
      title: titleFromPayload ?? `${agentType ?? "Subagent"} started`,
      detail: message ?? "Subtask started",
      status: "running",
      durationMs: null,
    },
    SubagentStop: {
      kind: "subtask",
      title: titleFromPayload ?? `${agentType ?? "Subagent"} finished`,
      detail: message ?? "Subtask finished",
      status: "completed",
      durationMs: null,
    },
    AgentToolStart: {
      kind: toolKind,
      title: titleFromPayload ?? "AgentToolStart",
      detail: toolDetail,
      status: "running",
      durationMs: null,
    },
    AgentToolStop: {
      kind: toolKind,
      title: titleFromPayload ?? "AgentToolStop",
      detail: toolDetail,
      status: "completed",
      durationMs: null,
    },
    ToolStart: {
      kind: toolKind,
      title: toolTitle ?? "ToolStart",
      detail: toolDetail,
      status: "running",
      durationMs: null,
    },
    ToolStop: {
      kind: toolKind,
      title: toolTitle ?? "ToolStop",
      detail: toolDetail,
      status: "completed",
      durationMs: null,
    },
  };

  return { ...eventMap[event], tags };
}

async function ensureTables(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const db = await getDb();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS ai_replay_sessions (
          session_key TEXT PRIMARY KEY,
          tab_id TEXT NOT NULL,
          cli_session_id TEXT,
          source TEXT,
          project_path TEXT,
          title TEXT NOT NULL,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          status TEXT NOT NULL,
          event_count INTEGER NOT NULL DEFAULT 0
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS ai_replay_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_key TEXT NOT NULL,
          event_index INTEGER NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT,
          timestamp TEXT NOT NULL,
          duration_ms INTEGER,
          status TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          UNIQUE(session_key, event_index)
        )
      `);
      await db.execute("CREATE INDEX IF NOT EXISTS idx_ai_replay_events_session ON ai_replay_events(session_key, event_index)");
      await db.execute("CREATE INDEX IF NOT EXISTS idx_ai_replay_sessions_updated ON ai_replay_sessions(updated_at DESC)");
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
}

async function fetchSession(sessionKey: string): Promise<ReplaySession | null> {
  const db = await getDb();
  const rows = await db.select<ReplaySessionRow[]>(
    "SELECT * FROM ai_replay_sessions WHERE session_key = $1 LIMIT 1",
    [sessionKey]
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

async function fetchEvents(sessionKey: string): Promise<ReplayEvent[]> {
  const db = await getDb();
  const rows = await db.select<ReplayEventRow[]>(
    "SELECT * FROM ai_replay_events WHERE session_key = $1 ORDER BY event_index ASC",
    [sessionKey]
  );
  return rows.map(mapEvent);
}

interface ReplayEventDraft {
  kind: ReplayEventKind;
  title: string;
  detail: string;
  timestamp: string;
  durationMs: number | null;
  status: ReplayEventStatus;
  tags: string[];
  payload: Record<string, unknown>;
}

interface ReplaySessionDraft {
  title: string;
  cliSessionId: string | null;
  source: string | null;
  projectPath: string | null;
}

async function persistReplayEvent(
  sessionKey: string,
  sessionDraft: ReplaySessionDraft,
  eventDraft: ReplayEventDraft
): Promise<{ session: ReplaySession; event: ReplayEvent }> {
  await ensureTables();
  const db = await getDb();
  const existing = await fetchSession(sessionKey);
  const timestamp = normalizeTimestamp(eventDraft.timestamp);
  const nextIndexRows = await db.select<Array<{ next_index: number | null }>>(
    "SELECT COALESCE(MAX(event_index), 0) + 1 AS next_index FROM ai_replay_events WHERE session_key = $1",
    [sessionKey]
  );
  const eventIndex = nextIndexRows[0]?.next_index ?? 1;
  const startedAt = existing?.startedAt ?? timestamp;

  await db.execute(
    `INSERT OR REPLACE INTO ai_replay_sessions
      (session_key, tab_id, cli_session_id, source, project_path, title, started_at, updated_at, status, event_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      sessionKey,
      sessionKey,
      sessionDraft.cliSessionId,
      sessionDraft.source,
      sessionDraft.projectPath,
      sessionDraft.title,
      startedAt,
      timestamp,
      eventDraft.status,
      eventIndex,
    ]
  );
  await db.execute(
    `INSERT INTO ai_replay_events
      (session_key, event_index, kind, title, detail, timestamp, duration_ms, status, tags_json, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      sessionKey,
      eventIndex,
      eventDraft.kind,
      eventDraft.title,
      eventDraft.detail,
      timestamp,
      eventDraft.durationMs,
      eventDraft.status,
      JSON.stringify(eventDraft.tags),
      JSON.stringify(eventDraft.payload),
    ]
  );

  return {
    session: {
      sessionKey,
      tabId: sessionKey,
      cliSessionId: sessionDraft.cliSessionId,
      source: sessionDraft.source,
      projectPath: sessionDraft.projectPath,
      title: sessionDraft.title,
      startedAt,
      updatedAt: timestamp,
      status: eventDraft.status,
      eventCount: eventIndex,
    },
    event: {
      id: null,
      sessionKey,
      eventIndex,
      kind: eventDraft.kind,
      title: eventDraft.title,
      detail: eventDraft.detail,
      timestamp,
      durationMs: eventDraft.durationMs,
      status: eventDraft.status,
      tags: eventDraft.tags,
      payload: eventDraft.payload,
    },
  };
}

function applyPersistedEvent(session: ReplaySession, event: ReplayEvent) {
  useReplayStore.setState((state) => ({
    sessions: [session, ...state.sessions.filter((item) => item.sessionKey !== session.sessionKey)].slice(0, 12),
    eventsBySession: {
      ...state.eventsBySession,
      [session.sessionKey]: [...(state.eventsBySession[session.sessionKey] ?? []), event],
    },
    selectedSessionKey: state.selectedSessionKey ?? session.sessionKey,
    ready: true,
    error: null,
  }));
}

function shouldCaptureSnapshot(event: CliHookEventName): boolean {
  return event === "UserPromptSubmit" ||
    event === "ToolStop" ||
    event === "AgentToolStop" ||
    event === "SubagentStop" ||
    event === "Stop" ||
    event === "StopFailure";
}

async function getLastSnapshotPayload(sessionKey: string): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  const rows = await db.select<Pick<ReplayEventRow, "payload_json">[]>(
    "SELECT payload_json FROM ai_replay_events WHERE session_key = $1 AND kind = 'snapshot' ORDER BY event_index DESC LIMIT 1",
    [sessionKey]
  );
  return rows[0]?.payload_json ? parseJsonObject(rows[0].payload_json) : null;
}

export const useReplayStore = create<ReplayStore>((set, get) => ({
  sessions: [],
  eventsBySession: {},
  selectedSessionKey: null,
  loading: false,
  ready: false,
  error: null,

  ensureReady: async () => {
    try {
      await ensureTables();
      set({ ready: true, error: null });
    } catch (err) {
      logError("Failed to initialize AI replay store", err);
      set({ error: String(err), ready: false });
    }
  },

  loadRecentSessions: async (limit = 12) => {
    set({ loading: true });
    try {
      await ensureTables();
      const db = await getDb();
      const rows = await db.select<ReplaySessionRow[]>(
        "SELECT * FROM ai_replay_sessions ORDER BY updated_at DESC LIMIT $1",
        [limit]
      );
      const sessions = rows.map(mapSession);
      set((state) => ({
        sessions,
        selectedSessionKey: state.selectedSessionKey ?? sessions[0]?.sessionKey ?? null,
        loading: false,
        ready: true,
        error: null,
      }));
    } catch (err) {
      logError("Failed to load AI replay sessions", err);
      set({ loading: false, error: String(err) });
    }
  },

  loadSession: async (sessionKey) => {
    set({ loading: true });
    try {
      await ensureTables();
      const [session, events] = await Promise.all([fetchSession(sessionKey), fetchEvents(sessionKey)]);
      set((state) => ({
        sessions: session
          ? [session, ...state.sessions.filter((item) => item.sessionKey !== session.sessionKey)].slice(0, 12)
          : state.sessions,
        eventsBySession: { ...state.eventsBySession, [sessionKey]: events },
        selectedSessionKey: sessionKey,
        loading: false,
        ready: true,
        error: null,
      }));
    } catch (err) {
      logError("Failed to load AI replay session", { sessionKey, err });
      set({ loading: false, error: String(err) });
    }
  },

  selectSession: async (sessionKey) => {
    if (!get().eventsBySession[sessionKey]) {
      await get().loadSession(sessionKey);
      return;
    }
    set({ selectedSessionKey: sessionKey });
  },

  recordCliHookEvent: async (payload) => {
    const sessionKey = trimOptional(payload.tabId);
    if (!sessionKey) return;

    try {
      await ensureTables();
      const timestamp = normalizeTimestamp(payload.timestamp);
      const classified = classifyPayload(payload);
      const existing = await fetchSession(sessionKey);
      const title = trimOptional(payload.title) ?? existing?.title ?? `${payload.source ?? "CLI"} replay`;
      const cliSessionId = trimOptional(payload.sessionId) ?? existing?.cliSessionId ?? null;
      const projectPath = trimOptional(payload.cwd) ?? existing?.projectPath ?? null;
      const source = trimOptional(payload.source) ?? existing?.source ?? null;
      const { session, event } = await persistReplayEvent(
        sessionKey,
        { title, cliSessionId, source, projectPath },
        {
          kind: classified.kind,
          title: classified.title,
          detail: classified.detail,
          timestamp,
          durationMs: classified.durationMs,
          status: classified.status,
          tags: classified.tags,
          payload: payload as unknown as Record<string, unknown>,
        }
      );
      applyPersistedEvent(session, event);

      if (projectPath && shouldCaptureSnapshot(payload.event)) {
        void get().captureCodeSnapshot(sessionKey, projectPath, payload.event);
      }
    } catch (err) {
      logError("Failed to record AI replay hook event", { payload, err });
      set({ error: String(err) });
    }
  },

  captureCodeSnapshot: async (sessionKey, projectPath, reason) => {
    const normalizedProjectPath = trimOptional(projectPath);
    if (!normalizedProjectPath) return null;
    try {
      await ensureTables();
      const snapshot = await invoke<ReplayWorktreeSnapshot>("git_get_worktree_snapshot", {
        projectPath: normalizedProjectPath,
      });
      if (!snapshot.dirty || !snapshot.patch.trim()) return null;

      const lastSnapshot = await getLastSnapshotPayload(sessionKey);
      if (lastSnapshot?.patch === snapshot.patch && lastSnapshot?.head === snapshot.head) {
        return null;
      }

      const existing = await fetchSession(sessionKey);
      const title = existing?.title ?? `${snapshot.branch ?? "git"} replay`;
      const timestamp = new Date().toISOString();
      const detail = translateCurrent("aiReplay.snapshot.detail", {
        count: snapshot.files.length,
        branch: snapshot.branch ?? snapshot.head.slice(0, 7),
      });
      const payload: Record<string, unknown> = {
        ...snapshot,
        checkpointId: `snapshot-${Date.now().toString(36)}`,
        reason: reason ?? "manual",
        changedFiles: snapshot.files.map((file) => file.path),
      };
      const { session, event } = await persistReplayEvent(
        sessionKey,
        {
          title,
          cliSessionId: existing?.cliSessionId ?? null,
          source: existing?.source ?? null,
          projectPath: normalizedProjectPath,
        },
        {
          kind: "snapshot",
          title: translateCurrent("aiReplay.snapshot.title"),
          detail,
          timestamp,
          durationMs: null,
          status: "saved",
          tags: ["snapshot", "git", "rollback"],
          payload,
        }
      );
      applyPersistedEvent(session, event);
      return event;
    } catch (err) {
      logError("Failed to capture AI replay code snapshot", { sessionKey, projectPath, err });
      set({ error: String(err) });
      return null;
    }
  },
}));
