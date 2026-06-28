import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  Camera,
  Clock3,
  Code2,
  GitFork,
  KeyRound,
  ListFilter,
  MessageSquare,
  Network,
  PlugZap,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { useI18n, type TranslationKey } from "../../lib/i18n";
import { useReplayStore, type ReplayEvent, type ReplayEventKind, type ReplayEventStatus, type ReplayWorktreeSnapshot } from "../../stores/replayStore";
import { EmptyHint, HeaderPill, TERM_PANEL, panelColorTint } from "../stats/termStatsUi";

interface SessionReplayPanelProps {
  activeSessionId: string | null;
  open: boolean;
  visible?: boolean;
}

type ReplayFilter = "all" | ReplayEventKind;

const FILTERS: Array<{ key: ReplayFilter; labelKey: TranslationKey }> = [
  { key: "all", labelKey: "aiReplay.filter.all" },
  { key: "tool", labelKey: "aiReplay.filter.tool" },
  { key: "mcp", labelKey: "aiReplay.filter.mcp" },
  { key: "skill", labelKey: "aiReplay.filter.skill" },
  { key: "subtask", labelKey: "aiReplay.filter.subtask" },
  { key: "snapshot", labelKey: "aiReplay.filter.snapshot" },
  { key: "error", labelKey: "aiReplay.filter.error" },
];

const KIND_META: Record<ReplayEventKind, { icon: ComponentType<{ size?: number; strokeWidth?: number }>; color: string; labelKey: TranslationKey }> = {
  session: { icon: Terminal, color: TERM_PANEL.cyan, labelKey: "aiReplay.kind.session" },
  prompt: { icon: MessageSquare, color: TERM_PANEL.green, labelKey: "aiReplay.kind.prompt" },
  tool: { icon: Wrench, color: TERM_PANEL.blue, labelKey: "aiReplay.kind.tool" },
  mcp: { icon: PlugZap, color: TERM_PANEL.magenta, labelKey: "aiReplay.kind.mcp" },
  skill: { icon: Sparkles, color: TERM_PANEL.yellow, labelKey: "aiReplay.kind.skill" },
  subtask: { icon: Network, color: TERM_PANEL.cyan, labelKey: "aiReplay.kind.subtask" },
  permission: { icon: KeyRound, color: TERM_PANEL.red, labelKey: "aiReplay.kind.permission" },
  notification: { icon: Bot, color: TERM_PANEL.yellow, labelKey: "aiReplay.kind.notification" },
  snapshot: { icon: Camera, color: TERM_PANEL.yellow, labelKey: "aiReplay.kind.snapshot" },
  error: { icon: AlertTriangle, color: TERM_PANEL.red, labelKey: "aiReplay.kind.error" },
};

const STATUS_KEYS: Record<ReplayEventStatus, TranslationKey> = {
  recorded: "aiReplay.status.recorded",
  running: "aiReplay.status.running",
  completed: "aiReplay.status.completed",
  failed: "aiReplay.status.failed",
  attention: "aiReplay.status.attention",
  saved: "aiReplay.status.saved",
  planned: "aiReplay.status.planned",
};

function statusColor(status: ReplayEventStatus): string {
  if (status === "failed" || status === "attention") return TERM_PANEL.red;
  if (status === "running") return TERM_PANEL.magenta;
  if (status === "saved" || status === "planned") return TERM_PANEL.yellow;
  return TERM_PANEL.green;
}

function formatClock(timestamp: string, language: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatElapsed(firstTimestamp: string | null, timestamp: string): string {
  if (!firstTimestamp) return "+00:00";
  const start = Date.parse(firstTimestamp);
  const current = Date.parse(timestamp);
  if (!Number.isFinite(start) || !Number.isFinite(current)) return "+00:00";
  const totalSeconds = Math.max(0, Math.round((current - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `+${minutes}:${seconds}`;
}

function stringifyPayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 12);
  return entries.map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n");
}

function eventMatches(event: ReplayEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    event.title,
    event.detail,
    event.kind,
    event.status,
    event.tags.join(" "),
    stringifyPayload(event.payload),
  ].some((value) => value.toLowerCase().includes(q));
}

function getStringPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function buildSnapshotForkBranchName(event: ReplayEvent): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return `replay/${stamp}-event-${event.eventIndex}`;
}

function SnapshotDetail({
  event,
  latestSnapshot,
  rollbackPending,
  forkPending,
  onRollback,
  onFork,
}: {
  event: ReplayEvent;
  latestSnapshot: ReplayEvent | null;
  rollbackPending: boolean;
  forkPending: boolean;
  onRollback: (event: ReplayEvent, latestSnapshot: ReplayEvent) => void;
  onFork: (event: ReplayEvent, latestSnapshot: ReplayEvent) => void;
}) {
  const { t } = useI18n();
  const files = Array.isArray(event.payload.changedFiles)
    ? event.payload.changedFiles.filter((item): item is string => typeof item === "string")
    : [];
  const canRollback = Boolean(
    getStringPayload(event.payload, "patch") &&
    getStringPayload(event.payload, "head") &&
    getStringPayload(event.payload, "projectPath") &&
    latestSnapshot &&
    getStringPayload(latestSnapshot.payload, "patch")
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <DetailMetric label={t("aiReplay.detail.checkpoint")} value={String(event.payload.checkpointId ?? `#${event.eventIndex}`)} color={TERM_PANEL.yellow} />
        <DetailMetric label={t("aiReplay.detail.files")} value={String(files.length || (event.payload.changedFiles ?? 0))} color={TERM_PANEL.blue} />
      </div>
      {event.detail && (
        <p className="text-[11px] leading-5" style={{ color: TERM_PANEL.dim }}>
          {event.detail}
        </p>
      )}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.slice(0, 4).map((file) => (
            <div key={file} className="truncate rounded-md px-2 py-1 text-[10px]" style={{ color: TERM_PANEL.fg, backgroundColor: TERM_PANEL.cardInner }}>
              {file}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <ActionButton icon={<Code2 size={12} />} label={t("aiReplay.action.viewSnapshot")} disabled />
        <ActionButton
          icon={<RotateCcw size={12} />}
          label={rollbackPending ? t("aiReplay.action.rollbackRunning") : t("aiReplay.action.rollback")}
          disabled={!canRollback || rollbackPending || !latestSnapshot}
          onClick={() => {
            if (latestSnapshot) onRollback(event, latestSnapshot);
          }}
        />
        <ActionButton
          icon={<GitFork size={12} />}
          label={forkPending ? t("aiReplay.action.forkRunning") : t("aiReplay.action.fork")}
          disabled={!canRollback || forkPending || !latestSnapshot}
          onClick={() => {
            if (latestSnapshot) onFork(event, latestSnapshot);
          }}
        />
      </div>
    </div>
  );
}

function GenericDetail({ event }: { event: ReplayEvent }) {
  const { t } = useI18n();
  const payloadText = stringifyPayload(event.payload);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <DetailMetric label={t("aiReplay.detail.event")} value={`#${event.eventIndex}`} color={KIND_META[event.kind].color} />
        <DetailMetric label={t("aiReplay.detail.status")} value={t(STATUS_KEYS[event.status])} color={statusColor(event.status)} />
      </div>
      {event.detail && (
        <p className="text-[11px] leading-5" style={{ color: TERM_PANEL.fg }}>
          {event.detail}
        </p>
      )}
      {event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {event.tags.slice(0, 8).map((tag) => (
            <span key={tag} className="rounded border px-1.5 py-0.5 text-[10px]" style={{ color: TERM_PANEL.dim, borderColor: TERM_PANEL.border }}>
              {tag}
            </span>
          ))}
        </div>
      )}
      {payloadText && (
        <pre
          className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border p-2 text-[10px] leading-4 ui-thin-scroll"
          style={{ color: TERM_PANEL.dim, backgroundColor: TERM_PANEL.cardInner, borderColor: TERM_PANEL.border }}
        >
          {payloadText}
        </pre>
      )}
    </div>
  );
}

function DetailMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0 rounded-lg border px-2 py-1.5" style={{ backgroundColor: TERM_PANEL.cardInner, borderColor: TERM_PANEL.border }}>
      <div className="text-[10px]" style={{ color: TERM_PANEL.dim }}>{label}</div>
      <div className="truncate text-[12px] font-bold" style={{ color }} title={value}>{value}</div>
    </div>
  );
}

function ActionButton({ icon, label, disabled = false, onClick }: { icon: ReactNode; label: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="ui-focus-ring flex min-w-0 items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
      style={{
        color: disabled ? TERM_PANEL.dim : TERM_PANEL.cyan,
        borderColor: disabled ? TERM_PANEL.border : panelColorTint(TERM_PANEL.cyan, 34),
        backgroundColor: disabled ? "transparent" : panelColorTint(TERM_PANEL.cyan, 8),
      }}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function SessionReplayPanel({ activeSessionId, open, visible = true }: SessionReplayPanelProps) {
  const { t, language } = useI18n();
  const sessions = useReplayStore((state) => state.sessions);
  const eventsBySession = useReplayStore((state) => state.eventsBySession);
  const selectedSessionKey = useReplayStore((state) => state.selectedSessionKey);
  const loading = useReplayStore((state) => state.loading);
  const ready = useReplayStore((state) => state.ready);
  const error = useReplayStore((state) => state.error);
  const loadRecentSessions = useReplayStore((state) => state.loadRecentSessions);
  const loadSession = useReplayStore((state) => state.loadSession);
  const selectSession = useReplayStore((state) => state.selectSession);
  const captureCodeSnapshot = useReplayStore((state) => state.captureCodeSnapshot);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReplayFilter>("all");
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);
  const [rollbackPending, setRollbackPending] = useState(false);
  const [forkPending, setForkPending] = useState(false);
  const panelActive = open && visible;

  useEffect(() => {
    if (!panelActive) return;
    void loadRecentSessions();
    if (activeSessionId) void loadSession(activeSessionId);
  }, [activeSessionId, loadRecentSessions, loadSession, panelActive]);

  const selectedSession = sessions.find((session) => session.sessionKey === selectedSessionKey) ?? null;
  const events = selectedSessionKey ? eventsBySession[selectedSessionKey] ?? [] : [];
  const firstTimestamp = events[0]?.timestamp ?? null;
  const latestSnapshot = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].kind === "snapshot") return events[index];
    }
    return null;
  }, [events]);

  const filteredEvents = useMemo(
    () => events.filter((event) => (filter === "all" || event.kind === filter) && eventMatches(event, query)),
    [events, filter, query]
  );

  const selectedEvent = useMemo(() => {
    if (filteredEvents.length === 0) return null;
    if (selectedEventIndex !== null) {
      const exact = filteredEvents.find((event) => event.eventIndex === selectedEventIndex);
      if (exact) return exact;
    }
    return filteredEvents[filteredEvents.length - 1];
  }, [filteredEvents, selectedEventIndex]);

  useEffect(() => {
    if (!selectedEvent) return;
    setSelectedEventIndex(selectedEvent.eventIndex);
  }, [selectedEvent]);

  const handleRollback = async (event: ReplayEvent, latest: ReplayEvent) => {
    const projectPath = getStringPayload(event.payload, "projectPath");
    const targetPatch = getStringPayload(event.payload, "patch");
    const expectedCurrentPatch = getStringPayload(latest.payload, "patch");
    const targetHead = getStringPayload(event.payload, "head");
    if (!selectedSessionKey || !projectPath || targetPatch === null || expectedCurrentPatch === null || !targetHead) return;

    const confirmed = window.confirm(t("aiReplay.rollback.confirm"));
    if (!confirmed) return;

    setRollbackPending(true);
    try {
      await invoke<ReplayWorktreeSnapshot>("git_restore_worktree_snapshot", {
        projectPath,
        targetPatch,
        expectedCurrentPatch,
        targetHead,
      });
      toast.success(t("aiReplay.rollback.success"));
      await captureCodeSnapshot(selectedSessionKey, projectPath, "rollback");
      await loadSession(selectedSessionKey);
    } catch (err) {
      toast.error(t("aiReplay.rollback.failed"), { description: String(err) });
    } finally {
      setRollbackPending(false);
    }
  };

  const handleFork = async (event: ReplayEvent, latest: ReplayEvent) => {
    const projectPath = getStringPayload(event.payload, "projectPath");
    const targetPatch = getStringPayload(event.payload, "patch");
    const expectedCurrentPatch = getStringPayload(latest.payload, "patch");
    const targetHead = getStringPayload(event.payload, "head");
    if (!selectedSessionKey || !projectPath || targetPatch === null || expectedCurrentPatch === null || !targetHead) return;

    const branchName = buildSnapshotForkBranchName(event);
    const confirmed = window.confirm(t("aiReplay.fork.confirm", { branch: branchName }));
    if (!confirmed) return;

    setForkPending(true);
    try {
      await invoke<ReplayWorktreeSnapshot>("git_fork_worktree_snapshot", {
        projectPath,
        targetPatch,
        expectedCurrentPatch,
        targetHead,
        branchName,
      });
      toast.success(t("aiReplay.fork.success"), { description: branchName });
      await captureCodeSnapshot(selectedSessionKey, projectPath, "fork");
      await loadSession(selectedSessionKey);
    } catch (err) {
      toast.error(t("aiReplay.fork.failed"), { description: String(err) });
    } finally {
      setForkPending(false);
    }
  };

  if (!panelActive) return null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-2 font-mono" style={{ backgroundColor: TERM_PANEL.bg }}>
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 py-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ color: TERM_PANEL.cyan, backgroundColor: panelColorTint(TERM_PANEL.cyan, 12) }}>
            <Clock3 size={13} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-bold" style={{ color: TERM_PANEL.fg }}>{t("aiReplay.title")}</div>
            <div className="truncate text-[10px]" style={{ color: TERM_PANEL.dim }}>
              {selectedSession?.title ?? t("aiReplay.noSession")}
            </div>
          </div>
        </div>
        <HeaderPill color={error ? TERM_PANEL.red : ready ? TERM_PANEL.green : TERM_PANEL.yellow}>
          {error ? t("aiReplay.health.error") : ready ? t("aiReplay.health.persisted") : t("aiReplay.health.pending")}
        </HeaderPill>
      </div>

      {sessions.length > 0 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto pb-1 ui-thin-scroll">
          {sessions.map((session) => {
            const selected = session.sessionKey === selectedSessionKey;
            return (
              <button
                key={session.sessionKey}
                type="button"
                className="ui-focus-ring min-w-[116px] rounded-lg border px-2 py-1 text-left transition-colors"
                style={{
                  backgroundColor: selected ? panelColorTint(TERM_PANEL.cyan, 10) : TERM_PANEL.card,
                  borderColor: selected ? panelColorTint(TERM_PANEL.cyan, 36) : TERM_PANEL.border,
                }}
                onClick={() => void selectSession(session.sessionKey)}
              >
                <div className="truncate text-[10px] font-semibold" style={{ color: selected ? TERM_PANEL.cyan : TERM_PANEL.fg }}>
                  {session.title}
                </div>
                <div className="text-[9px]" style={{ color: TERM_PANEL.dim }}>
                  {formatClock(session.updatedAt, language)} · {session.eventCount}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid shrink-0 grid-cols-3 gap-1.5">
        <DetailMetric label={t("aiReplay.metric.events")} value={String(events.length)} color={TERM_PANEL.cyan} />
        <DetailMetric label={t("aiReplay.metric.tools")} value={String(events.filter((event) => event.kind === "tool" || event.kind === "mcp" || event.kind === "skill").length)} color={TERM_PANEL.blue} />
        <DetailMetric label={t("aiReplay.metric.subtasks")} value={String(events.filter((event) => event.kind === "subtask").length)} color={TERM_PANEL.magenta} />
      </div>

      <div className="shrink-0 rounded-lg border p-2" style={{ backgroundColor: TERM_PANEL.card, borderColor: TERM_PANEL.border }}>
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: TERM_PANEL.dim }}>
          <ListFilter size={11} />
          {t("aiReplay.timeline")}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1.5" size={12} style={{ color: TERM_PANEL.dim }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="ui-focus-ring h-7 w-full rounded-md border bg-transparent pl-7 pr-2 text-[11px] outline-none"
            style={{ color: TERM_PANEL.fg, borderColor: TERM_PANEL.border }}
            placeholder={t("aiReplay.search")}
          />
        </div>
        <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5 ui-thin-scroll">
          {FILTERS.map((item) => {
            const selected = filter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className="ui-focus-ring shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold"
                style={{
                  color: selected ? TERM_PANEL.cyan : TERM_PANEL.dim,
                  borderColor: selected ? panelColorTint(TERM_PANEL.cyan, 34) : TERM_PANEL.border,
                  backgroundColor: selected ? panelColorTint(TERM_PANEL.cyan, 8) : "transparent",
                }}
                onClick={() => setFilter(item.key)}
              >
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border p-2 ui-thin-scroll" style={{ backgroundColor: TERM_PANEL.card, borderColor: TERM_PANEL.border }}>
        {loading && events.length === 0 ? (
          <EmptyHint text={t("common.loading")} />
        ) : filteredEvents.length === 0 ? (
          <EmptyHint text={t(error ? "aiReplay.empty.error" : "aiReplay.empty.timeline")} />
        ) : (
          <div className="relative space-y-1.5">
            <div className="absolute bottom-2 left-[53px] top-2 w-px" style={{ backgroundColor: TERM_PANEL.border }} />
            {filteredEvents.map((event) => {
              const meta = KIND_META[event.kind];
              const Icon = meta.icon;
              const selected = selectedEvent?.eventIndex === event.eventIndex;
              const color = meta.color;
              return (
                <button
                  key={`${event.sessionKey}:${event.eventIndex}`}
                  type="button"
                  className="ui-focus-ring relative grid w-full grid-cols-[44px_18px_minmax(0,1fr)] gap-2 rounded-lg border p-2 text-left transition-colors"
                  style={{
                    backgroundColor: selected ? panelColorTint(color, 10) : "transparent",
                    borderColor: selected ? panelColorTint(color, 36) : "transparent",
                  }}
                  onClick={() => setSelectedEventIndex(event.eventIndex)}
                >
                  <div className="text-right tabular-nums">
                    <div className="text-[10px] font-bold" style={{ color }}>{formatClock(event.timestamp, language)}</div>
                    <div className="text-[9px]" style={{ color: TERM_PANEL.dim }}>{formatElapsed(firstTimestamp, event.timestamp)}</div>
                  </div>
                  <span className="z-[1] flex h-[18px] w-[18px] items-center justify-center rounded-full border" style={{ color, backgroundColor: TERM_PANEL.card, borderColor: panelColorTint(color, 45) }}>
                    <Icon size={11} strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[11px] font-bold" style={{ color: TERM_PANEL.fg }}>{event.title}</span>
                      <span className="shrink-0 rounded px-1 py-0.5 text-[9px]" style={{ color: statusColor(event.status), backgroundColor: panelColorTint(statusColor(event.status), 9) }}>
                        {t(STATUS_KEYS[event.status])}
                      </span>
                    </div>
                    <div className="truncate text-[10px]" style={{ color: TERM_PANEL.dim }}>{event.detail || t(meta.labelKey)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <section className="shrink-0 rounded-lg border p-2" style={{ backgroundColor: TERM_PANEL.card, borderColor: TERM_PANEL.border }}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold" style={{ color: TERM_PANEL.fg }}>
            {selectedEvent?.kind === "snapshot" ? <Camera size={12} style={{ color: TERM_PANEL.yellow }} /> : <ShieldCheck size={12} style={{ color: TERM_PANEL.green }} />}
            <span className="truncate">{selectedEvent?.kind === "snapshot" ? t("aiReplay.snapshotDetail") : t("aiReplay.eventDetail")}</span>
          </span>
          {selectedEvent && (
            <span className="shrink-0 text-[10px]" style={{ color: TERM_PANEL.dim }}>#{selectedEvent.eventIndex}</span>
          )}
        </div>
        {!selectedEvent ? (
          <EmptyHint text={t("aiReplay.empty.detail")} />
        ) : selectedEvent.kind === "snapshot" ? (
          <SnapshotDetail
            event={selectedEvent}
            latestSnapshot={latestSnapshot}
            rollbackPending={rollbackPending}
            forkPending={forkPending}
            onRollback={handleRollback}
            onFork={handleFork}
          />
        ) : (
          <GenericDetail event={selectedEvent} />
        )}
      </section>
    </div>
  );
}
