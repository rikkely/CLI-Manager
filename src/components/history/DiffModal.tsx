import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FileCode2, GitCompareArrows, X } from "lucide-react";
import type { HistoryMessage } from "../../lib/types";
import DiffWorker from "../../lib/diffParser.worker.ts?worker";
import type { ParsedDiffBlock } from "../../lib/diffParser.worker";

interface DiffModalProps {
  open: boolean;
  messages: HistoryMessage[];
  onClose: () => void;
  onJumpToMessage: (messageIndex: number) => void;
}

const LINE_STYLE_BASE: CSSProperties = {
  display: "block",
  width: "max-content",
  minWidth: "100%",
  paddingLeft: "0.25rem",
  paddingRight: "0.25rem",
};

const LINE_STYLE_DEFAULT: CSSProperties = {
  ...LINE_STYLE_BASE,
  color: "var(--text-primary)",
  backgroundColor: "transparent",
};
const LINE_STYLE_ADD: CSSProperties = {
  ...LINE_STYLE_BASE,
  color: "var(--success)",
  backgroundColor: "rgba(16, 185, 129, 0.1)",
};
const LINE_STYLE_DELETE: CSSProperties = {
  ...LINE_STYLE_BASE,
  color: "var(--danger)",
  backgroundColor: "rgba(244, 63, 94, 0.1)",
};
const LINE_STYLE_HUNK: CSSProperties = {
  ...LINE_STYLE_BASE,
  color: "#93c5fd",
  backgroundColor: "rgba(59, 130, 246, 0.12)",
};
const LINE_STYLE_HEADER: CSSProperties = {
  ...LINE_STYLE_BASE,
  color: "var(--warning)",
  backgroundColor: "rgba(245, 158, 11, 0.1)",
};

function classifyLineStyle(line: string): CSSProperties {
  if (
    line.startsWith("*** Begin Patch") ||
    line.startsWith("*** End Patch") ||
    line.startsWith("*** Update File:") ||
    line.startsWith("*** Add File:") ||
    line.startsWith("*** Delete File:") ||
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  ) {
    return LINE_STYLE_HEADER;
  }
  if (line.startsWith("@@")) {
    return LINE_STYLE_HUNK;
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return LINE_STYLE_ADD;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return LINE_STYLE_DELETE;
  }
  return LINE_STYLE_DEFAULT;
}

function renderHighlightedPatch(patch: string): ReactNode {
  const lines = patch.split("\n");
  return lines.map((line, index) => (
    <span key={index} style={classifyLineStyle(line)}>
      {line || " "}
    </span>
  ));
}

const VIEWER_OUTER_STYLE: CSSProperties = {
  borderColor: "var(--border)",
  backgroundColor: "var(--bg-secondary)",
  scrollbarGutter: "stable both-edges",
};

const VIEWER_INNER_STYLE: CSSProperties = { color: "var(--text-primary)" };

const DiffCodeViewer = memo(function DiffCodeViewer({ patch }: { patch: string }) {
  return (
    <div className="mt-2">
      <div
        className="rounded-md border overflow-x-scroll overflow-y-hidden max-w-full diff-code-scroll"
        style={VIEWER_OUTER_STYLE}
      >
        <pre
          className="text-xs whitespace-pre m-0 p-2 min-w-max font-mono leading-5 diff-code-inner"
          style={VIEWER_INNER_STYLE}
        >
          {renderHighlightedPatch(patch)}
        </pre>
      </div>
    </div>
  );
});

export function DiffModal({ open, messages, onClose, onJumpToMessage }: DiffModalProps) {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [blocks, setBlocks] = useState<ParsedDiffBlock[]>([]);
  const [parsing, setParsing] = useState(false);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    if (!workerRef.current) {
      workerRef.current = new DiffWorker();
    }
    const worker = workerRef.current;
    const requestId = ++requestIdRef.current;
    setParsing(true);

    const onMessage = (event: MessageEvent<{ id: number; blocks: ParsedDiffBlock[] }>) => {
      if (event.data.id !== requestId) return;
      setBlocks(event.data.blocks);
      setParsing(false);
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({
      id: requestId,
      messages: messages.map((m) => ({ content: m.content, timestamp: m.timestamp ?? null })),
    });

    return () => {
      worker.removeEventListener("message", onMessage);
    };
  }, [open, messages]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 56, backgroundColor: "rgba(0, 0, 0, 0.45)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-5xl h-[min(84vh,780px)] rounded-lg border overflow-hidden flex flex-col"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-primary)" }}
      >
        <div
          className="px-3 py-2 border-b flex items-center justify-between"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <GitCompareArrows size={15} />
            Diff 视图
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md border w-7 h-7"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {parsing && (
            <div className="px-3 py-6 text-xs text-center" style={{ color: "var(--text-muted)" }}>
              正在解析 diff...
            </div>
          )}

          {!parsing && blocks.length === 0 && (
            <div className="px-3 py-6 text-xs text-center" style={{ color: "var(--text-muted)" }}>
              当前会话暂未解析到 unified diff
            </div>
          )}

          {!parsing &&
            blocks.map((block) => (
              <div
                key={block.id}
                className="px-3 py-3 border-b min-w-0"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                      <FileCode2 size={12} />
                      <span className="truncate">{block.filePath}</span>
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      来自消息 #{block.messageIndex + 1} · {block.timestamp ?? "-"}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      onJumpToMessage(block.messageIndex);
                      onClose();
                    }}
                    className="text-xs px-2 py-1 rounded-md shrink-0"
                    style={{ backgroundColor: "var(--accent)", color: "#fff" }}
                  >
                    跳回消息
                  </button>
                </div>
                <DiffCodeViewer patch={block.patch} />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
