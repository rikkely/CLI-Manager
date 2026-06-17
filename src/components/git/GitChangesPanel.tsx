import { useEffect, useMemo, useState } from "react";
import { RefreshCw, GitBranch, Undo2 } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import { GitChangesTree } from "./GitChangesTree";
import { DiffViewerModal } from "./DiffViewerModal";
import { ConfirmDialog } from "../ConfirmDialog";
import { TERM, EmptyHint } from "../stats/termStatsUi";
import type { GitTreeNode } from "../../lib/types";

interface GitChangesPanelProps {
  open: boolean;
  projectPath: string | null;
  visible?: boolean;
  embedded?: boolean;
}

// 聚焦轮询间隔：仅在窗口聚焦且面板可见时静默刷新，避免无谓查询。
const POLL_INTERVAL_MS = 4000;

function collectDirectoryPaths(nodes: GitTreeNode[]): string[] {
  const paths: string[] = [];

  const visit = (items: GitTreeNode[]) => {
    for (const node of items) {
      if (node.type !== "directory") continue;
      paths.push(node.path);
      visit(node.children ?? []);
    }
  };

  visit(nodes);
  return paths;
}

export function GitChangesPanel({ open, projectPath, visible = true, embedded = false }: GitChangesPanelProps) {
  const {
    fetchChanges,
    reset,
    changes,
    tree,
    collapsedDirs,
    loading,
    statusFilter,
    setStatusFilter,
    collapseAllDirs,
    expandAllDirs,
    discardFile,
    discardAll,
    discarding,
  } = useGitStore();
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string; status: string } | null>(null);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<{ path: string; name: string; status: string } | null>(null);
  const panelActive = open && visible;

  useEffect(() => {
    if (panelActive && projectPath) {
      fetchChanges(projectPath);
    } else if (!open) {
      reset();
    }
  }, [panelActive, open, projectPath, fetchChanges, reset]);

  // 自动刷新：窗口聚焦且面板可见时每 ~4s 静默刷新；失焦/隐藏暂停。
  useEffect(() => {
    if (!panelActive || !projectPath) return;

    let timer: number | undefined;
    const isActive = () => document.visibilityState === "visible" && document.hasFocus();
    const tick = () => {
      if (isActive()) void fetchChanges(projectPath, true);
    };
    const start = () => {
      if (timer === undefined) timer = window.setInterval(tick, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    // 重新聚焦/变可见时立即刷新一次再继续轮询。
    const onFocus = () => {
      void fetchChanges(projectPath, true);
      start();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
      else stop();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onVisibility);
    if (isActive()) start();

    return () => {
      stop();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [panelActive, projectPath, fetchChanges]);

  const directoryPaths = useMemo(() => collectDirectoryPaths(tree), [tree]);
  const hasDirectories = directoryPaths.length > 0;
  const allCollapsed = hasDirectories && directoryPaths.every((path) => collapsedDirs.has(path));

  if (!open || !visible) return null;

  const handleRefresh = () => {
    if (projectPath) {
      fetchChanges(projectPath);
    }
  };

  const handleFileClick = (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const fileChange = changes.find(c => c.path === filePath);
    if (fileChange) {
      setSelectedFile({ path: filePath, name: fileName, status: fileChange.status });
      setDiffModalOpen(true);
    }
  };

  const handleRequestDiscard = (path: string, name: string, status: string) => {
    setDiscardTarget({ path, name, status });
  };

  const allCount = changes.length;
  const modifiedCount = changes.filter((c) => c.status === "M").length;
  const addedCount = changes.filter((c) => c.status === "A" || c.status === "U" || c.status === "??").length;
  const deletedCount = changes.filter((c) => c.status === "D").length;
  // 可回滚（已跟踪）文件数：排除未跟踪 U/??。
  const trackableCount = changes.filter((c) => c.status !== "U" && c.status !== "??").length;

  const filterButtons = [
    { label: "全部", value: "all" as const, count: allCount, color: TERM.fg },
    { label: "修改", value: "M" as const, count: modifiedCount, color: TERM.blue },
    { label: "新增", value: "A" as const, count: addedCount, color: TERM.green },
    { label: "删除", value: "D" as const, count: deletedCount, color: "#808080" },
  ];

  const panelClassName = embedded
    ? "flex h-full min-h-0 flex-col overflow-hidden font-mono"
    : "relative z-[1] flex w-[290px] shrink-0 flex-col overflow-hidden border-l border-border font-mono";
  const Container = embedded ? "div" : "aside";

  return (
    <Container
      className={panelClassName}
      style={{ backgroundColor: TERM.bg }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5" style={{ borderColor: TERM.dim }}>
        <span className="flex items-center gap-2 text-[11px] font-bold" style={{ color: TERM.fg }}>
          <GitBranch size={12} strokeWidth={2} />
          Git 变更
        </span>
        <span className="flex items-center gap-1">
          {hasDirectories && (
            <button
              type="button"
              onClick={allCollapsed ? expandAllDirs : collapseAllDirs}
              className="ui-focus-ring rounded px-1 py-0.5 text-[10px] transition-colors"
              style={{ color: TERM.cyan, backgroundColor: `${TERM.cyan}12` }}
              title={allCollapsed ? "全部展开 Git 文件树" : "全部收起 Git 文件树"}
              aria-label={allCollapsed ? "全部展开 Git 文件树" : "全部收起 Git 文件树"}
            >
              {allCollapsed ? "展开" : "收起"}
            </button>
          )}
          {trackableCount > 0 && (
            <button
              type="button"
              onClick={() => setConfirmAllOpen(true)}
              disabled={discarding}
              className="ui-focus-ring rounded p-0.5 disabled:opacity-40"
              style={{ color: TERM.red }}
              title="丢弃全部已跟踪改动"
              aria-label="丢弃全部已跟踪改动"
            >
              <Undo2 size={11} />
            </button>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            className={`ui-focus-ring rounded p-0.5 ${loading ? "animate-spin" : ""}`}
            style={{ color: TERM.cyan }}
            title="刷新"
            aria-label="刷新 Git 变更"
          >
            <RefreshCw size={11} />
          </button>
        </span>
      </div>

      {/* Filter */}
      {changes.length > 0 && (
        <div className="flex shrink-0 gap-1 border-b px-2 py-1.5" style={{ borderColor: TERM.dim }}>
          {filterButtons.map((btn) => (
            <button
              key={btn.value}
              type="button"
              onClick={() => setStatusFilter(btn.value)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
              style={{
                backgroundColor: statusFilter === btn.value ? `${btn.color}30` : "transparent",
                color: statusFilter === btn.value ? btn.color : TERM.dim,
                border: `1px solid ${statusFilter === btn.value ? btn.color : "transparent"}`,
              }}
            >
              <span>{btn.label}</span>
              <span className="font-bold">{btn.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Summary */}
      {changes.length > 0 && (
        <div className="shrink-0 border-b px-2 py-1.5 text-[10px]" style={{ borderColor: TERM.dim, color: TERM.dim }}>
          <span style={{ color: TERM.fg }}>{allCount}</span> 个文件
          {modifiedCount > 0 && (
            <>
              {" · "}
              <span style={{ color: TERM.blue }}>{modifiedCount}</span> 修改
            </>
          )}
          {addedCount > 0 && (
            <>
              {" · "}
              <span style={{ color: TERM.green }}>{addedCount}</span> 新增
            </>
          )}
          {deletedCount > 0 && (
            <>
              {" · "}
              <span style={{ color: "#808080" }}>{deletedCount}</span> 删除
            </>
          )}
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 ui-thin-scroll">
        {!projectPath ? (
          <EmptyHint text="当前终端未关联项目" />
        ) : loading && changes.length === 0 ? (
          <EmptyHint text="加载中…" />
        ) : changes.length === 0 ? (
          <EmptyHint text="无文件变更" />
        ) : (
          <GitChangesTree onFileClick={handleFileClick} onRequestDiscard={handleRequestDiscard} />
        )}
      </div>

      {/* Diff Modal */}
      {selectedFile && projectPath && (
        <DiffViewerModal
          open={diffModalOpen}
          onClose={() => setDiffModalOpen(false)}
          projectPath={projectPath}
          filePath={selectedFile.path}
          fileName={selectedFile.name}
          status={selectedFile.status}
          onRequestDiscard={handleRequestDiscard}
        />
      )}

      {/* 单文件回滚确认 */}
      <ConfirmDialog
        open={!!discardTarget}
        title="回滚改动？"
        message={discardTarget ? `将永久丢弃对 ${discardTarget.name} 的未提交改动，无法通过 git 撤销。` : undefined}
        confirmText="回滚"
        cancelText="取消"
        danger
        onConfirm={() => {
          if (discardTarget) void discardFile(discardTarget.path, discardTarget.status);
          setDiscardTarget(null);
        }}
        onClose={() => setDiscardTarget(null)}
      />

      {/* 丢弃全部确认 */}
      <ConfirmDialog
        open={confirmAllOpen}
        title="丢弃全部改动？"
        message={`将永久丢弃 ${trackableCount} 个已跟踪文件的未提交改动，无法通过 git 撤销。未跟踪文件不受影响。`}
        confirmText="全部丢弃"
        cancelText="取消"
        danger
        onConfirm={() => {
          setConfirmAllOpen(false);
          void discardAll();
        }}
        onClose={() => setConfirmAllOpen(false)}
      />
    </Container>
  );
}
