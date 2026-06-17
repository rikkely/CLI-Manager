import { useEffect, useState } from "react";
import { RefreshCw, GitBranch } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import { GitChangesTree } from "./GitChangesTree";
import { DiffViewerModal } from "./DiffViewerModal";
import { TERM, EmptyHint } from "../stats/termStatsUi";

interface GitChangesPanelProps {
  open: boolean;
  projectPath: string | null;
}

export function GitChangesPanel({ open, projectPath }: GitChangesPanelProps) {
  const { fetchChanges, reset, changes, loading, statusFilter, setStatusFilter } = useGitStore();
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string; status: string } | null>(null);

  useEffect(() => {
    if (open && projectPath) {
      fetchChanges(projectPath);
    } else if (!open) {
      reset();
    }
  }, [open, projectPath, fetchChanges, reset]);

  if (!open) return null;

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

  const allCount = changes.length;
  const modifiedCount = changes.filter((c) => c.status === "M").length;
  const addedCount = changes.filter((c) => c.status === "A" || c.status === "U" || c.status === "??").length;
  const deletedCount = changes.filter((c) => c.status === "D").length;

  const filterButtons = [
    { label: "全部", value: "all" as const, count: allCount, color: TERM.fg },
    { label: "修改", value: "M" as const, count: modifiedCount, color: TERM.blue },
    { label: "新增", value: "A" as const, count: addedCount, color: TERM.green },
    { label: "删除", value: "D" as const, count: deletedCount, color: "#808080" },
  ];

  return (
    <aside
      className="flex w-[290px] shrink-0 flex-col border-l border-border overflow-hidden font-mono"
      style={{ backgroundColor: TERM.bg }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b" style={{ borderColor: TERM.dim }}>
        <span className="flex items-center gap-2 text-[11px] font-bold" style={{ color: TERM.fg }}>
          <GitBranch size={12} strokeWidth={2} />
          Git 变更
        </span>
        <button
          onClick={handleRefresh}
          className={`ui-focus-ring rounded p-0.5 ${loading ? "animate-spin" : ""}`}
          style={{ color: TERM.cyan }}
          title="刷新"
          aria-label="刷新 Git 变更"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Filter */}
      {changes.length > 0 && (
        <div className="shrink-0 flex gap-1 px-2 py-1.5 border-b" style={{ borderColor: TERM.dim }}>
          {filterButtons.map((btn) => (
            <button
              key={btn.value}
              onClick={() => setStatusFilter(btn.value)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors"
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
        <div className="shrink-0 px-2 py-1.5 text-[10px] border-b" style={{ borderColor: TERM.dim, color: TERM.dim }}>
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
      <div className="flex-1 overflow-y-auto ui-thin-scroll p-2">
        {!projectPath ? (
          <EmptyHint text="当前终端未关联项目" />
        ) : loading && changes.length === 0 ? (
          <EmptyHint text="加载中…" />
        ) : changes.length === 0 ? (
          <EmptyHint text="无文件变更" />
        ) : (
          <GitChangesTree onFileClick={handleFileClick} />
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
        />
      )}
    </aside>
  );
}
