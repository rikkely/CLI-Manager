import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Folder, RefreshCw, Search, Star, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import type { Group, HistorySearchHit, HistorySessionView, HistorySourceFilter, Project } from "../../lib/types";
import { useSettingsStore } from "../../stores/settingsStore";
import { VendorIcon, inferVendor } from "../VendorIcon";
import { Portal } from "../ui/Portal";
import { formatTime, makeSessionLabel } from "./historyViewUtils";

interface SessionGroup {
  label: string;
  items: HistorySessionView[];
}

type HistoryListRow =
  | { type: "loading"; id: string }
  | { type: "searching"; id: string }
  | { type: "searchHeader"; id: string; count: number }
  | { type: "searchHit"; id: string; hit: HistorySearchHit }
  | { type: "group"; id: string; label: string }
  | { type: "session"; id: string; item: HistorySessionView }
  | { type: "empty"; id: string }
  | { type: "loadMore"; id: string };

type SessionContextMenu = {
  session: HistorySessionView;
  x: number;
  y: number;
};

type HistoryProjectTreeNode =
  | { type: "group"; group: Group; children: HistoryProjectTreeNode[] }
  | { type: "project"; project: Project };

interface HistoryListPaneProps {
  historySidebarWidth: number;
  sidebarRef: RefObject<HTMLElement | null>;
  sessionListRef: RefObject<HTMLDivElement | null>;
  sourceFilter: HistorySourceFilter;
  projectPathFilter: string | null;
  projects: Project[];
  groups: Group[];
  globalQuery: string;
  activeSessionKey: string | null;
  loadingSessions: boolean;
  loadingMoreSessions: boolean;
  searching: boolean;
  normalizedGlobal: string;
  groupedSessions: SessionGroup[];
  filteredSessionCount: number;
  hasMoreSessions: boolean;
  loadMoreSessionMode: "local" | "backend";
  visibleSessionCount: number;
  searchHits: HistorySearchHit[];
  globalSearchRef: RefObject<HTMLInputElement | null>;
  onRefresh: () => void;
  onSourceFilterChange: (value: HistorySourceFilter) => void;
  onProjectPathFilterChange: (value: string | null) => void;
  onGlobalQueryChange: (value: string) => void;
  onOpenSession: (sessionKey: string) => void;
  onDeleteSession: (session: HistorySessionView) => void;
  onOpenHit: (hit: HistorySearchHit) => void;
  onLoadMoreSessions: () => void;
  onSessionListScroll: () => void;
  onStartResize: (e: ReactMouseEvent) => void;
}

const SOURCE_FILTER_OPTIONS: { value: HistorySourceFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
];

function rowHeight(row: HistoryListRow): number {
  if (row.type === "group" || row.type === "searchHeader" || row.type === "searching") return 32;
  if (row.type === "loading" || row.type === "empty" || row.type === "loadMore") return 56;
  if (row.type === "searchHit") return 72;
  return 96;
}

function buildHistoryProjectTree(groups: Group[], projects: Project[]): HistoryProjectTreeNode[] {
  const childGroups = new Map<string | null, Group[]>();
  const groupProjects = new Map<string | null, Project[]>();

  for (const group of groups) {
    const list = childGroups.get(group.parent_id) ?? [];
    list.push(group);
    childGroups.set(group.parent_id, list);
  }

  for (const project of projects) {
    const list = groupProjects.get(project.group_id) ?? [];
    list.push(project);
    groupProjects.set(project.group_id, list);
  }

  const buildLevel = (parentId: string | null): HistoryProjectTreeNode[] => {
    const nodes: HistoryProjectTreeNode[] = [];
    const sortedGroups = [...(childGroups.get(parentId) ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
    const sortedProjects = [...(groupProjects.get(parentId) ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );

    for (const group of sortedGroups) {
      nodes.push({ type: "group", group, children: buildLevel(group.id) });
    }
    for (const project of sortedProjects) {
      nodes.push({ type: "project", project });
    }
    return nodes;
  };

  return buildLevel(null);
}

function countProjects(node: HistoryProjectTreeNode): number {
  if (node.type === "project") return 1;
  return node.children.reduce((sum, child) => sum + countProjects(child), 0);
}

function ProjectFilterIcon({ project, size = 13 }: { project: Project; size?: number }) {
  const vendor = project.cli_tool ? inferVendor(project.cli_tool) : null;
  return vendor ? <VendorIcon vendor={vendor} size={size} /> : <Terminal size={size} strokeWidth={1.5} />;
}

export function HistoryListPane({
  historySidebarWidth,
  sidebarRef,
  sessionListRef,
  sourceFilter,
  projectPathFilter,
  projects,
  groups,
  globalQuery,
  activeSessionKey,
  loadingSessions,
  loadingMoreSessions,
  searching,
  normalizedGlobal,
  groupedSessions,
  filteredSessionCount,
  hasMoreSessions,
  loadMoreSessionMode,
  visibleSessionCount,
  searchHits,
  globalSearchRef,
  onRefresh,
  onSourceFilterChange,
  onProjectPathFilterChange,
  onGlobalQueryChange,
  onOpenSession,
  onDeleteSession,
  onOpenHit,
  onLoadMoreSessions,
  onSessionListScroll,
  onStartResize,
}: HistoryListPaneProps) {
  const sessionHistoryShortcut = useSettingsStore((s) => s.keyboardShortcuts.sessionHistory);
  const sessionHistoryShortcutHint = sessionHistoryShortcut.trim() || "未设置快捷键";
  const [contextMenu, setContextMenu] = useState<SessionContextMenu | null>(null);
  const [collapsedFilterGroups, setCollapsedFilterGroups] = useState<Set<string>>(new Set());
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const projectDropdownRef = useRef<HTMLDivElement | null>(null);

  const projectTree = useMemo(() => buildHistoryProjectTree(groups, projects), [groups, projects]);
  const selectedProject = useMemo(
    () => projects.find((project) => project.path === projectPathFilter) ?? null,
    [projectPathFilter, projects]
  );
  const selectedProjectLabel = useMemo(() => {
    if (selectedProject) return selectedProject.name;
    if (!projectPathFilter) return "全部项目";
    return projectPathFilter.split(/[\\/]/).pop() || projectPathFilter;
  }, [projectPathFilter, selectedProject]);

  const toggleFilterGroup = useCallback((groupId: string) => {
    setCollapsedFilterGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handleProjectFilterChange = useCallback(
    (projectPath: string | null) => {
      onProjectPathFilterChange(projectPath);
      setProjectMenuOpen(false);
    },
    [onProjectPathFilterChange]
  );

  const handleSessionContextMenu = useCallback((e: ReactMouseEvent, session: HistorySessionView) => {
    e.preventDefault();
    setContextMenu({ session, x: e.clientX, y: e.clientY });
  }, []);

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenu) return;
    const session = contextMenu.session;
    setContextMenu(null);
    onDeleteSession(session);
  }, [contextMenu, onDeleteSession]);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: Event) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (projectDropdownRef.current?.contains(e.target as Node)) return;
      setProjectMenuOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProjectMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [projectMenuOpen]);

  const rows = useMemo<HistoryListRow[]>(() => {
    if (loadingSessions) return [{ type: "loading", id: "loading" }];

    const next: HistoryListRow[] = [];
    if (normalizedGlobal && searching) {
      next.push({ type: "searching", id: "searching" });
    }
    if (normalizedGlobal && searchHits.length > 0) {
      next.push({ type: "searchHeader", id: "search-header", count: searchHits.length });
      searchHits.forEach((hit, index) => {
        next.push({ type: "searchHit", id: `hit:${hit.file_path}:${index}`, hit });
      });
    }

    for (const group of groupedSessions) {
      next.push({ type: "group", id: `group:${group.label}`, label: group.label });
      for (const item of group.items) {
        next.push({ type: "session", id: `session:${item.sessionKey}`, item });
      }
    }

    if (filteredSessionCount === 0) {
      next.push({ type: "empty", id: "empty" });
    }
    if (hasMoreSessions) {
      next.push({ type: "loadMore", id: "load-more" });
    }
    return next;
  }, [filteredSessionCount, groupedSessions, hasMoreSessions, loadingSessions, normalizedGlobal, searchHits, searching]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => sessionListRef.current,
    estimateSize: (index) => rowHeight(rows[index] ?? { type: "loading", id: "fallback" }),
    overscan: 10,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  const menuX = contextMenu ? Math.max(8, Math.min(contextMenu.x, window.innerWidth - 200)) : 0;
  const menuY = contextMenu ? Math.max(8, Math.min(contextMenu.y, window.innerHeight - 80)) : 0;

  const renderProjectNode = (node: HistoryProjectTreeNode, depth = 0): ReactNode => {
    const paddingLeft = 8 + depth * 14;
    if (node.type === "group") {
      const isOpen = !collapsedFilterGroups.has(node.group.id);
      return (
        <div key={`group:${node.group.id}`}>
          <button
            type="button"
            onClick={() => toggleFilterGroup(node.group.id)}
            className="ui-tree-node ui-tree-group ui-focus-ring flex h-7 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-[11px] font-semibold"
            style={{ paddingLeft }}
            aria-expanded={isOpen}
          >
            <ChevronRight size={12} className="shrink-0" style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 150ms" }} />
            <Folder size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{node.group.name}</span>
            <span className="ui-tree-count-badge rounded-full px-1.5 text-[10px] font-medium">{countProjects(node)}</span>
          </button>
          {isOpen && node.children.length > 0 && (
            <div className="mt-0.5 space-y-0.5">
              {node.children.map((child) => renderProjectNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const selected = projectPathFilter === node.project.path;
    return (
      <button
        key={`project:${node.project.id}`}
        type="button"
        onClick={() => handleProjectFilterChange(selected ? null : node.project.path)}
        className="ui-tree-node ui-tree-project ui-focus-ring flex h-7 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-[12px]"
        data-selected={selected ? "true" : "false"}
        style={{ paddingLeft }}
        title={node.project.path}
      >
        <span className="ui-tree-leading-icon">
          <ProjectFilterIcon project={node.project} size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{node.project.name}</span>
      </button>
    );
  };

  return (
    <aside
      ref={sidebarRef}
      className="ui-history-sidebar relative flex min-h-0 min-w-[220px] max-w-[70%] flex-col"
      style={{ width: historySidebarWidth }}
    >
      <div className="ui-history-sidebar-top p-3">
        <div className="flex items-center gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-xl border border-border/60 bg-surface-container-lowest p-1">
            {SOURCE_FILTER_OPTIONS.map((option) => {
              const active = sourceFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onSourceFilterChange(option.value)}
                  className="ui-focus-ring rounded-lg px-1.5 py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    backgroundColor: active ? "var(--interactive-selected-bg)" : "transparent",
                    color: active ? "var(--on-surface)" : "var(--text-muted)",
                  }}
                  aria-pressed={active}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={onRefresh}
            aria-label="刷新历史会话列表"
            className="ui-flat-action ui-toolbar-button-compact h-8 w-8 shrink-0 px-0"
            title="刷新会话列表"
          >
            <RefreshCw size={12} />
          </button>
        </div>

        <div className="ui-history-search-shell mt-2 gap-2 px-2.5 py-1.5 text-text-secondary">
          <Search size={13} />
          <input
            ref={globalSearchRef}
            value={globalQuery}
            onChange={(e) => onGlobalQueryChange(e.target.value)}
            aria-label="全局搜索历史会话"
            placeholder="全局搜索（标题/消息/标签）"
            className="flex-1 bg-transparent text-[12px] outline-none"
          />
        </div>

        <div ref={projectDropdownRef} className="relative mt-2">
          <button
            type="button"
            onClick={() => setProjectMenuOpen((open) => !open)}
            className="ui-focus-ring flex h-9 w-full items-center gap-2 rounded-xl border border-border/60 bg-surface-container-lowest px-2.5 text-left text-[12px] transition-colors hover:bg-surface-container-high"
            aria-haspopup="tree"
            aria-expanded={projectMenuOpen}
            title={projectPathFilter ?? "全部项目"}
          >
            {selectedProject ? (
              <span className="ui-tree-leading-icon">
                <ProjectFilterIcon project={selectedProject} size={13} />
              </span>
            ) : (
              <Folder size={13} className="shrink-0 text-text-muted" />
            )}
            <span className="min-w-0 flex-1 truncate">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">项目来源</span>
              <span className="font-semibold text-text-primary">{selectedProjectLabel}</span>
            </span>
            <ChevronDown
              size={13}
              className="shrink-0 text-text-muted transition-transform"
              style={{ transform: projectMenuOpen ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </button>

          {projectMenuOpen && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-border/70 bg-surface-container-lowest p-1 shadow-lg">
              <div className="ui-thin-scroll max-h-52 space-y-0.5 overflow-y-auto pr-1" role="tree" aria-label="历史项目过滤树">
                <button
                  type="button"
                  onClick={() => handleProjectFilterChange(null)}
                  className="ui-tree-node ui-tree-project ui-focus-ring flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-left text-[12px]"
                  data-selected={!projectPathFilter ? "true" : "false"}
                >
                  <Folder size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">全部项目</span>
                  <span className="ui-tree-count-badge rounded-full px-1.5 text-[10px] font-medium">{projects.length}</span>
                </button>
                {projectTree.length > 0 ? (
                  projectTree.map((node) => renderProjectNode(node))
                ) : (
                  <div className="px-2 py-1.5 text-[11px] text-text-muted">暂无项目</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-1 text-[12px] text-text-muted">{sessionHistoryShortcutHint} 打开全局搜索</div>
      </div>

      <div ref={sessionListRef} onScroll={onSessionListScroll} className="flex-1 overflow-y-auto">
        <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 top-0 w-full"
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row.type === "loading" && <div className="px-3 py-4 text-xs text-text-muted">正在加载会话...</div>}

                {row.type === "searching" && (
                  <div className="px-3 py-2 text-[11px] text-text-muted">正在搜索...</div>
                )}

                {row.type === "searchHeader" && (
                  <div className="px-3 py-2 text-[11px] font-semibold text-text-muted">
                    搜索命中 {row.count} 条
                  </div>
                )}

                {row.type === "searchHit" && (
                  <button
                    onClick={() => onOpenHit(row.hit)}
                    className="ui-list-row w-full border-t border-border px-3 py-2 text-left"
                  >
                    <div className="truncate text-xs font-semibold text-text-primary">{row.hit.title}</div>
                    <div className="mt-0.5 truncate text-[11px] text-text-secondary">{row.hit.snippet}</div>
                    <div className="ui-dev-label mt-1 text-[10px] text-text-muted">
                      {row.hit.source} · {row.hit.project_key} · {row.hit.role}
                    </div>
                  </button>
                )}

                {row.type === "group" && (
                  <div className="ui-history-section-label ui-dev-label px-3 py-1.5 text-[11px] font-semibold tracking-[0.04em] text-text-muted">
                    {row.label}
                  </div>
                )}

                {row.type === "session" && (
                  <div className="px-2 py-1">
                    <div
                      onContextMenu={(e) => handleSessionContextMenu(e, row.item)}
                      className="ui-list-row flex min-h-[88px] w-full items-start gap-2 rounded-xl border border-border/70 bg-surface-container-lowest px-2.5 py-2 text-left"
                      style={{ backgroundColor: row.item.sessionKey === activeSessionKey ? "var(--bg-tertiary)" : undefined }}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenSession(row.item.sessionKey)}
                        className="min-w-0 flex-1 overflow-hidden text-left"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          {row.item.starred && <Star size={12} className="shrink-0" style={{ color: "var(--warning)" }} fill="currentColor" />}
                          <span className="truncate text-[13px] font-semibold text-text-primary">{row.item.displayTitle}</span>
                        </div>
                        <div className="ui-dev-label mt-1 truncate text-[11px] text-text-muted">
                          {row.item.source} · {makeSessionLabel(row.item)} · {row.item.message_count} 条消息
                        </div>
                        <div className="ui-dev-label mt-1 truncate text-[11px] text-text-muted">更新于 {formatTime(row.item.updated_at)}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSession(row.item)}
                        className="ui-flat-action mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted hover:text-danger"
                        aria-label={`删除历史会话 ${row.item.displayTitle}`}
                        title="删除历史会话"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {row.type === "empty" && (
                  <div className="px-3 py-6 text-center text-xs text-text-muted">未找到匹配会话</div>
                )}

                {row.type === "loadMore" && (
                  <div className="p-2">
                    <button
                      onClick={onLoadMoreSessions}
                      className="ui-btn w-full"
                      aria-label="加载更多历史会话"
                      disabled={loadingMoreSessions}
                    >
                      {loadingMoreSessions
                        ? "正在加载更多..."
                        : loadMoreSessionMode === "local"
                          ? `显示更多匹配会话（${visibleSessionCount}/${filteredSessionCount}）`
                          : `继续扫描更多历史（已载入 ${filteredSessionCount} 条）`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {contextMenu && (
        <Portal>
          <div className="context-menu" style={{ left: menuX, top: menuY }} ref={contextMenuRef} role="menu">
            <button className="context-menu-item danger" role="menuitem" onClick={handleContextMenuDelete}>
              删除
            </button>
          </div>
        </Portal>
      )}

      <div
        onMouseDown={onStartResize}
        className="ui-history-resize-handle absolute bottom-0 right-0 top-0 z-10 w-1.5 cursor-col-resize transition-colors"
        style={{ opacity: 0.6 }}
      />
    </aside>
  );
}
