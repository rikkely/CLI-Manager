import { useCallback, useEffect, useState } from "react";
import { ArchiveRestore, History } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { ConfirmDialog } from "../ConfirmDialog";
import { EmptyState } from "../ui/EmptyState";
import { useHistoryStore } from "../../stores/historyStore";
import { useI18n, type TranslationKey } from "../../lib/i18n";
import type { HistoryBackupStatus, HistoryEditAuditEntry } from "../../lib/types";
import { formatTime } from "./historyViewUtils";

interface EditAuditModalProps {
  open: boolean;
  sessionKey: string | null;
  onClose: () => void;
}

const OP_LABEL_KEYS: Record<string, TranslationKey> = {
  edit: "history.edit.op.edit",
  delete: "history.edit.op.delete",
  insert: "history.edit.op.insert",
  restore: "history.edit.op.restore",
};

const OP_COLORS: Record<string, string> = {
  edit: "var(--accent)",
  delete: "var(--danger)",
  insert: "var(--success)",
  restore: "var(--warning)",
};

function AuditTextBlock({ label, text, tone }: { label: string; text: string; tone: "before" | "after" }) {
  return (
    <div className="min-w-0">
      <div
        className="ui-dev-label mb-0.5 text-[10px] font-semibold"
        style={{ color: tone === "before" ? "var(--danger)" : "var(--success)" }}
      >
        {label}
      </div>
      <pre
        className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-bg-secondary p-1.5 font-mono text-[11px] leading-4 text-text-primary"
        style={{
          borderColor:
            tone === "before"
              ? "color-mix(in srgb, var(--danger) 30%, var(--border) 70%)"
              : "color-mix(in srgb, var(--success) 30%, var(--border) 70%)",
        }}
      >
        {text}
      </pre>
    </div>
  );
}

export function EditAuditModal({ open, sessionKey, onClose }: EditAuditModalProps) {
  const { t, language } = useI18n();
  const listEditAudit = useHistoryStore((s) => s.listEditAudit);
  const fetchBackupStatus = useHistoryStore((s) => s.fetchBackupStatus);
  const restoreSessionBackup = useHistoryStore((s) => s.restoreSessionBackup);

  const [entries, setEntries] = useState<HistoryEditAuditEntry[]>([]);
  const [backupStatus, setBackupStatus] = useState<HistoryBackupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const reload = useCallback(async () => {
    if (!sessionKey) return;
    setLoading(true);
    try {
      const [auditEntries, status] = await Promise.all([
        listEditAudit(sessionKey),
        fetchBackupStatus(sessionKey).catch(() => null),
      ]);
      setEntries(auditEntries);
      setBackupStatus(status);
    } catch (err) {
      toast.error(t("history.edit.failed"), { description: String(err) });
    } finally {
      setLoading(false);
    }
  }, [fetchBackupStatus, listEditAudit, sessionKey, t]);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  const handleRestore = async () => {
    if (!sessionKey || restoring) return;
    setRestoring(true);
    try {
      await restoreSessionBackup(sessionKey);
      toast.success(t("history.edit.restoreSuccess"));
      setRestoreConfirmOpen(false);
      await reload();
    } catch (err) {
      toast.error(t("history.edit.restoreFailed"), { description: String(err) });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent className="flex max-h-[76vh] w-[min(680px,92vw)] max-w-[680px] flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="flex items-center gap-1.5">
              <History size={14} />
              {t("history.edit.auditTitle")}
            </DialogTitle>
            {backupStatus?.hasBackup ? (
              <button
                type="button"
                className="ui-flat-action ui-toolbar-button ui-toolbar-button-compact"
                style={{ color: "var(--warning)" }}
                onClick={() => setRestoreConfirmOpen(true)}
                disabled={restoring}
                title={backupStatus.backupPath ?? undefined}
              >
                <ArchiveRestore size={12} />
                {t("history.edit.restoreBackup")}
              </button>
            ) : (
              <span className="text-[11px] text-text-muted">{t("history.edit.noBackup")}</span>
            )}
          </div>

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
            {loading && <div className="text-xs text-text-muted">{t("history.detail.loading")}</div>}
            {!loading && entries.length === 0 && (
              <EmptyState icon={<History size={30} strokeWidth={1.5} />} title={t("history.edit.auditEmpty")} />
            )}
            {!loading && entries.length > 0 && (
              <div className="flex flex-col gap-2">
                {entries.map((entry) => {
                  const opLabelKey = OP_LABEL_KEYS[entry.op];
                  return (
                    <div key={entry.id} className="rounded-md border border-border bg-bg-primary p-2">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            color: OP_COLORS[entry.op] ?? "var(--text-secondary)",
                            backgroundColor: `color-mix(in srgb, ${OP_COLORS[entry.op] ?? "var(--text-secondary)"} 12%, transparent)`,
                          }}
                        >
                          {opLabelKey ? t(opLabelKey) : entry.op}
                        </span>
                        {entry.role && <span className="ui-dev-label">{entry.role}</span>}
                        {entry.line_index !== null && (
                          <span className="ui-dev-label">{t("history.edit.auditLine", { line: entry.line_index })}</span>
                        )}
                        <span className="ml-auto">{formatTime(entry.created_at, language)}</span>
                      </div>
                      <div className="grid gap-1.5">
                        {entry.before_text && (
                          <AuditTextBlock label={t("history.edit.before")} text={entry.before_text} tone="before" />
                        )}
                        {entry.after_text && (
                          <AuditTextBlock label={t("history.edit.after")} text={entry.after_text} tone="after" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={restoreConfirmOpen}
        title={t("history.edit.restoreConfirmTitle")}
        message={t("history.edit.restoreConfirmMessage")}
        confirmText={t("history.edit.restoreBackup")}
        cancelText={t("common.cancel")}
        danger
        zIndex={220}
        onConfirm={() => {
          void handleRestore();
        }}
        onClose={() => setRestoreConfirmOpen(false)}
      />
    </>
  );
}
