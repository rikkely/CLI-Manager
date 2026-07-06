import { useShallow } from "zustand/shallow";
import { useSyncStore } from "../../stores/syncStore";
import { Cloud } from "../icons";
import type { SettingsTab } from "../SettingsModal";
import { useI18n } from "../../lib/i18n";

interface SyncStatusIndicatorProps {
  collapsed?: boolean;
  onOpenSettings?: (tab?: SettingsTab) => void;
}

export function SyncStatusIndicator({ collapsed, onOpenSettings }: SyncStatusIndicatorProps) {
  const { language, t } = useI18n();
  // 常驻侧边栏组件：只订阅展示所需字段，避免 syncStore 其他变化触发重渲染。
  const { status, lastSyncAt, hasPassword } = useSyncStore(
    useShallow((s) => ({ status: s.status, lastSyncAt: s.lastSyncAt, hasPassword: s.hasPassword }))
  );

  const openSyncSettings = () => onOpenSettings?.("sync");

  const getStatusColor = () => {
    if (!hasPassword) return "text-on-surface-variant opacity-60";
    switch (status) {
      case "syncing":
        return "text-yellow-500";
      case "success":
        return "text-success";
      case "error":
        return "text-error";
      case "conflict":
        return "text-yellow-500";
      default:
        return "text-on-surface-variant";
    }
  };

  const getStatusText = () => {
    if (!hasPassword) return t("sidebar.sync.notConfigured");
    switch (status) {
      case "syncing":
        return t("sidebar.sync.syncing");
      case "success":
        return t("sidebar.sync.success");
      case "error":
        return t("sidebar.sync.error");
      case "conflict":
        return t("sidebar.sync.conflict");
      default:
        return lastSyncAt
          ? new Date(lastSyncAt).toLocaleTimeString(language, {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : "--";
    }
  };

  if (collapsed) {
    return (
      <button
        onClick={openSyncSettings}
        className={`ui-focus-ring ui-icon-action ${getStatusColor()}`}
        title={hasPassword ? t("sidebar.sync.configuredTitle", { status: getStatusText() }) : t("sidebar.sync.unconfiguredTitle")}
        aria-label={hasPassword ? t("sidebar.sync.openSettings") : t("sidebar.sync.configure")}
      >
        <Cloud size={14} strokeWidth={1.5} />
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <button
        onClick={openSyncSettings}
        className={`ui-sidebar-sync-link ${getStatusColor()}`}
        title={hasPassword ? t("sidebar.sync.openTitle") : t("sidebar.sync.configureTitle")}
        aria-label={hasPassword ? t("sidebar.sync.openSettings") : t("sidebar.sync.configure")}
      >
        <Cloud size={12} strokeWidth={1.5} />
        <span className="text-xs">{getStatusText()}</span>
      </button>
    </div>
  );
}
