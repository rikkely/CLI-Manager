import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, BarChart3, Folder, GitBranch } from "../icons";
import { TERM_PANEL, getTerminalSidePanelSkinStyle, panelColorTint } from "../stats/termStatsUi";
import { SessionReplayPanel } from "./SessionReplayPanel";
import { TerminalStatsPanel } from "./TerminalStatsPanel";
import { useI18n } from "../../lib/i18n";
import {
  TERMINAL_PANEL_WIDTH_DEFAULTS,
  TERMINAL_PANEL_WIDTH_MAX,
  useSettingsStore,
  type TerminalPanelWidthKey,
} from "../../stores/settingsStore";

const GitChangesPanel = lazy(() =>
  import("../git/GitChangesPanel").then((module) => ({ default: module.GitChangesPanel }))
);

export type TerminalSidePanelTab = "stats" | "replay" | "git" | "files";

interface TerminalSidePanelProps {
  open: boolean;
  activeTab: TerminalSidePanelTab;
  activeSessionId: string | null;
  projectPath: string | null;
  filesTabDisabled?: boolean;
  filesPanelContent?: ReactNode;
  onTabChange: (tab: TerminalSidePanelTab) => void;
}

const MERGED_PANEL_WIDTH_STORAGE_KEY = "cli-manager:terminal-side-panel-width";

const TERMINAL_STATS_PANEL_WIDTH_STORAGE_KEY = "cli-manager:terminal-stats-panel-width";
const TERMINAL_GIT_PANEL_WIDTH_STORAGE_KEY = "cli-manager:terminal-git-panel-width";
const TERMINAL_FILES_PANEL_WIDTH_STORAGE_KEY = "cli-manager:terminal-files-panel-width";
const TERMINAL_REPLAY_PANEL_WIDTH_STORAGE_KEY = "cli-manager:terminal-replay-panel-width";
const LEGACY_WIDTH_STORAGE_KEYS: Record<TerminalPanelWidthKey, string> = {
  merged: MERGED_PANEL_WIDTH_STORAGE_KEY,
  stats: TERMINAL_STATS_PANEL_WIDTH_STORAGE_KEY,
  git: TERMINAL_GIT_PANEL_WIDTH_STORAGE_KEY,
  replay: TERMINAL_REPLAY_PANEL_WIDTH_STORAGE_KEY,
  files: TERMINAL_FILES_PANEL_WIDTH_STORAGE_KEY,
};

interface ResizableTerminalPanelFrameProps {
  widthKey: TerminalPanelWidthKey;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  resizeLabel: string;
  resizeTitle?: string;
  children: ReactNode;
}

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

function readLegacyStoredWidth(widthKey: TerminalPanelWidthKey, defaultWidth: number, minWidth: number, maxWidth: number): number | null {
  if (typeof window === "undefined") return null;
  const storageKey = LEGACY_WIDTH_STORAGE_KEYS[widthKey];
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  if (storageKey === MERGED_PANEL_WIDTH_STORAGE_KEY && parsed === 243) return defaultWidth;
  return clampWidth(parsed, minWidth, maxWidth);
}

export function ResizableTerminalPanelFrame({
  widthKey,
  defaultWidth,
  minWidth = defaultWidth,
  maxWidth = TERMINAL_PANEL_WIDTH_MAX,
  resizeLabel,
  resizeTitle = resizeLabel,
  children,
}: ResizableTerminalPanelFrameProps) {
  const terminalSidePanelSkin = useSettingsStore((s) => s.terminalSidePanelSkin);
  const persistedWidth = useSettingsStore((s) => s.terminalPanelWidths[widthKey]);
  const updateSettings = useSettingsStore((s) => s.update);
  const [width, setWidth] = useState(() => clampWidth(persistedWidth ?? defaultWidth, minWidth, maxWidth));
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(defaultWidth);
  const pendingWidthRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!dragging && persistedWidth !== widthRef.current) {
      setWidth(clampWidth(persistedWidth, minWidth, maxWidth));
    }
  }, [dragging, maxWidth, minWidth, persistedWidth]);

  useEffect(() => {
    if (persistedWidth !== defaultWidth) return;
    const legacyWidth = readLegacyStoredWidth(widthKey, defaultWidth, minWidth, maxWidth);
    if (legacyWidth === null || legacyWidth === persistedWidth) return;
    setWidth(legacyWidth);
    const current = useSettingsStore.getState().terminalPanelWidths;
    void updateSettings("terminalPanelWidths", { ...current, [widthKey]: legacyWidth });
  }, [defaultWidth, maxWidth, minWidth, persistedWidth, updateSettings, widthKey]);

  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.style.width = `${width}px`;
    }
  }, [width]);

  useEffect(() => {
    if (!dragging) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const commitPendingWidth = () => {
      if (pendingWidthRef.current === null) return;
      if (panelRef.current) {
        panelRef.current.style.width = `${pendingWidthRef.current}px`;
      }
      frameRef.current = null;
    };

    const handleMouseMove = (event: MouseEvent) => {
      pendingWidthRef.current = clampWidth(dragStartWidthRef.current + dragStartXRef.current - event.clientX, minWidth, maxWidth);
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(commitPendingWidth);
      }
    };

    const handleMouseUp = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      const finalWidth = clampWidth(pendingWidthRef.current ?? widthRef.current, minWidth, maxWidth);
      pendingWidthRef.current = null;
      if (panelRef.current) {
        panelRef.current.style.width = `${finalWidth}px`;
      }
      setWidth(finalWidth);
      const current = useSettingsStore.getState().terminalPanelWidths;
      void updateSettings("terminalPanelWidths", { ...current, [widthKey]: finalWidth });
      setDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging, maxWidth, minWidth, updateSettings, widthKey]);

  const handleResizeMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragStartXRef.current = event.clientX;
    dragStartWidthRef.current = widthRef.current;
    pendingWidthRef.current = widthRef.current;
    setDragging(true);
  }, []);

  return (
    <aside
      ref={panelRef}
      className="ui-terminal-side-panel-frame relative flex shrink-0 flex-col overflow-hidden border-l border-border font-mono"
      data-dragging={dragging ? "true" : undefined}
      style={{
        width,
        minWidth,
        maxWidth,
        ...getTerminalSidePanelSkinStyle(terminalSidePanelSkin),
        backgroundColor: TERM_PANEL.bg,
        borderColor: TERM_PANEL.border,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={resizeLabel}
        title={resizeTitle}
        className={`absolute left-0 top-0 z-20 h-full w-2 -translate-x-1/2 cursor-col-resize transition-colors ${dragging ? "bg-primary/35" : "hover:bg-primary/25"}`}
        onMouseDown={handleResizeMouseDown}
      />
      {children}
    </aside>
  );
}

export function TerminalSidePanel({
  open,
  activeTab,
  activeSessionId,
  projectPath,
  filesTabDisabled = false,
  filesPanelContent = null,
  onTabChange,
}: TerminalSidePanelProps) {
  const { t } = useI18n();

  if (!open) return null;

  const tabs = [
    { key: "stats" as const, label: t("terminal.panel.sideStats"), color: TERM_PANEL.cyan, icon: <BarChart3 size={12} strokeWidth={1.8} /> },
    { key: "replay" as const, label: t("terminal.panel.replay"), color: TERM_PANEL.magenta, icon: <Activity size={12} strokeWidth={1.8} /> },
    { key: "git" as const, label: t("terminal.panel.gitChanges"), color: TERM_PANEL.yellow, icon: <GitBranch size={12} strokeWidth={1.8} /> },
    { key: "files" as const, label: t("terminal.panel.files"), color: TERM_PANEL.blue, icon: <Folder size={12} strokeWidth={1.8} />, disabled: filesTabDisabled },
  ];

  return (
    <ResizableTerminalPanelFrame
      widthKey="merged"
      defaultWidth={TERMINAL_PANEL_WIDTH_DEFAULTS.merged}
      resizeLabel={t("terminal.panel.resizeSideLabel")}
      resizeTitle={t("terminal.panel.resizeSideTitle")}
    >
      <div
        className="flex shrink-0 gap-1 border-b px-2 py-1.5"
        style={{ borderColor: TERM_PANEL.border }}
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              disabled={tab.disabled}
              className="ui-focus-ring flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded px-1.5 py-1 text-[11px] font-bold transition-colors"
              style={{
                color: selected ? tab.color : TERM_PANEL.dim,
                backgroundColor: selected ? panelColorTint(tab.color, 10) : "transparent",
                border: `1px solid ${selected ? panelColorTint(tab.color, 34) : "transparent"}`,
                opacity: tab.disabled ? 0.45 : 1,
              }}
              aria-pressed={selected}
            >
              <span className="shrink-0" style={{ color: tab.color }}>{tab.icon}</span>
              <span className="min-w-0 truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <TerminalStatsPanel activeSessionId={activeSessionId} open={open} visible={activeTab === "stats"} embedded />
        <SessionReplayPanel activeSessionId={activeSessionId} open={open} visible={activeTab === "replay"} />
        {activeTab === "git" && (
          <Suspense fallback={null}>
            <GitChangesPanel open={open} projectPath={projectPath} visible embedded />
          </Suspense>
        )}
        {activeTab === "files" ? filesPanelContent : null}
      </div>
    </ResizableTerminalPanelFrame>
  );
}
