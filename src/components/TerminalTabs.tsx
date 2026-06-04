import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useShallow } from "zustand/shallow";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTerminalStore, type TabNotificationState } from "../stores/terminalStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useProjectStore } from "../stores/projectStore";
import { SplitTerminalView } from "./SplitTerminalView";
import { CommandTemplatePanel } from "./CommandTemplatePanel";
import { CommandHistoryPanel } from "./CommandHistoryPanel";
import { HistoryWorkspace } from "./HistoryWorkspace";
import { openWindowsTerminal } from "../lib/externalTerminal";
import { ChevronDown, ChevronRight, Terminal, Plus, Search, X, Maximize2, Minimize2 } from "./icons";
import { EmptyState } from "./ui/EmptyState";
import { useHistoryStore } from "../stores/historyStore";
import type { HistorySourceFilter } from "../lib/types";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/context-menu";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { getTerminalBackground } from "../lib/terminalThemes";

const TAB_NOTIFICATION_COLORS: Record<TabNotificationState, string> = {
  none: "#565f89",
  running: "#8b5cf6",
  attention: "#ff9e64",
  done: "#8fbf7f",
  failed: "#f7768e",
};

const TAB_NOTIFICATION_LABELS: Record<TabNotificationState, string> = {
  none: "无运行状态",
  running: "运行中",
  attention: "待审批",
  done: "已完成",
  failed: "异常退出",
};

const PULSING_TAB_STATES = new Set<TabNotificationState>(["running", "attention"]);
const HISTORY_TAB_ID = "history-workspace-tab";
const HISTORY_TAB_START_ANCHOR_ID = "history-workspace-tab-start";

function resolveHistorySourceFilter(cliTool: string | null | undefined): HistorySourceFilter {
  const normalized = cliTool?.trim().toLowerCase();
  if (!normalized) return "all";
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("codex") || normalized === "code") return "codex";
  return "all";
}

function formatTabStatusUpdatedAt(value: string | null | undefined): string {
  if (!value) return "无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

interface SortableTabProps {
  id: string;
  title: string;
  isActive: boolean;
  isEditing: boolean;
  notification: TabNotificationState;
  statusUpdatedAt: string | null;
  onActivate: () => void;
  onClose: () => void;
  onStartEdit: () => void;
  onSubmitEdit: (title: string) => void;
  onCancelEdit: () => void;
  onRegisterElement: (id: string, element: HTMLDivElement | null) => void;
  menuContent: ReactNode;
}

function SortableTab({
  id,
  title,
  isActive,
  isEditing,
  notification,
  statusUpdatedAt,
  onActivate,
  onClose,
  onStartEdit,
  onSubmitEdit,
  onCancelEdit,
  onRegisterElement,
  menuContent,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [editValue, setEditValue] = useState(title);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const skipNextBlurSubmitRef = useRef(false);
  const statusLabel = TAB_NOTIFICATION_LABELS[notification];
  const statusTitle = `状态：${statusLabel}\n会话：${title}\n更新时间：${formatTabStatusUpdatedAt(statusUpdatedAt)}`;
  const tabMinWidthClass = notification === "none" ? "min-w-[92px]" : "min-w-[118px]";

  const setTabRef = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      onRegisterElement(id, element);
    },
    [id, onRegisterElement, setNodeRef]
  );

  const submitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed) onSubmitEdit(trimmed);
    else onCancelEdit();
  }, [editValue, onCancelEdit, onSubmitEdit]);

  const cancelEdit = useCallback(() => {
    onCancelEdit();
  }, [onCancelEdit]);

  useEffect(() => {
    if (!isEditing) return;
    setEditValue(title);
    skipNextBlurSubmitRef.current = false;
    window.requestAnimationFrame(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    });
  }, [isEditing, title]);

  const horizontalTransform = transform ? { ...transform, y: 0 } : transform;
  const style = {
    transform: CSS.Transform.toString(horizontalTransform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setTabRef}
          style={style}
          className={`ui-interactive ui-tab-trigger mx-1 flex h-7 ${tabMinWidthClass} max-w-[180px] shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-[12px] font-medium`}
          data-selected={isActive ? "true" : "false"}
          onClick={onActivate}
          onDoubleClick={onStartEdit}
          aria-selected={isActive}
          {...attributes}
          {...listeners}
        >
          <span
            className="ui-tab-runtime-dot w-2 h-2 rounded-full shrink-0"
            data-pulsing={PULSING_TAB_STATES.has(notification) ? "true" : "false"}
            style={{ backgroundColor: TAB_NOTIFICATION_COLORS[notification], color: TAB_NOTIFICATION_COLORS[notification] }}
            role="status"
            aria-label={statusLabel}
            title={statusTitle}
          />
          {isEditing ? (
            <input
              ref={editInputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerMove={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  skipNextBlurSubmitRef.current = true;
                  submitEdit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  skipNextBlurSubmitRef.current = true;
                  cancelEdit();
                }
              }}
              onBlur={() => {
                if (skipNextBlurSubmitRef.current) {
                  skipNextBlurSubmitRef.current = false;
                  return;
                }
                submitEdit();
              }}
              className="ui-input h-5 min-w-0 flex-1 rounded-md px-1.5 py-0 text-[12px] text-on-surface outline-none"
              aria-label={`重命名终端 ${title}`}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate tracking-[0.01em]" title={statusTitle}>{title}</span>
          )}
          {notification !== "none" && (
            <span className="shrink-0 text-[10px] leading-none text-on-surface-variant" title={statusTitle}>
              {statusLabel}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="ui-terminal-tab-close ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-[background-color,color,opacity,box-shadow] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
            aria-label={`关闭终端 ${title}`}
            title={`关闭终端 ${title}`}
          >
            <X size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>{menuContent}</ContextMenuContent>
    </ContextMenu>
  );
}

interface SortableHistoryTabProps {
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onNewTab: () => void;
  onRegisterElement: (id: string, element: HTMLDivElement | null) => void;
}

function SortableHistoryTab({ isActive, onActivate, onClose, onNewTab, onRegisterElement }: SortableHistoryTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: HISTORY_TAB_ID });

  const setTabRef = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      onRegisterElement(HISTORY_TAB_ID, element);
    },
    [onRegisterElement, setNodeRef]
  );

  const horizontalTransform = transform ? { ...transform, y: 0 } : transform;
  const style = {
    transform: CSS.Transform.toString(horizontalTransform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setTabRef}
          style={style}
          className="ui-interactive ui-tab-trigger mx-1 flex h-7 min-w-[118px] max-w-[180px] shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-[12px] font-medium"
          data-selected={isActive ? "true" : "false"}
          onClick={onActivate}
          aria-selected={isActive}
          {...attributes}
          {...listeners}
        >
          <Search size={13} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
          <span className="max-w-[140px] truncate tracking-[0.01em]" title="会话历史">会话历史</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="ui-terminal-tab-close ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-[background-color,color,opacity,box-shadow] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
            aria-label="关闭会话历史"
            title="关闭会话历史"
          >
            <X size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onClose}>关闭会话历史</ContextMenuItem>
        <ContextMenuItem onSelect={onNewTab}>新建终端</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface TerminalTabsProps {
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export function TerminalTabs({ fullscreen = false, onToggleFullscreen }: TerminalTabsProps = {}) {
  const { sessions, activeSessionId, tabNotifications, tabStatusDetails, splits } = useTerminalStore(
    useShallow((s) => ({
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      tabNotifications: s.tabNotifications,
      tabStatusDetails: s.tabStatusDetails,
      splits: s.splits,
    }))
  );
  const setActive = useTerminalStore((s) => s.setActive);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const createSession = useTerminalStore((s) => s.createSession);
  const reorderSessions = useTerminalStore((s) => s.reorderSessions);
  const renameSession = useTerminalStore((s) => s.renameSession);
  const splitTerminal = useTerminalStore((s) => s.splitTerminal);
  const unsplitTerminal = useTerminalStore((s) => s.unsplitTerminal);
  const hiddenBackgroundSessionIds = useTerminalStore((s) => s.hiddenBackgroundSessionIds);
  const hideBackgroundForSession = useTerminalStore((s) => s.hideBackgroundForSession);
  const showBackgroundForSession = useTerminalStore((s) => s.showBackgroundForSession);
  const projects = useProjectStore((s) => s.projects);
  const useExternalTerminal = useSettingsStore((s) => s.useExternalTerminal);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const terminalThemeMode = useSettingsStore((s) => s.terminalThemeMode);
  const terminalThemeName = useSettingsStore((s) => s.terminalThemeName);
  const lightThemePalette = useSettingsStore((s) => s.lightThemePalette);
  const darkThemePalette = useSettingsStore((s) => s.darkThemePalette);
  const terminalBackgroundEnabled = useSettingsStore((s) => s.terminalBackground.enabled);
  const terminalBackgroundImagePath = useSettingsStore((s) => s.terminalBackground.imagePath);
  const terminalToolbarVisibility = useSettingsStore((s) => s.terminalToolbarVisibility);
  const historyOpen = useHistoryStore((s) => s.isOpen);
  const openHistory = useHistoryStore((s) => s.openHistory);
  const focusGlobalSearchSeq = useHistoryStore((s) => s.focusGlobalSearchSeq);
  const tabScrollRef = useRef<HTMLDivElement | null>(null);
  const tabElementsRef = useRef(new Map<string, HTMLDivElement>());
  const activeSessionIdRef = useRef(activeSessionId);
  const [tabListOpen, setTabListOpen] = useState(false);
  const [tabScrollState, setTabScrollState] = useState({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"terminal" | "history">("terminal");
  const [historyTabAnchorId, setHistoryTabAnchorId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const updateTabScrollState = useCallback(() => {
    const element = tabScrollRef.current;
    if (!element) return;

    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    const next = {
      hasOverflow: maxScrollLeft > 1,
      canScrollLeft: element.scrollLeft > 1,
      canScrollRight: element.scrollLeft < maxScrollLeft - 1,
    };
    setTabScrollState((current) => (
      current.hasOverflow === next.hasOverflow
        && current.canScrollLeft === next.canScrollLeft
        && current.canScrollRight === next.canScrollRight
        ? current
        : next
    ));
  }, []);

  const registerTabElement = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) {
      tabElementsRef.current.set(id, element);
    } else {
      tabElementsRef.current.delete(id);
    }
  }, []);

  const activateHistoryTab = useCallback(() => {
    setActiveWorkspaceTab("history");
  }, []);

  const handleOpenHistoryTab = useCallback(() => {
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    const project = activeSession?.projectId ? projects.find((item) => item.id === activeSession.projectId) : undefined;
    setHistoryTabAnchorId((current) => current ?? activeSessionId);
    setActiveWorkspaceTab("history");
    void openHistory({
      sourceFilter: resolveHistorySourceFilter(project?.cli_tool),
      projectPath: project?.path ?? null,
    });
  }, [activeSessionId, openHistory, projects, sessions]);

  const handleCloseHistoryTab = useCallback(() => {
    setActiveWorkspaceTab("terminal");
    setHistoryTabAnchorId(null);
    useHistoryStore.getState().closeHistory();
  }, []);

  const handleNewTab = useCallback(async () => {
    if (useExternalTerminal) {
      await openWindowsTerminal([{ title: "Terminal" }]);
      return;
    }
    await createSession(undefined, undefined, "Terminal");
    setActiveWorkspaceTab("terminal");
  }, [useExternalTerminal, createSession]);

  const handleSelectFromList = useCallback((sessionId: string) => {
    if (sessionId === HISTORY_TAB_ID) {
      activateHistoryTab();
    } else {
      setActive(sessionId);
      setActiveWorkspaceTab("terminal");
    }
    setTabListOpen(false);
  }, [activateHistoryTab, setActive]);

  const scrollTabs = useCallback(
    (direction: "left" | "right") => {
      const element = tabScrollRef.current;
      if (!element) return;

      const distance = Math.max(Math.floor(element.clientWidth * 0.72), 160);
      element.scrollBy({
        left: direction === "left" ? -distance : distance,
        behavior: "smooth",
      });
      window.requestAnimationFrame(updateTabScrollState);
    },
    [updateTabScrollState]
  );

  const handleCloseOthers = useCallback(
    (sessionId: string) => {
      sessions.filter((s) => s.id !== sessionId).forEach((s) => closeSession(s.id));
    },
    [sessions, closeSession]
  );

  const handleSplit = useCallback(
    (sessionId: string, direction: "horizontal" | "vertical") => {
      const session = sessions.find((s) => s.id === sessionId);
      const project = session?.projectId ? projects.find((p) => p.id === session.projectId) : undefined;
      splitTerminal(sessionId, direction, project?.path, project?.shell);
    },
    [sessions, projects, splitTerminal]
  );

  const historyActive = historyOpen && activeWorkspaceTab === "history";
  const showToolbarText = terminalToolbarVisibility.showText;
  const sessionIds = sessions.map((s) => s.id);
  const historyTabItem = { id: HISTORY_TAB_ID, title: "会话历史" };
  const historyAnchorIndex = historyTabAnchorId && historyTabAnchorId !== HISTORY_TAB_START_ANCHOR_ID
    ? sessions.findIndex((s) => s.id === historyTabAnchorId)
    : -1;
  const tabListItems = historyOpen
    ? historyTabAnchorId === HISTORY_TAB_START_ANCHOR_ID
      ? [historyTabItem, ...sessions]
      : historyAnchorIndex >= 0
        ? [
            ...sessions.slice(0, historyAnchorIndex + 1),
            historyTabItem,
            ...sessions.slice(historyAnchorIndex + 1),
          ]
        : [...sessions, historyTabItem]
    : sessions;
  const sortableTabIds = historyOpen ? tabListItems.map((item) => item.id) : sessionIds;
  const effectiveTerminalThemeName = terminalThemeMode === "follow-app" ? "auto" : terminalThemeName;
  const terminalBridgeColor = getTerminalBackground(
    effectiveTerminalThemeName,
    resolvedTheme,
    lightThemePalette,
    darkThemePalette
  );
  const terminalWellStyle: CSSProperties = {
    "--terminal-bridge-color": terminalBridgeColor,
  } as CSSProperties;
  const historyTabNode = historyOpen ? (
    <SortableHistoryTab
      isActive={historyActive}
      onActivate={activateHistoryTab}
      onClose={handleCloseHistoryTab}
      onNewTab={() => void handleNewTab()}
      onRegisterElement={registerTabElement}
    />
  ) : null;

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === HISTORY_TAB_ID) {
      const oldIndex = tabListItems.findIndex((item) => item.id === HISTORY_TAB_ID);
      const overIndex = tabListItems.findIndex((item) => item.id === overId);
      if (oldIndex < 0 || overIndex < 0) return;

      const nextItems = [...tabListItems];
      const [historyItem] = nextItems.splice(oldIndex, 1);
      nextItems.splice(overIndex, 0, historyItem);
      const nextIndex = nextItems.findIndex((item) => item.id === HISTORY_TAB_ID);
      const previousItem = nextIndex > 0 ? nextItems[nextIndex - 1] : null;
      setHistoryTabAnchorId(previousItem?.id ?? HISTORY_TAB_START_ANCHOR_ID);
      return;
    }

    if (overId === HISTORY_TAB_ID) return;
    reorderSessions(activeId, overId);
  }, [reorderSessions, tabListItems]);

  useEffect(() => {
    const element = tabScrollRef.current;
    if (!element) return;

    updateTabScrollState();
    element.addEventListener("scroll", updateTabScrollState, { passive: true });

    const resizeObserver = new ResizeObserver(updateTabScrollState);
    resizeObserver.observe(element);

    return () => {
      element.removeEventListener("scroll", updateTabScrollState);
      resizeObserver.disconnect();
    };
  }, [updateTabScrollState]);

  useEffect(() => {
    updateTabScrollState();
  }, [sessions.length, historyOpen, updateTabScrollState]);

  useEffect(() => {
    if (!historyOpen && activeWorkspaceTab === "history") {
      setActiveWorkspaceTab("terminal");
    }
    if (!historyOpen && historyTabAnchorId !== null) {
      setHistoryTabAnchorId(null);
    }
  }, [activeWorkspaceTab, historyOpen, historyTabAnchorId]);

  useEffect(() => {
    if (!historyOpen) return;
    setHistoryTabAnchorId((current) => current ?? activeSessionIdRef.current);
    setActiveWorkspaceTab("history");
  }, [focusGlobalSearchSeq, historyOpen]);

  useEffect(() => {
    const activeTabId = historyActive ? HISTORY_TAB_ID : activeSessionId;
    if (!activeTabId) return;
    const element = tabElementsRef.current.get(activeTabId);
    if (!element) return;

    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    window.requestAnimationFrame(updateTabScrollState);
  }, [activeSessionId, historyActive, sessions.length, updateTabScrollState]);

  useEffect(() => {
    if (!tabScrollState.hasOverflow && tabListOpen) setTabListOpen(false);
  }, [tabListOpen, tabScrollState.hasOverflow]);

  return (
    <div className="ui-terminal-tabs-shell flex h-full min-h-0 flex-col" data-fullscreen={fullscreen ? "true" : "false"}>
      <div className="ui-terminal-chrome">
        {tabScrollState.hasOverflow && (
          <button
            type="button"
            onClick={() => scrollTabs("left")}
            disabled={!tabScrollState.canScrollLeft}
            className="ui-focus-ring ui-icon-action ui-terminal-tab-scroll-button ui-terminal-tab-scroll-button-left"
            title="向左滚动终端 Tab"
            aria-label="向左滚动终端 Tab"
          >
            <ChevronRight size={14} strokeWidth={1.8} className="rotate-180" />
          </button>
        )}
        <div
          ref={tabScrollRef}
          className="ui-terminal-tab-scroll flex h-full min-w-0 flex-1 items-center overflow-x-auto px-1.5"
          data-can-scroll-left={tabScrollState.canScrollLeft ? "true" : "false"}
          data-can-scroll-right={tabScrollState.canScrollRight ? "true" : "false"}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortableTabIds} strategy={horizontalListSortingStrategy}>
              {tabListItems.map((item) => {
                if (item.id === HISTORY_TAB_ID) {
                  return <div key={HISTORY_TAB_ID} className="contents">{historyTabNode}</div>;
                }

                const s = item;
                const isSplit = !!splits[s.id];
                return (
                  <SortableTab
                    key={s.id}
                    id={s.id}
                    title={s.title}
                    isActive={!historyActive && s.id === activeSessionId}
                    isEditing={editingSessionId === s.id}
                    notification={tabNotifications[s.id] ?? "none"}
                    statusUpdatedAt={tabStatusDetails[s.id]?.updatedAt ?? null}
                    onActivate={() => {
                      setActiveWorkspaceTab("terminal");
                      setActive(s.id);
                    }}
                    onClose={() => closeSession(s.id)}
                    onStartEdit={() => setEditingSessionId(s.id)}
                    onSubmitEdit={(title) => {
                      renameSession(s.id, title);
                      setEditingSessionId(null);
                    }}
                    onCancelEdit={() => setEditingSessionId(null)}
                    onRegisterElement={registerTabElement}
                    menuContent={
                      <>
                        <ContextMenuItem
                          onSelect={() => {
                            setActive(s.id);
                            closeSession(s.id);
                          }}
                        >
                          关闭终端
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => {
                            setActive(s.id);
                            handleCloseOthers(s.id);
                          }}
                        >
                          关闭其它终端
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => void handleNewTab()}>
                          新建终端
                        </ContextMenuItem>
                        {terminalBackgroundEnabled && terminalBackgroundImagePath && (
                          hiddenBackgroundSessionIds.has(s.id) ? (
                            <ContextMenuItem onSelect={() => showBackgroundForSession(s.id)}>
                              显示背景图
                            </ContextMenuItem>
                          ) : (
                            <ContextMenuItem onSelect={() => hideBackgroundForSession(s.id)}>
                              隐藏背景图
                            </ContextMenuItem>
                          )
                        )}
                        <ContextMenuSeparator />
                        {isSplit ? (
                          <ContextMenuItem onSelect={() => unsplitTerminal(s.id)}>
                            取消分屏
                          </ContextMenuItem>
                        ) : (
                          <>
                            <ContextMenuItem onSelect={() => handleSplit(s.id, "horizontal")}>
                              水平分屏
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => handleSplit(s.id, "vertical")}>
                              垂直分屏
                            </ContextMenuItem>
                          </>
                        )}
                      </>
                    }
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
        {tabScrollState.hasOverflow && (
          <button
            type="button"
            onClick={() => scrollTabs("right")}
            disabled={!tabScrollState.canScrollRight}
            className="ui-focus-ring ui-icon-action ui-terminal-tab-scroll-button ui-terminal-tab-scroll-button-right"
            title="向右滚动终端 Tab"
            aria-label="向右滚动终端 Tab"
          >
            <ChevronRight size={14} strokeWidth={1.8} />
          </button>
        )}
        <div className="ui-terminal-actions flex h-full shrink-0 items-center gap-2 px-2.5">
          {tabScrollState.hasOverflow && (
            <Popover open={tabListOpen} onOpenChange={setTabListOpen}>
              <PopoverTrigger asChild>
                <button
                  className="ui-focus-ring ui-icon-action"
                  data-active={tabListOpen ? "true" : "false"}
                  title="更多终端 Tab"
                  aria-label="打开终端 Tab 列表"
                  aria-expanded={tabListOpen}
                  aria-controls="terminal-tab-list"
                >
                  <ChevronDown size={14} strokeWidth={1.8} />
                </button>
              </PopoverTrigger>
              <PopoverContent id="terminal-tab-list" align="end" className="w-72">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs font-semibold text-on-surface">终端 Tab</span>
                  <span className="text-[10px] text-on-surface-variant">{tabListItems.length}</span>
                </div>
                <div className="max-h-72 overflow-y-auto p-1.5">
                  {tabListItems.map((session) => {
                    const isHistoryTab = session.id === HISTORY_TAB_ID;
                    const notification = isHistoryTab ? "none" : (tabNotifications[session.id] ?? "none");
                    const isActive = isHistoryTab ? historyActive : !historyActive && session.id === activeSessionId;
                    return (
                      <button
                        key={session.id}
                        onClick={() => handleSelectFromList(session.id)}
                        className="ui-interactive flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-on-surface-variant"
                        data-selected={isActive ? "true" : "false"}
                        aria-current={isActive ? "page" : undefined}
                        title={session.title}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: TAB_NOTIFICATION_COLORS[notification] }}
                          aria-label={TAB_NOTIFICATION_LABELS[notification]}
                          title={TAB_NOTIFICATION_LABELS[notification]}
                        />
                        <span className="min-w-0 flex-1 truncate text-on-surface">{session.title}</span>
                        {isActive && <span className="shrink-0 text-[10px] text-primary">当前</span>}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <button
            onClick={handleNewTab}
            className="ui-flat-action ui-toolbar-button ui-primary-action"
            title="新建终端"
            aria-label="新建终端"
          >
            <Plus size={12} strokeWidth={2} />
            <Terminal size={14} strokeWidth={1.5} />
            <span>新建</span>
          </button>
          {terminalToolbarVisibility.templates && <CommandTemplatePanel showText={showToolbarText} />}
          {terminalToolbarVisibility.commandHistory && <CommandHistoryPanel compact showText={showToolbarText} />}
          {terminalToolbarVisibility.fullscreen && onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className={showToolbarText ? "ui-flat-action ui-toolbar-button" : "ui-focus-ring ui-icon-action"}
              data-active={fullscreen ? "true" : "false"}
              title={fullscreen ? "退出沉浸式全屏" : "沉浸式全屏"}
              aria-label={fullscreen ? "退出沉浸式全屏" : "进入沉浸式全屏"}
              aria-pressed={fullscreen}
            >
              {fullscreen ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
              {showToolbarText && <span>{fullscreen ? "退出全屏" : "全屏"}</span>}
            </button>
          )}
          {terminalToolbarVisibility.sessionHistory && (
            <button
              onClick={handleOpenHistoryTab}
              className={
                showToolbarText
                  ? `ui-flat-action ui-toolbar-button ${historyOpen ? "ui-primary-action" : "ui-history-primary"}`
                  : "ui-focus-ring ui-icon-action"
              }
              data-active={historyOpen ? "true" : "false"}
              title="会话历史（Ctrl+K）"
              aria-label="打开会话历史 Tab"
              aria-controls="history-workspace"
              aria-expanded={historyOpen}
            >
              <Search size={13} strokeWidth={1.8} />
              {showToolbarText && <span>会话历史</span>}
            </button>
          )}
        </div>
      </div>

      <div className={`relative flex-1 min-h-0 overflow-hidden ${fullscreen ? "px-0 pb-0 pt-0" : "px-3 pb-3 pt-3"}`}>
        {historyOpen && (
          <div
            className={`absolute min-h-0 overflow-hidden ${fullscreen ? "inset-x-0 bottom-0 top-0" : "inset-x-3 bottom-3 top-3"}`}
            style={{ display: historyActive ? "block" : "none" }}
          >
            <HistoryWorkspace active={historyActive} />
          </div>
        )}
        <div
          className={`ui-terminal-well absolute min-h-0 ${fullscreen ? "inset-x-0 bottom-0 top-0" : "inset-x-3 bottom-3 top-3"}`}
          data-terminal-mode={terminalThemeMode}
          style={{ ...terminalWellStyle, display: historyActive ? "none" : "block" }}
        >
          {sessions.map((s) => (
            <div
              key={s.id}
              className="absolute inset-0"
              style={{ display: s.id === activeSessionId ? "block" : "none" }}
            >
              <SplitTerminalView
                sessionId={s.id}
                split={splits[s.id]}
                isActive={!historyActive && s.id === activeSessionId}
                fontSize={fontSize}
                fontFamily={fontFamily}
                resolvedTheme={resolvedTheme}
                terminalThemeName={effectiveTerminalThemeName}
                lightThemePalette={lightThemePalette}
                darkThemePalette={darkThemePalette}
              />
            </div>
          ))}
          {sessions.length === 0 && !useExternalTerminal && (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<Terminal size={40} strokeWidth={1} />}
                title="无活跃终端"
                description="Ctrl+Shift+T 新建终端，或从左侧项目列表双击启动"
                tone="inverse"
                action={{ label: "打开终端", onClick: handleNewTab }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
