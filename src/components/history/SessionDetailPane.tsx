import { useVirtualizer } from "@tanstack/react-virtual";
import { BookCopy, Copy, GitCompare, Star, Terminal } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import type { HistoryMessage, HistorySessionDetail, HistorySessionView } from "../../lib/types";
import { EmptyState } from "../ui/EmptyState";
import { SessionTranscriptContent } from "./SessionTranscriptContent";
import { MetaEditor } from "./MetaEditor";
import { formatTime, makeSessionLabel, roleBadge } from "./historyViewUtils";
import { SessionTimelineView } from "./SessionTimelineView";
import { SessionContextView } from "./SessionContextView";
import { SessionFileChangesView } from "./SessionFileChangesView";
import { SessionToolDiagnosticsView } from "./SessionToolDiagnosticsView";
import { SessionSubtaskTreeView } from "./SessionSubtaskTreeView";
import type { SessionProcessModel } from "./sessionEvents";
import type { RefObject } from "react";

export type HistoryDetailView = "transcript" | "timeline" | "context" | "changes" | "tools" | "subtasks";

interface SessionDetailPaneProps {
  activeView: HistorySessionView | null;
  activeSession: HistorySessionDetail | null;
  loadingSessionDetail: boolean;
  aliasDraft: string;
  tagsDraft: string;
  sessionQuery: string;
  matchIndices: number[];
  matchCursor: number;
  focusedMessageIndex: number | null;
  focusedMessageSeq: number;
  visibleMessages: HistoryMessage[];
  visibleMessageCount: number;
  hasMoreMessages: boolean;
  totalMessageCount: number;
  processModel: SessionProcessModel;
  detailView: HistoryDetailView;
  messageListRef: RefObject<HTMLDivElement | null>;
  sessionSearchRef: RefObject<HTMLInputElement | null>;
  messageRefs: RefObject<Record<number, HTMLDivElement | null>>;
  onDetailViewChange: (view: HistoryDetailView) => void;
  onMessageListScroll: () => void;
  onAliasDraftChange: (value: string) => void;
  onTagsDraftChange: (value: string) => void;
  onSessionQueryChange: (value: string) => void;
  onSaveMeta: () => void;
  onJumpPrev: () => void;
  onJumpNext: () => void;
  onOpenPrompt: () => void;
  onOpenDiff: () => void;
  onResumeSession: () => void;
  onJumpToMessage: (messageIndex: number) => void;
  onToggleStar: () => void;
  onLoadMoreMessages: () => void;
}

const DETAIL_VIEWS: Array<{ id: HistoryDetailView; label: string }> = [
  { id: "transcript", label: "原文" },
  { id: "timeline", label: "过程" },
  { id: "context", label: "上下文" },
  { id: "changes", label: "变更" },
  { id: "tools", label: "工具" },
  { id: "subtasks", label: "子任务" },
];

export function SessionDetailPane({
  activeView,
  activeSession,
  loadingSessionDetail,
  aliasDraft,
  tagsDraft,
  sessionQuery,
  matchIndices,
  matchCursor,
  focusedMessageIndex,
  focusedMessageSeq,
  visibleMessages,
  visibleMessageCount,
  hasMoreMessages,
  totalMessageCount,
  processModel,
  detailView,
  messageListRef,
  sessionSearchRef,
  messageRefs,
  onDetailViewChange,
  onMessageListScroll,
  onAliasDraftChange,
  onTagsDraftChange,
  onSessionQueryChange,
  onSaveMeta,
  onJumpPrev,
  onJumpNext,
  onOpenPrompt,
  onOpenDiff,
  onResumeSession,
  onJumpToMessage,
  onToggleStar,
  onLoadMoreMessages,
}: SessionDetailPaneProps) {
  // matchIndices.includes(idx) 在 visibleMessages.map 内对每个可见消息做 O(N) 扫描，
  // 当匹配数 N 和可见消息数 M 都达到几百时累计 O(N·M)。改 Set 后是 O(1) lookup。
  const matchSet = useMemo(() => new Set(matchIndices), [matchIndices]);
  const activeMatchIndex = matchIndices[Math.min(matchCursor, Math.max(0, matchIndices.length - 1))];
  const messageVirtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => messageListRef.current,
    estimateSize: () => 220,
    overscan: 6,
    getItemKey: (index) => `${visibleMessages[index]?.role ?? "message"}:${index}`,
  });

  useEffect(() => {
    if (activeMatchIndex === undefined) return;
    if (detailView === "transcript" && activeMatchIndex < visibleMessages.length) {
      messageVirtualizer.scrollToIndex(activeMatchIndex, { align: "center" });
    }
  }, [activeMatchIndex, detailView, messageVirtualizer, visibleMessages.length]);

  useEffect(() => {
    if (focusedMessageIndex === null || focusedMessageIndex >= visibleMessages.length) return;
    if (detailView === "transcript") messageVirtualizer.scrollToIndex(focusedMessageIndex, { align: "center" });
  }, [detailView, focusedMessageIndex, focusedMessageSeq, messageVirtualizer, visibleMessages.length]);

  if (!activeView) {
    return (
      <div className="row-span-2 flex min-h-0 items-center justify-center">
        <EmptyState
          icon={<BookCopy size={34} strokeWidth={1.5} />}
          title="未选择会话"
          description="从左侧选择会话查看详情"
        />
      </div>
    );
  }

  const copyText = (text: string, label: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`${label} 已复制`))
      .catch((err) => toast.error("复制失败", { description: String(err) }));
  };

  const locationText = [
    `sessionId=${activeView.session_id}`,
    `source=${activeView.source}`,
    `project=${activeView.project_key}`,
    `filePath=${activeView.file_path}`,
  ].join("\n");

  return (
    <>
      <div className="ui-history-detail-top [grid-row:1] min-h-0 shrink-0 overflow-y-auto p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text-primary">{activeView.displayTitle}</h3>
            <div className="ui-dev-label mt-1 text-[11px] text-text-muted">
              {activeView.source} · {makeSessionLabel(activeView)} · 更新于 {formatTime(activeView.updated_at)}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
              <span className="ui-dev-label max-w-full truncate rounded border border-border bg-bg-secondary px-1.5 py-0.5">
                sessionId: {activeView.session_id}
              </span>
              <button
                onClick={() => copyText(activeView.session_id, "sessionId")}
                className="ui-flat-action ui-toolbar-button ui-toolbar-button-compact"
                title="复制 sessionId"
              >
                <Copy size={11} />
                复制ID
              </button>
              <button
                onClick={() => copyText(locationText, "会话定位信息")}
                className="ui-flat-action ui-toolbar-button ui-toolbar-button-compact"
                title="复制 source/project/filePath 定位信息"
              >
                <Copy size={11} />
                复制定位
              </button>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={onResumeSession}
              disabled={loadingSessionDetail || !activeSession}
              aria-label="继续对话"
              className="ui-flat-action ui-toolbar-button ui-toolbar-button-compact ui-primary-action"
              title="新建内部终端并继续该会话"
            >
              <Terminal size={12} />
              继续对话
            </button>
            <button
              onClick={onOpenPrompt}
              aria-label="打开历史 Prompt 库"
              className="ui-flat-action ui-toolbar-button ui-toolbar-button-compact"
              title="历史 Prompt 库"
            >
              <BookCopy size={12} />
              历史Prompt
            </button>
            <button
              onClick={onOpenDiff}
              aria-label="打开 Diff 视图"
              className="ui-flat-action ui-toolbar-button ui-toolbar-button-compact"
              title="Diff 视图"
            >
              <GitCompare size={12} />
              Diff
            </button>
            <button
              onClick={onToggleStar}
              aria-label={activeView.starred ? "取消收藏会话" : "收藏会话"}
              className="ui-flat-action ui-toolbar-button ui-toolbar-button-compact"
              style={{ color: activeView.starred ? "var(--warning)" : undefined }}
              title="收藏"
            >
              <Star size={12} fill={activeView.starred ? "currentColor" : "none"} />
              {activeView.starred ? "已收藏" : "收藏"}
            </button>
          </div>
        </div>

        <MetaEditor
          aliasDraft={aliasDraft}
          tagsDraft={tagsDraft}
          sessionQuery={sessionQuery}
          sessionSearchRef={sessionSearchRef}
          matchCursor={matchCursor}
          matchCount={matchIndices.length}
          onAliasDraftChange={onAliasDraftChange}
          onTagsDraftChange={onTagsDraftChange}
          onSessionQueryChange={onSessionQueryChange}
          onSaveMeta={onSaveMeta}
          onJumpPrev={onJumpPrev}
          onJumpNext={onJumpNext}
        />

        <div className="ui-history-detail-tabs" role="tablist" aria-label="会话详情视图">
          {DETAIL_VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={detailView === item.id}
              data-active={detailView === item.id}
              onClick={() => onDetailViewChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={messageListRef} onScroll={onMessageListScroll} className="[grid-row:2] min-h-0 h-full overflow-x-hidden overflow-y-auto p-3">
        {loadingSessionDetail && <div className="text-xs text-text-muted">正在读取会话详情...</div>}

        {!loadingSessionDetail && activeSession?.messages.length === 0 && (
          <div className="text-xs text-text-muted">当前会话没有可显示的消息</div>
        )}

        {!loadingSessionDetail && detailView === "transcript" && visibleMessages.length > 0 && (
          <div className="relative w-full" style={{ height: messageVirtualizer.getTotalSize() }}>
            {messageVirtualizer.getVirtualItems().map((virtualRow) => {
              const msg = visibleMessages[virtualRow.index];
              if (!msg) return null;
              const isMatched = matchSet.has(virtualRow.index);
              const isFocused = focusedMessageIndex === virtualRow.index;
              const badge = roleBadge(msg.role);
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={(el) => {
                    messageRefs.current[virtualRow.index] = el;
                    if (el) messageVirtualizer.measureElement(el);
                  }}
                  className="ui-history-message-card absolute left-0 top-0 w-full p-2.5"
                  style={{
                    borderColor: isFocused ? "var(--warning)" : isMatched ? "var(--accent)" : "var(--border)",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="ui-dev-label mb-1 flex items-center justify-between text-[11px] text-text-muted">
                    <span
                      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                      style={{
                        color: badge.color,
                        backgroundColor: badge.bg,
                        border: `1px solid ${badge.border}`,
                      }}
                    >
                      {badge.label}
                    </span>
                    <span>{msg.timestamp ?? "-"}</span>
                  </div>
                  <SessionTranscriptContent content={msg.content} query={sessionQuery} />
                </div>
              );
            })}
          </div>
        )}

        {!loadingSessionDetail && detailView === "timeline" && (
          <SessionTimelineView model={processModel} onJumpToMessage={onJumpToMessage} />
        )}

        {!loadingSessionDetail && detailView === "context" && <SessionContextView session={activeSession} />}

        {!loadingSessionDetail && detailView === "changes" && (
          <SessionFileChangesView model={processModel} onJumpToMessage={onJumpToMessage} onOpenDiff={onOpenDiff} />
        )}

        {!loadingSessionDetail && detailView === "tools" && (
          <SessionToolDiagnosticsView
            model={processModel}
            builtinCalls={activeSession?.usage?.builtin_calls ?? []}
            mcpCalls={activeSession?.usage?.mcp_calls ?? []}
            skillCalls={activeSession?.usage?.skill_calls ?? []}
            toolEvents={activeSession?.tool_events ?? []}
            onJumpToMessage={onJumpToMessage}
          />
        )}

        {!loadingSessionDetail && detailView === "subtasks" && (
          <SessionSubtaskTreeView model={processModel} onJumpToMessage={onJumpToMessage} />
        )}

        {!loadingSessionDetail && detailView === "transcript" && hasMoreMessages && (
          <button onClick={onLoadMoreMessages} className="ui-btn mt-2.5 w-full" aria-label="加载更多消息">
            加载更多消息 ({visibleMessageCount}/{totalMessageCount})
          </button>
        )}
      </div>
    </>
  );
}
