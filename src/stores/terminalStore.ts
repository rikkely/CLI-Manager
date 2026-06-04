import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type { TerminalSession, PersistedSplit, Project } from "../lib/types";
import { logError, logInfo } from "../lib/logger";
import { useSettingsStore } from "./settingsStore";
import { useSessionStore } from "./sessionStore";
import { normalizeShellKey } from "../lib/shell";

export type SessionStatus = "running" | "exited" | "error";
export type CliHookSource = "claude" | "codex";
export type CliHookEventName = "UserPromptSubmit" | "Notification" | "Stop" | "StopFailure" | "PermissionRequest";
export type TabNotificationState = "none" | "running" | "attention" | "done" | "failed";
export type ShellRuntimeEventName = "command_started" | "command_finished" | "prompt_shown";

type TabStatusSourceName = "hook" | "shell";

interface TabStatusSources {
  hook?: TabNotificationState;
  shell?: TabNotificationState;
  hookUpdatedAt?: string;
  shellUpdatedAt?: string;
}

export interface TabStatusDetails {
  status: TabNotificationState;
  updatedAt: string | null;
}

export interface ShellRuntimePayload {
  sessionId: string;
  event: ShellRuntimeEventName;
  exitCode?: number | null;
  timestamp?: string | null;
}

const SHELL_RUNTIME_MONITORING_ENV = "CLI_MANAGER_SHELL_RUNTIME_MONITORING";
const TAB_STATUS_PRIORITY: Record<TabNotificationState, number> = {
  none: 0,
  done: 1,
  running: 2,
  failed: 3,
  attention: 4,
};

export interface CliHookPayload {
  tabId: string;
  source?: CliHookSource | null;
  event: CliHookEventName;
  title?: string | null;
  message?: string | null;
  sessionId?: string | null;
  cwd?: string | null;
  timestamp?: string | null;
}

export interface SplitState {
  direction: "horizontal" | "vertical";
  secondSessionId: string;
  ratio: number;
}

interface PtyStatusPayload {
  status: string;
  exit_code: number | null;
}

interface TerminalStore {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  sessionStatuses: Record<string, SessionStatus>;
  statusListeners: Record<string, UnlistenFn>;
  tabNotifications: Record<string, TabNotificationState>;
  tabStatuses: Record<string, TabStatusSources>;
  tabStatusDetails: Record<string, TabStatusDetails>;
  splits: Record<string, SplitState>;
  hiddenBackgroundSessionIds: Set<string>;
  createSession: (projectId?: string, cwd?: string, title?: string, startupCmd?: string, envVars?: Record<string, string>, shell?: string) => Promise<string>;
  closeSession: (id: string) => Promise<void>;
  setActive: (id: string) => void;
  markAttentionInputHandled: (sessionId: string) => void;
  handleCliHookEvent: (payload: CliHookPayload) => string | null;
  handleShellRuntimeEvent: (payload: ShellRuntimePayload) => string | null;
  reorderSessions: (fromId: string, toId: string) => void;
  renameSession: (id: string, title: string) => void;
  splitTerminal: (sessionId: string, direction: "horizontal" | "vertical", cwd?: string, shell?: string) => Promise<void>;
  unsplitTerminal: (sessionId: string) => Promise<void>;
  setSplitRatio: (sessionId: string, ratio: number) => void;
  restoreSessions: (projectMap: Map<string, Project>, projectHealth: Record<string, boolean>) => Promise<void>;
  hideBackgroundForSession: (sessionId: string) => void;
  showBackgroundForSession: (sessionId: string) => void;
}

// 防止 StrictMode 双重调用
let restoreInProgress = false;

// setActive 防抖：高频切换标签时合并持久化写入
let saveActiveIdTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSaveActiveId(id: string | null) {
  if (saveActiveIdTimer !== null) clearTimeout(saveActiveIdTimer);
  saveActiveIdTimer = setTimeout(() => {
    saveActiveIdTimer = null;
    useSessionStore.getState().saveActiveSessionId(id).catch(() => {});
  }, 200);
}

function summarizeStartupCmd(startupCmd?: string): string | null {
  if (!startupCmd) return null;
  const redacted = startupCmd
    .replace(/((?:token|password|passwd|secret|api[_-]?key)\s*=\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1<redacted>")
    .replace(/(--(?:token|password|passwd|secret|api[_-]?key)\s+)(\S+)/gi, "$1<redacted>");
  const summary = redacted.replace(/\s+/g, " ").trim();
  return summary.length > 120 ? `${summary.slice(0, 120)}...` : summary;
}

function logTerminalExitStatus(session: TerminalSession, payload: PtyStatusPayload) {
  if (payload.status !== "exited" && payload.status !== "error") return;
  logInfo("pty status received", {
    sessionId: session.id,
    title: session.title,
    projectId: session.projectId ?? null,
    cwd: session.cwd ?? null,
    shell: session.shell ?? null,
    hasStartupCmd: Boolean(session.startupCmd),
    startupCmdSummary: summarizeStartupCmd(session.startupCmd),
    status: payload.status,
    exit_code: payload.exit_code,
  });
}

function mapCliHookEvent(event: CliHookEventName): TabNotificationState | null {
  if (event === "UserPromptSubmit") return "running";
  if (event === "PermissionRequest") return "attention";
  if (event === "StopFailure") return "failed";
  if (event === "Stop") return "done";
  return null;
}

function mapShellRuntimeEvent(event: ShellRuntimeEventName, exitCode?: number | null): TabNotificationState {
  if (event === "command_started") return "running";
  if (event === "command_finished") {
    if (exitCode === 0) return "done";
    return typeof exitCode === "number" && Number.isFinite(exitCode) ? "failed" : "none";
  }
  return "none";
}

function resolvePrimaryTabId(tabId: string, splits: Record<string, SplitState>): string {
  for (const [primaryId, split] of Object.entries(splits)) {
    if (split.secondSessionId === tabId) return primaryId;
  }
  return tabId;
}

function getTabStatusEntry(state: TabStatusSources | undefined): TabNotificationState {
  if (!state) return "none";
  const candidates: TabNotificationState[] = [state.hook ?? "none", state.shell ?? "none"];
  return candidates.reduce((current, next) => (TAB_STATUS_PRIORITY[next] > TAB_STATUS_PRIORITY[current] ? next : current), "none");
}

function getTabStatusDetails(state: TabStatusSources | undefined): TabStatusDetails {
  if (!state) return { status: "none", updatedAt: null };
  const hookScore = state.hook ? TAB_STATUS_PRIORITY[state.hook] : -1;
  const shellScore = state.shell ? TAB_STATUS_PRIORITY[state.shell] : -1;
  if (hookScore >= shellScore) {
    return { status: state.hook ?? "none", updatedAt: state.hookUpdatedAt ?? null };
  }
  return { status: state.shell ?? "none", updatedAt: state.shellUpdatedAt ?? null };
}

function buildTabStatusUpdate(
  state: Pick<TerminalStore, "tabStatuses" | "tabNotifications" | "tabStatusDetails">,
  sessionId: string,
  source: TabStatusSourceName,
  status: TabNotificationState,
  updatedAt: string
): Pick<TerminalStore, "tabStatuses" | "tabNotifications" | "tabStatusDetails"> {
  const previous = state.tabStatuses[sessionId] ?? {};
  const next: TabStatusSources = {
    ...previous,
    [source]: status,
    [source === "hook" ? "hookUpdatedAt" : "shellUpdatedAt"]: updatedAt,
  };
  return {
    tabStatuses: {
      ...state.tabStatuses,
      [sessionId]: next,
    },
    tabNotifications: {
      ...state.tabNotifications,
      [sessionId]: getTabStatusEntry(next),
    },
    tabStatusDetails: {
      ...state.tabStatusDetails,
      [sessionId]: getTabStatusDetails(next),
    },
  };
}

function supportsShellRuntimeMonitoring(shell?: string | null): boolean {
  const normalized = normalizeShellKey(shell);
  return normalized === undefined || normalized === "powershell" || normalized === "pwsh";
}

function isShellRuntimeMonitoringActive(shell?: string | null): boolean {
  return useSettingsStore.getState().shellRuntimeMonitoringEnabled && supportsShellRuntimeMonitoring(shell);
}

function buildPtyEnvVars(envVars?: Record<string, string> | null, shell?: string | null): Record<string, string> | null {
  const next = { ...(envVars ?? {}) };
  if (isShellRuntimeMonitoringActive(shell)) {
    next[SHELL_RUNTIME_MONITORING_ENV] = "1";
  } else {
    delete next[SHELL_RUNTIME_MONITORING_ENV];
  }
  return Object.keys(next).length > 0 ? next : null;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  sessionStatuses: {},
  statusListeners: {},
  tabNotifications: {},
  tabStatuses: {},
  tabStatusDetails: {},
  splits: {},
  hiddenBackgroundSessionIds: new Set<string>(),

  createSession: async (projectId, cwd, title, startupCmd, envVars, shell) => {
    const normalizedInputShell = normalizeShellKey(shell);
    const normalizedDefaultShell = normalizeShellKey(useSettingsStore.getState().defaultShell);
    const resolvedShell =
      normalizedInputShell ?? (projectId ? null : (normalizedDefaultShell ?? null));

    let sessionId: string;
    try {
      sessionId = await invoke<string>("pty_create", {
        cwd: cwd ?? null,
        envVars: buildPtyEnvVars(envVars ?? null, resolvedShell),
        shell: resolvedShell,
      });
    } catch (err) {
      const description = String(err);
      toast.error("创建终端失败", { description });
      logError("pty_create invoke failed", {
        projectId: projectId ?? null,
        cwd: cwd ?? null,
        shell: resolvedShell,
        err,
      });
      throw err;
    }
    const session: TerminalSession = {
      id: sessionId,
      projectId,
      title: title ?? "Terminal",
      cwd,
      shell: resolvedShell,
      envVars,
      startupCmd,
    };

    const unlisten = await listen<PtyStatusPayload>(`pty-status-${sessionId}`, (event) => {
      const status = event.payload.status as SessionStatus;
      logTerminalExitStatus(session, event.payload);
      set((state) => ({
        sessionStatuses: { ...state.sessionStatuses, [sessionId]: status },
      }));
    });

    const newSessions = [...get().sessions, session];
    set({
      sessions: newSessions,
      activeSessionId: sessionId,
      sessionStatuses: { ...get().sessionStatuses, [sessionId]: "running" },
      statusListeners: { ...get().statusListeners, [sessionId]: unlisten },
    });

    // 持久化到 sessionStore
    await useSessionStore.getState().saveSessions(newSessions);
    await useSessionStore.getState().saveActiveSessionId(sessionId);

    if (startupCmd) {
      setTimeout(() => {
        invoke("pty_write", { sessionId, data: startupCmd + "\r" }).catch((err) => {
          toast.error("启动命令写入失败", { description: String(err) });
          logError("Failed to write startup command", {
            sessionId,
            hasStartupCmd: true,
            startupCmdSummary: summarizeStartupCmd(startupCmd),
            err,
          });
        });
      }, 500);
    }

    return sessionId;
  },

  closeSession: async (id) => {
    const split = get().splits[id];
    const ptySessionIds = split ? [split.secondSessionId, id] : [id];

    // 必须在 set sessions 之前记录原索引，否则后续 findIndex 永远返回 -1，
    // 导致 persistedSplits 永远清不掉（历史 bug）。
    const closedIndex = get().sessions.findIndex((s) => s.id === id);
    const remaining = get().sessions.filter((s) => s.id !== id);
    const newStatuses = { ...get().sessionStatuses };
    const newListeners = { ...get().statusListeners };
    const newNotifications = { ...get().tabNotifications };
    const newTabStatuses = { ...get().tabStatuses };
    const newTabStatusDetails = { ...get().tabStatusDetails };
    const newSplits = { ...get().splits };

    delete newStatuses[id];
    delete newListeners[id];
    delete newNotifications[id];
    delete newTabStatuses[id];
    delete newTabStatusDetails[id];
    delete newSplits[id];
    if (split) {
      delete newStatuses[split.secondSessionId];
      delete newListeners[split.secondSessionId];
      delete newNotifications[split.secondSessionId];
      delete newTabStatuses[split.secondSessionId];
      delete newTabStatusDetails[split.secondSessionId];
    }

    // Drop in-memory background overrides for closed sessions (R8).
    const prevHidden = get().hiddenBackgroundSessionIds;
    let newHidden = prevHidden;
    if (prevHidden.has(id) || (split && prevHidden.has(split.secondSessionId))) {
      newHidden = new Set(prevHidden);
      newHidden.delete(id);
      if (split) newHidden.delete(split.secondSessionId);
    }

    if (split) get().statusListeners[split.secondSessionId]?.();
    get().statusListeners[id]?.();

    const newActiveId =
      get().activeSessionId === id
        ? remaining[remaining.length - 1]?.id ?? null
        : get().activeSessionId;

    set({
      sessions: remaining,
      activeSessionId: newActiveId,
      sessionStatuses: newStatuses,
      statusListeners: newListeners,
      tabNotifications: newNotifications,
      tabStatuses: newTabStatuses,
      tabStatusDetails: newTabStatusDetails,
      splits: newSplits,
      ...(newHidden !== prevHidden ? { hiddenBackgroundSessionIds: newHidden } : {}),
    });

    try {
      await useSessionStore.getState().saveSessions(remaining);
      await useSessionStore.getState().saveActiveSessionId(newActiveId);

      // 更新 splits（移除已关闭主会话对应的 split），使用关闭前记录的索引
      if (closedIndex >= 0) {
        const persistedSplits = useSessionStore.getState().splits.filter(
          (s) => s.primarySessionIndex !== closedIndex
        );
        await useSessionStore.getState().saveSplits(persistedSplits);
      }
    } finally {
      for (const sessionId of ptySessionIds) {
        void invoke("pty_close", { sessionId }).catch((err) => {
          logError("pty_close invoke failed while closing terminal tab", { sessionId, err });
        });
      }
    }
  },

  setActive: (id) => {
    set({ activeSessionId: id });
    scheduleSaveActiveId(id);
  },

  markAttentionInputHandled: (sessionId) => {
    const tabId = resolvePrimaryTabId(sessionId, get().splits);
    if (get().tabStatuses[tabId]?.hook !== "attention") return;
    set((state) => buildTabStatusUpdate(state, tabId, "hook", "running", new Date().toISOString()));
  },

  handleCliHookEvent: (payload) => {
    const tabId = resolvePrimaryTabId(payload.tabId, get().splits);
    if (!get().sessions.some((session) => session.id === tabId)) return null;
    const updatedAt = payload.timestamp ?? new Date().toISOString();
    const status = mapCliHookEvent(payload.event);
    if (!status) return tabId;
    set((state) => {
      const next = buildTabStatusUpdate(state, tabId, "hook", status, updatedAt);
      if (status !== "done" && status !== "failed") return next;

      const tabStatus = next.tabStatuses[tabId];
      if (!tabStatus?.shell) return next;
      const resolved: TabStatusSources = { ...tabStatus };
      delete resolved.shell;
      delete resolved.shellUpdatedAt;
      return {
        tabStatuses: { ...next.tabStatuses, [tabId]: resolved },
        tabNotifications: { ...next.tabNotifications, [tabId]: getTabStatusEntry(resolved) },
        tabStatusDetails: { ...next.tabStatusDetails, [tabId]: getTabStatusDetails(resolved) },
      };
    });
    return tabId;
  },

  handleShellRuntimeEvent: (payload) => {
    const tabId = resolvePrimaryTabId(payload.sessionId, get().splits);
    const session = get().sessions.find((item) => item.id === tabId);
    if (!session || !isShellRuntimeMonitoringActive(session.shell)) return null;
    const status = mapShellRuntimeEvent(payload.event, payload.exitCode ?? null);
    if (status === "none") return tabId;
    const updatedAt = payload.timestamp ?? new Date().toISOString();
    set((state) => buildTabStatusUpdate(state, tabId, "shell", status, updatedAt));
    return tabId;
  },

  reorderSessions: (fromId, toId) => {
    const list = [...get().sessions];
    const fromIdx = list.findIndex((s) => s.id === fromId);
    const toIdx = list.findIndex((s) => s.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    set({ sessions: list });
    useSessionStore.getState().saveSessions(list).catch(() => {});
  },

  renameSession: (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    let changed = false;
    const nextSessions = get().sessions.map((session) => {
      if (session.id !== id) return session;
      if (session.title === trimmed) return session;
      changed = true;
      return { ...session, title: trimmed };
    });
    if (!changed) return;
    set({ sessions: nextSessions });
    useSessionStore.getState().saveSessions(nextSessions).catch(() => {});
  },

  splitTerminal: async (sessionId, direction, cwd, shell) => {
    if (get().splits[sessionId]) return;

    const normalizedInputShell = normalizeShellKey(shell);
    const normalizedDefaultShell = normalizeShellKey(useSettingsStore.getState().defaultShell);
    const resolvedShell = normalizedInputShell ?? (normalizedDefaultShell ?? null);

    let secondSessionId: string;
    try {
      secondSessionId = await invoke<string>("pty_create", {
        cwd: cwd ?? null,
        envVars: buildPtyEnvVars(null, resolvedShell),
        shell: resolvedShell,
      });
    } catch (err) {
      const description = String(err);
      toast.error("创建分屏终端失败", { description });
      logError("pty_create invoke failed for split terminal", {
        sessionId,
        cwd: cwd ?? null,
        shell: resolvedShell,
        err,
      });
      throw err;
    }

    const splitSession: TerminalSession = {
      id: secondSessionId,
      title: "Split Terminal",
      cwd,
      shell: resolvedShell,
    };

    const unlisten = await listen<PtyStatusPayload>(`pty-status-${secondSessionId}`, (event) => {
      const status = event.payload.status as SessionStatus;
      logTerminalExitStatus(splitSession, event.payload);
      set((state) => ({
        sessionStatuses: { ...state.sessionStatuses, [secondSessionId]: status },
      }));
    });

    set((state) => ({
      splits: {
        ...state.splits,
        [sessionId]: { direction, secondSessionId, ratio: 0.5 },
      },
      sessionStatuses: { ...state.sessionStatuses, [secondSessionId]: "running" },
      statusListeners: { ...state.statusListeners, [secondSessionId]: unlisten },
    }));

    // 持久化分屏信息
    const primaryIndex = get().sessions.findIndex((s) => s.id === sessionId);
    if (primaryIndex >= 0) {
      const currentSplits = useSessionStore.getState().splits;
      const newPersistedSplits: PersistedSplit[] = [
        ...currentSplits.filter((s) => s.primarySessionIndex !== primaryIndex),
        {
          primarySessionIndex: primaryIndex,
          direction,
          secondSessionCwd: cwd,
          secondSessionShell: resolvedShell,
          ratio: 0.5,
        },
      ];
      await useSessionStore.getState().saveSplits(newPersistedSplits);
    }
  },

  unsplitTerminal: async (sessionId) => {
    const split = get().splits[sessionId];
    if (!split) return;

    get().statusListeners[split.secondSessionId]?.();
    await invoke("pty_close", { sessionId: split.secondSessionId }).catch(() => {});

    const newStatuses = { ...get().sessionStatuses };
    const newListeners = { ...get().statusListeners };
    const newNotifications = { ...get().tabNotifications };
    const newTabStatuses = { ...get().tabStatuses };
    const newTabStatusDetails = { ...get().tabStatusDetails };
    const newSplits = { ...get().splits };
    delete newStatuses[split.secondSessionId];
    delete newListeners[split.secondSessionId];
    delete newNotifications[split.secondSessionId];
    delete newTabStatuses[split.secondSessionId];
    delete newTabStatusDetails[split.secondSessionId];
    delete newSplits[sessionId];

    set({
      sessionStatuses: newStatuses,
      statusListeners: newListeners,
      tabNotifications: newNotifications,
      tabStatuses: newTabStatuses,
      tabStatusDetails: newTabStatusDetails,
      splits: newSplits,
    });

    // 更新持久化 splits
    const primaryIndex = get().sessions.findIndex((s) => s.id === sessionId);
    const persistedSplits = useSessionStore.getState().splits.filter(
      (s) => s.primarySessionIndex !== primaryIndex
    );
    await useSessionStore.getState().saveSplits(persistedSplits);
  },

  setSplitRatio: (sessionId, ratio) => {
    const split = get().splits[sessionId];
    if (!split) return;
    const clampedRatio = Math.max(0.2, Math.min(0.8, ratio));
    set((state) => ({
      splits: {
        ...state.splits,
        [sessionId]: { ...split, ratio: clampedRatio },
      },
    }));

    // 更新持久化 ratio
    const primaryIndex = get().sessions.findIndex((s) => s.id === sessionId);
    if (primaryIndex >= 0) {
      const currentSplits = useSessionStore.getState().splits;
      const newPersistedSplits = currentSplits.map((s) =>
        s.primarySessionIndex === primaryIndex ? { ...s, ratio: clampedRatio } : s
      );
      useSessionStore.getState().saveSplits(newPersistedSplits).catch(() => {});
    }
  },

  restoreSessions: async (projectMap, projectHealth) => {
    // 防止 StrictMode 双重调用
    if (restoreInProgress) return;
    restoreInProgress = true;

    try {
      const sessionStore = useSessionStore.getState();
      const persistedSessions = sessionStore.sessions;
      const persistedSplits = sessionStore.splits;
      const persistedActiveId = sessionStore.activeSessionId;

      if (persistedSessions.length === 0) return;

    const restoredSessions: TerminalSession[] = [];
    const restoredStatuses: Record<string, SessionStatus> = {};
    const restoredListeners: Record<string, UnlistenFn> = {};
    const restoredSplits: Record<string, SplitState> = {};
    const skippedSessions: string[] = [];

    const newIdMap: Record<string, string> = {}; // oldId -> newId

    for (let i = 0; i < persistedSessions.length; i++) {
      const ps = persistedSessions[i];

      // 检查项目是否存在
      if (ps.projectId) {
        const project = projectMap.get(ps.projectId);
        if (!project) {
          skippedSessions.push(ps.title ?? `会话 ${i + 1}`);
          continue;
        }
        // 检查路径是否有效
        if (!projectHealth[ps.projectId]) {
          // 路径无效但仍创建终端，显示警告
          toast.warning(`项目路径无效: ${project.name}`, {
            description: `路径 ${project.path} 不存在，终端可能无法正常工作`,
          });
        }
      }

      // 重建 PTY
      const normalizedShell = normalizeShellKey(ps.shell);
      const resolvedShell = normalizedShell ?? (ps.projectId ? null : normalizeShellKey(useSettingsStore.getState().defaultShell) ?? null);

      let newSessionId: string;
      try {
        newSessionId = await invoke<string>("pty_create", {
          cwd: ps.cwd ?? null,
          envVars: buildPtyEnvVars(ps.envVars ?? null, resolvedShell),
          shell: resolvedShell,
        });
      } catch (err) {
        logError("Failed to restore session", { session: ps, err });
        skippedSessions.push(ps.title ?? `会话 ${i + 1}`);
        continue;
      }

      newIdMap[ps.id] = newSessionId;

      const restoredSession: TerminalSession = {
        id: newSessionId,
        projectId: ps.projectId,
        title: ps.title,
        cwd: ps.cwd,
        shell: resolvedShell,
        envVars: ps.envVars,
        startupCmd: ps.startupCmd,
      };

      let unlisten: UnlistenFn;
      try {
        unlisten = await listen<PtyStatusPayload>(`pty-status-${newSessionId}`, (event) => {
          const status = event.payload.status as SessionStatus;
          logTerminalExitStatus(restoredSession, event.payload);
          useTerminalStore.setState((state) => ({
            sessionStatuses: { ...state.sessionStatuses, [newSessionId]: status },
          }));
        });
      } catch (err) {
        logError("Failed to register status listener", { sessionId: newSessionId, err });
        await invoke("pty_close", { sessionId: newSessionId }).catch(() => {});
        skippedSessions.push(ps.title ?? `会话 ${i + 1}`);
        continue;
      }

      restoredSessions.push(restoredSession);
      restoredStatuses[newSessionId] = "running";
      restoredListeners[newSessionId] = unlisten;

      // 执行启动命令
      if (ps.startupCmd) {
        setTimeout(() => {
          invoke("pty_write", { sessionId: newSessionId, data: ps.startupCmd + "\r" }).catch((err) => {
            logError("Failed to write startup command on restore", {
              sessionId: newSessionId,
              hasStartupCmd: true,
              startupCmdSummary: summarizeStartupCmd(ps.startupCmd),
              err,
            });
          });
        }, 500);
      }
    }

    // 恢复分屏
    for (const ps of persistedSplits) {
      const oldPrimaryId = persistedSessions[ps.primarySessionIndex]?.id;
      const newPrimaryId = newIdMap[oldPrimaryId];
      if (!newPrimaryId) continue;

      // 创建第二个终端
      const normalizedShell = normalizeShellKey(ps.secondSessionShell);
      const resolvedShell = normalizedShell ?? normalizeShellKey(useSettingsStore.getState().defaultShell) ?? null;

      let secondSessionId: string;
      try {
        secondSessionId = await invoke<string>("pty_create", {
          cwd: ps.secondSessionCwd ?? null,
          envVars: buildPtyEnvVars(null, resolvedShell),
          shell: resolvedShell,
        });
      } catch (err) {
        logError("Failed to restore split session", { split: ps, err });
        continue;
      }

      const restoredSplitSession: TerminalSession = {
        id: secondSessionId,
        title: "Split Terminal",
        cwd: ps.secondSessionCwd,
        shell: resolvedShell,
      };

      const unlisten = await (async () => {
        try {
          return await listen<PtyStatusPayload>(`pty-status-${secondSessionId}`, (event) => {
            const status = event.payload.status as SessionStatus;
            logTerminalExitStatus(restoredSplitSession, event.payload);
            useTerminalStore.setState((state) => ({
              sessionStatuses: { ...state.sessionStatuses, [secondSessionId]: status },
            }));
          });
        } catch (err) {
          logError("Failed to register split status listener", { sessionId: secondSessionId, err });
          await invoke("pty_close", { sessionId: secondSessionId }).catch(() => {});
          return null;
        }
      })();
      if (!unlisten) continue;

      restoredSplits[newPrimaryId] = {
        direction: ps.direction,
        secondSessionId,
        ratio: ps.ratio,
      };
      restoredStatuses[secondSessionId] = "running";
      restoredListeners[secondSessionId] = unlisten;
    }

    // 确定恢复后的 activeSessionId
    let newActiveId: string | null = null;
    if (persistedActiveId && newIdMap[persistedActiveId]) {
      newActiveId = newIdMap[persistedActiveId];
    } else if (restoredSessions.length > 0) {
      newActiveId = restoredSessions[restoredSessions.length - 1].id;
    }

    set({
      sessions: restoredSessions,
      activeSessionId: newActiveId,
      sessionStatuses: restoredStatuses,
      statusListeners: restoredListeners,
      splits: restoredSplits,
    });

    // 更新 sessionStore 的持久化数据（使用新 ID）
    const updatedPersistedSessions = restoredSessions.map((s) => ({
      ...s,
      id: s.id, // 已经是新 ID
    }));
    const updatedPersistedSplits = persistedSplits
      .filter((ps) => {
        const oldPrimaryId = persistedSessions[ps.primarySessionIndex]?.id;
        return newIdMap[oldPrimaryId] && restoredSplits[newIdMap[oldPrimaryId]];
      })
      .map((ps) => {
        const oldPrimaryId = persistedSessions[ps.primarySessionIndex]?.id;
        const newPrimaryId = newIdMap[oldPrimaryId];
        const newPrimaryIndex = restoredSessions.findIndex((s) => s.id === newPrimaryId);
        return {
          ...ps,
          primarySessionIndex: newPrimaryIndex,
        };
      });

    await sessionStore.saveSessions(updatedPersistedSessions);
    await sessionStore.saveSplits(updatedPersistedSplits);
    await sessionStore.saveActiveSessionId(newActiveId);

    // 显示恢复结果提示
      if (skippedSessions.length > 0) {
        toast.info("部分终端会话未恢复", {
          description: `以下会话因项目不存在或创建失败而跳过: ${skippedSessions.join(", ")}`,
        });
      }
      if (restoredSessions.length > 0) {
        toast.success(`已恢复 ${restoredSessions.length} 个终端会话`);
      }
    } finally {
      restoreInProgress = false;
    }
  },

  hideBackgroundForSession: (sessionId) => {
    const current = get().hiddenBackgroundSessionIds;
    if (current.has(sessionId)) return;
    const next = new Set(current);
    next.add(sessionId);
    set({ hiddenBackgroundSessionIds: next });
  },

  showBackgroundForSession: (sessionId) => {
    const current = get().hiddenBackgroundSessionIds;
    if (!current.has(sessionId)) return;
    const next = new Set(current);
    next.delete(sessionId);
    set({ hiddenBackgroundSessionIds: next });
  },
}));