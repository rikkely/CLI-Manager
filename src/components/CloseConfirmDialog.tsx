import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "./icons";
import { useFocusTrap } from "../hooks/useFocusTrap";

type CloseAction = "minimize" | "exit";

interface Props {
  open: boolean;
  onMinimize: (remember: boolean) => void;
  onExit: (remember: boolean) => void;
  onClose: () => void;
}

export function CloseConfirmDialog({ open, onMinimize, onExit, onClose }: Props) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [action, setAction] = useState<CloseAction>("minimize");
  const [remember, setRemember] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, mounted && !closing);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      setAction("minimize");
      setRemember(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 180);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!open || closing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, closing]);

  if (!mounted) return null;

  const handleConfirm = () => {
    if (action === "minimize") {
      onMinimize(remember);
    } else {
      onExit(remember);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${closing ? "animate-fade-out bg-black/50" : "animate-fade-in bg-black/50"}`}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className={`w-[300px] rounded-lg border border-border bg-bg-secondary p-4 ${closing ? "animate-scale-out" : "animate-scale-in"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-confirm-title"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-yellow-500" strokeWidth={2} />
          <h3 id="close-confirm-title" className="text-[13px] font-semibold text-text-primary">
            您点击了关闭按钮，您想要：
          </h3>
        </div>

        <div className="mt-3 ml-6 flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text-primary">
            <input
              type="radio"
              name="close-action"
              value="minimize"
              checked={action === "minimize"}
              onChange={() => setAction("minimize")}
              className="h-3.5 w-3.5 accent-accent"
            />
            最小化到托盘
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text-primary">
            <input
              type="radio"
              name="close-action"
              value="exit"
              checked={action === "exit"}
              onChange={() => setAction("exit")}
              className="h-3.5 w-3.5 accent-accent"
            />
            退出
          </label>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-secondary">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3 w-3 accent-accent"
            />
            不再提示
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border bg-bg-tertiary px-3 py-1 text-[12px] text-text-secondary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded bg-accent px-3 py-1 text-[12px] font-semibold text-white"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
