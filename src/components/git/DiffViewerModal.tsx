import { useEffect, useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { X, Undo2 } from "../icons";
import { parseDiff, Diff, Hunk, tokenize, Decoration, getChangeKey } from "react-diff-view";
import type { ChangeData } from "react-diff-view";
import { useGitStore } from "../../stores/gitStore";
import { TERM } from "../stats/termStatsUi";
import "react-diff-view/style/index.css";
import "./diffViewer.css";

interface DiffViewerModalProps {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  filePath: string;
  fileName: string;
  status: string;
  onRequestDiscard?: (path: string, name: string, status: string) => void;
}

export function DiffViewerModal({ open, onClose, projectPath, filePath, fileName, status, onRequestDiscard }: DiffViewerModalProps) {
  const [diffText, setDiffText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const revertHunk = useGitStore((s) => s.revertHunk);
  const revertLines = useGitStore((s) => s.revertLines);
  const discarding = useGitStore((s) => s.discarding);

  useEffect(() => {
    if (!open) {
      setDiffText("");
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    invoke<string>("git_get_file_diff", { projectPath, filePath, status })
      .then((diff) => {
        if (cancelled) return;
        setDiffText(diff);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[DiffViewerModal] 获取 diff 失败:", err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectPath, filePath, status]);

  // diff 解析放在 hooks 区（行选择 hook 依赖 hunks，不能在条件 return 之后）。
  const parsed = useMemo(() => {
    if (!diffText) return null;
    try {
      const files = parseDiff(diffText);
      if (files.length > 0) {
        const file = files[0];
        return { file, tokens: tokenize(file.hunks) };
      }
    } catch (err) {
      console.error("[DiffViewerModal] 解析 diff 失败:", err);
    }
    return null;
  }, [diffText]);

  const parsedDiff = parsed?.file ?? null;
  const tokens = parsed?.tokens ?? null;

  // 切换文件（diffText 变化）时清空行选择。
  useEffect(() => {
    setSelectedKeys([]);
  }, [diffText]);

  // 切换单个变更行的选中（仅 insert/delete 可选）。
  const toggleSelect = useCallback(({ change }: { change: ChangeData | null }) => {
    if (!change || change.type === "normal") return;
    const key = getChangeKey(change);
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  if (!open) return null;

  // 仅已跟踪文件可回滚；点击后关闭本弹窗并交由上层确认（规避与 z-50 ConfirmDialog 的层级冲突）。
  const canDiscard = status !== "U" && status !== "??" && !!onRequestDiscard;

  // Hunk 级回滚：成功后关闭弹窗（内容已变）；失败提示刷新（dry-run 兜底，未损坏文件）。
  const handleRevertHunk = async (hunkIndex: number) => {
    try {
      await revertHunk(diffText, hunkIndex);
      onClose();
    } catch {
      toast.error("回滚此块失败：工作区可能已变化，请刷新后重试");
    }
  };

  // 收集选中行的 (side, lineNumber)，供行级回滚。
  const collectSelectedLines = (): { side: "old" | "new"; lineNumber: number }[] => {
    const result: { side: "old" | "new"; lineNumber: number }[] = [];
    if (!parsedDiff) return result;
    for (const hunk of parsedDiff.hunks) {
      for (const change of hunk.changes) {
        if (change.type === "normal") continue;
        if (!selectedKeys.includes(getChangeKey(change))) continue;
        if (change.type === "insert") result.push({ side: "new", lineNumber: change.lineNumber });
        else result.push({ side: "old", lineNumber: change.lineNumber });
      }
    }
    return result;
  };

  // 行级回滚：成功后关闭弹窗；失败提示刷新。
  const handleRevertLines = async () => {
    const selectedLines = collectSelectedLines();
    if (selectedLines.length === 0) return;
    try {
      await revertLines(diffText, selectedLines);
      onClose();
    } catch {
      toast.error("回滚选中行失败：工作区可能已变化，请刷新后重试");
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 100, backgroundColor: "rgba(0, 0, 0, 0.6)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-6xl h-[85vh] flex flex-col rounded-xl shadow-2xl overflow-hidden border font-mono"
        style={{ backgroundColor: TERM.bg, borderColor: TERM.border }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ backgroundColor: TERM.card, borderColor: TERM.border }}
        >
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold" style={{ color: TERM.fg }}>
              Diff: {fileName}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {canDiscard && (
              <button
                onClick={() => {
                  onClose();
                  onRequestDiscard?.(filePath, fileName, status);
                }}
                className="ui-focus-ring flex items-center gap-1 rounded px-2 py-1 text-[12px] transition-opacity hover:opacity-80"
                style={{ color: TERM.red, border: `1px solid ${TERM.border}` }}
                title="回滚此文件的全部改动"
              >
                <Undo2 size={13} />
                回滚此文件
              </button>
            )}
            <button
              onClick={onClose}
              className="ui-focus-ring rounded p-1 transition-opacity hover:opacity-70"
              style={{ color: TERM.dim }}
              title="关闭"
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4" style={{ backgroundColor: TERM.bg }}>
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3">
                <div
                  className="h-8 w-8 animate-spin rounded-full border-2"
                  style={{ borderColor: TERM.green, borderTopColor: "transparent" }}
                ></div>
                <p className="text-sm" style={{ color: TERM.dim }}>加载中...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3 max-w-md text-center">
                <p className="text-sm" style={{ color: TERM.red }}>{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && diffText && parsedDiff && tokens && (
            <div
              className="diff-viewer-container rounded-lg shadow-sm border overflow-hidden"
              style={{ backgroundColor: TERM.bg, borderColor: TERM.border }}
            >
              <Diff
                viewType="split"
                diffType={parsedDiff.type}
                hunks={parsedDiff.hunks}
                tokens={tokens}
                selectedChanges={selectedKeys}
                gutterEvents={canDiscard ? { onClick: toggleSelect } : undefined}
              >
                {(hunks) =>
                  hunks.flatMap((hunk, index) => [
                    <Decoration key={`deco-${hunk.content}`}>
                      <div
                        className="flex items-center justify-between gap-2 px-3 py-1"
                        style={{ backgroundColor: TERM.cardInner, borderTop: `1px solid ${TERM.border}` }}
                      >
                        <span className="truncate text-[11px]" style={{ color: TERM.dim }}>
                          {hunk.content}
                        </span>
                        {canDiscard && (
                          <button
                            onClick={() => handleRevertHunk(index)}
                            disabled={discarding}
                            className="ui-focus-ring flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-opacity hover:opacity-80 disabled:opacity-40"
                            style={{ color: TERM.red }}
                            title="回滚此变更块"
                          >
                            <Undo2 size={11} />
                            回滚此块
                          </button>
                        )}
                      </div>
                    </Decoration>,
                    <Hunk key={hunk.content} hunk={hunk} />,
                  ])
                }
              </Diff>
            </div>
          )}

          {!loading && !error && (!diffText || !parsedDiff) && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm" style={{ color: TERM.dim }}>无 diff 内容</p>
            </div>
          )}
        </div>

        {/* 行选择操作条 */}
        {canDiscard && parsedDiff && (
          <div
            className="flex items-center justify-between gap-3 border-t px-4 py-2 text-[11px]"
            style={{ borderColor: TERM.border, backgroundColor: TERM.card, color: TERM.dim }}
          >
            <span>点击行号可选择要回滚的行</span>
            {selectedKeys.length > 0 && (
              <div className="flex items-center gap-2">
                <span style={{ color: TERM.fg }}>已选 {selectedKeys.length} 行</span>
                <button
                  onClick={() => setSelectedKeys([])}
                  className="ui-focus-ring rounded px-2 py-0.5 transition-opacity hover:opacity-80"
                  style={{ color: TERM.dim }}
                >
                  取消选择
                </button>
                <button
                  onClick={handleRevertLines}
                  disabled={discarding}
                  className="ui-focus-ring flex items-center gap-1 rounded px-2 py-0.5 transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ color: TERM.red, border: `1px solid ${TERM.border}` }}
                >
                  <Undo2 size={11} />
                  回滚选中 {selectedKeys.length} 行
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
