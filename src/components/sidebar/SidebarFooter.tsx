import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { BarChart3, Settings } from "../icons";
import { SyncStatusIndicator } from "./SyncStatusIndicator";
import type { SettingsTab } from "../SettingsModal";
import { useSettingsStore, type SidebarToolbarVisibilitySettings } from "../../stores/settingsStore";
import { useI18n } from "../../lib/i18n";

type HookInstallStatus = "directoryMissing" | "notInstalled" | "partialInstalled" | "installed";
type HookLightStatus = "missing" | "partial" | "installed";
type HookTool = "claude" | "codex";

interface ToolHookSettingsStatus {
  configDir: string | null;
  status: HookInstallStatus;
}

interface HookSettingsStatus {
  claude: ToolHookSettingsStatus;
  codex: ToolHookSettingsStatus;
  claudeAutoRepaired?: boolean;
}

interface SidebarFooterProps {
  collapsed: boolean;
  onOpenSettings: (tab?: SettingsTab) => void;
  onOpenStats: () => void;
  toolbarVisibility: SidebarToolbarVisibilitySettings;
}

function trimDir(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getApplicableTools(status: HookSettingsStatus | null): HookTool[] {
  if (!status) return [];
  return (["claude", "codex"] as const).filter((tool) => Boolean(status[tool].configDir));
}

function getHookLightStatus(status: HookSettingsStatus | null): HookLightStatus {
  const tools = getApplicableTools(status);
  if (tools.length === 0) return "missing";

  const statuses = tools.map((tool) => status?.[tool].status ?? "directoryMissing");
  if (statuses.every((item) => item === "installed")) return "installed";
  if (statuses.some((item) => item === "installed" || item === "partialInstalled")) return "partial";
  return "missing";
}

function HookStatusLight({ onOpenSettings }: { onOpenSettings: (tab?: SettingsTab) => void }) {
  const { t } = useI18n();
  const claudeHookConfigDir = useSettingsStore((s) => s.claudeHookConfigDir);
  const codexHookConfigDir = useSettingsStore((s) => s.codexHookConfigDir);
  const ccSwitchDbPath = useSettingsStore((s) => s.ccSwitchDbPath);
  const claudeHookAutoRepairKnownInstalled = useSettingsStore((s) => s.claudeHookAutoRepairKnownInstalled);
  const claudeHookAutoRepairNoticeShown = useSettingsStore((s) => s.claudeHookAutoRepairNoticeShown);
  const updateSetting = useSettingsStore((s) => s.update);
  const [status, setStatus] = useState<HookSettingsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);

  const selectedDir = useMemo(() => trimDir(claudeHookConfigDir), [claudeHookConfigDir]);
  const codexSelectedDir = useMemo(() => trimDir(codexHookConfigDir), [codexHookConfigDir]);
  const lightStatus = getHookLightStatus(status);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await invoke<HookSettingsStatus>("hook_settings_get_status", {
        selectedDir,
        codexSelectedDir,
        ccSwitchDbPath: ccSwitchDbPath ?? undefined,
        autoRepair: claudeHookAutoRepairKnownInstalled,
      });
      setStatus(nextStatus);
      if (nextStatus.claudeAutoRepaired && !claudeHookAutoRepairNoticeShown) {
        toast.info("Claude Hook 已自动恢复", {
          description: "检测到 Hook 被外部工具覆盖，已重新写入全局 Hook 配置。",
        });
        void updateSetting("claudeHookAutoRepairNoticeShown", true);
      }
    } catch (error) {
      toast.error(t("sidebar.hook.refreshFailed"), { description: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [
    ccSwitchDbPath,
    claudeHookAutoRepairKnownInstalled,
    claudeHookAutoRepairNoticeShown,
    codexSelectedDir,
    selectedDir,
    updateSetting,
  ]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const reinstallHooks = async () => {
    const tools = getApplicableTools(status);
    if (tools.length === 0) {
      toast.info(t("sidebar.hook.chooseConfigDir"));
      onOpenSettings("hooks");
      return;
    }

    setWorking(true);
    try {
      if (tools.includes("claude")) {
        await invoke<HookSettingsStatus>("hook_settings_uninstall", {
          selectedDir,
          codexSelectedDir,
          ccSwitchDbPath: ccSwitchDbPath ?? undefined,
        });
        await invoke<HookSettingsStatus>("hook_settings_install", {
          selectedDir,
          codexSelectedDir,
          ccSwitchDbPath: ccSwitchDbPath ?? undefined,
        });
        await updateSetting("claudeHookAutoRepairKnownInstalled", true);
        await updateSetting("claudeHookAutoRepairNoticeShown", false);
      }
      if (tools.includes("codex")) {
        await invoke<HookSettingsStatus>("hook_settings_uninstall_codex", {
          selectedDir,
          codexSelectedDir,
          ccSwitchDbPath: ccSwitchDbPath ?? undefined,
        });
        await invoke<HookSettingsStatus>("hook_settings_install_codex", {
          selectedDir,
          codexSelectedDir,
          ccSwitchDbPath: ccSwitchDbPath ?? undefined,
        });
      }
      await refreshStatus();
      toast.success(t("sidebar.hook.reinstalled"));
    } catch (error) {
      toast.error(t("sidebar.hook.reinstallFailed"), { description: getErrorMessage(error) });
      await refreshStatus();
    } finally {
      setWorking(false);
    }
  };

  const handleClick = () => {
    if (lightStatus === "installed") {
      onOpenSettings("hooks");
      return;
    }
    void reinstallHooks();
  };

  const title =
    lightStatus === "installed"
      ? t("sidebar.hook.ok")
      : lightStatus === "partial"
        ? t("sidebar.hook.partial")
        : t("sidebar.hook.missing");

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || working}
      className="ui-focus-ring ui-icon-action ui-sidebar-action-hook"
      data-hook-status={lightStatus}
      title={working ? t("sidebar.hook.working") : title}
      aria-label={title}
    >
      <span className="ui-sidebar-hook-light" aria-hidden="true" />
    </button>
  );
}

export function SidebarFooter({ collapsed, onOpenSettings, onOpenStats, toolbarVisibility }: SidebarFooterProps) {
  const { t } = useI18n();
  const statsButton = toolbarVisibility.stats ? (
    <button
      onClick={onOpenStats}
      className="ui-focus-ring ui-icon-action ui-sidebar-action-stats"
      title={t("sidebar.stats")}
      aria-label={t("sidebar.openStats")}
    >
      <BarChart3 size={14} strokeWidth={1.5} />
    </button>
  ) : null;

  const settingsButton = (
    <button
      onClick={() => onOpenSettings()}
      className="ui-focus-ring ui-icon-action ui-sidebar-action-settings"
      title={t("sidebar.settings")}
      aria-label={t("sidebar.openSettings")}
    >
      <Settings size={14} strokeWidth={1.5} />
    </button>
  );

  if (collapsed) {
    return (
      <div className="px-2 py-2">
        <div className="flex flex-col items-center gap-1.5">
          <SyncStatusIndicator collapsed onOpenSettings={onOpenSettings} />
          {statsButton}
          <HookStatusLight onOpenSettings={onOpenSettings} />
          {settingsButton}
        </div>
      </div>
    );
  }

  return (
    <div className="px-2.5 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SyncStatusIndicator onOpenSettings={onOpenSettings} />
        </div>
        {statsButton}
        <HookStatusLight onOpenSettings={onOpenSettings} />
        {settingsButton}
      </div>
    </div>
  );
}
