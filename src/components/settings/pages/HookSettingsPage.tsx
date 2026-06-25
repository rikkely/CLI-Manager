import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { ActionIcon, Badge, Box, Button, Card, Group, SimpleGrid, Stack, Switch, Text, TextInput } from "@mantine/core";
import { Play, CheckCircle, HelpCircle, ChevronDown, ChevronUp, Folder, FileCode, Copy, Check, X, Activity, Bell, ShieldAlert, ToggleRight, AlertTriangle, BellOff, XCircle, Layers } from "lucide-react";
import { useSettingsStore, type HookEventType } from "@/stores/settingsStore";

type HookInstallStatus = "directoryMissing" | "notInstalled" | "partialInstalled" | "installed";

interface ToolHookSettingsStatus {
  configDir: string | null;
  hooksDir: string | null;
  configPath: string | null;
  featureConfigPath: string | null;
  status: HookInstallStatus;
  attentionScriptInstalled: boolean;
  finishedScriptInstalled: boolean;
  sessionStartHookInstalled: boolean;
  runningHookInstalled: boolean;
  attentionHookInstalled: boolean;
  stopHookInstalled: boolean;
  failureHookInstalled: boolean;
  subagentStartHookInstalled: boolean;
  hooksFeatureInstalled: boolean;
}

interface HookSettingsStatus {
  claude: ToolHookSettingsStatus;
  codex: ToolHookSettingsStatus;
  ccSwitch: CcSwitchHookProtectionStatus;
  claudeAutoRepaired: boolean;
}

type CcSwitchHookProtectionState =
  | "notDetected"
  | "notSynced"
  | "synced"
  | "invalidDb"
  | "unavailable"
  | "syncFailed";

interface CcSwitchHookProtectionStatus {
  state: CcSwitchHookProtectionState;
  dbPath: string | null;
  message: string | null;
  wslMismatch: boolean;
}

const STATUS_LABELS: Record<HookInstallStatus, string> = {
  directoryMissing: "目录未选择",
  notInstalled: "未安装",
  partialInstalled: "部分安装",
  installed: "已安装",
};

const STATUS_COLORS: Record<HookInstallStatus, string> = {
  directoryMissing: "yellow",
  notInstalled: "gray",
  partialInstalled: "yellow",
  installed: "green",
};

const CCSWITCH_STATE_LABELS: Record<CcSwitchHookProtectionState, string> = {
  notDetected: "未检测到 cc-switch",
  notSynced: "未同步",
  synced: "已同步",
  invalidDb: "数据库路径无效",
  unavailable: "不可用",
  syncFailed: "同步失败",
};

const CCSWITCH_STATE_COLORS: Record<CcSwitchHookProtectionState, string> = {
  notDetected: "gray",
  notSynced: "yellow",
  synced: "green",
  invalidDb: "red",
  unavailable: "yellow",
  syncFailed: "red",
};


function formatPath(value: string | null): string {
  return value && value.trim() ? value : "未选择";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCcSwitchMessage(message: string | null): string | null {
  if (!message) return null;
  const messages: Record<string, string> = {
    db_not_found: "设置中的 cc-switch 数据库不存在，请在「设置 -> 供应商」重新选择。",
    unsupported_format: "cc-switch 数据库路径必须指向 .db 文件。",
    wsl_environment_mismatch: "当前 Claude 配置在 WSL 内，cc-switch 数据库在宿主环境，未自动跨环境写入。",
    common_config_parse_failed: "Claude 通用配置片段不是有效 JSON，未自动覆盖。",
  };
  return messages[message] ?? message;
}

function getCcSwitchProtectionDescription(status?: CcSwitchHookProtectionStatus | null): string {
  if (!status) return "正在检测 cc-switch 通用配置保护状态。";
  switch (status.state) {
    case "synced":
      return "已同步到 cc-switch 通用配置片段，切换供应商时会保留 CLI-Manager Hook。";
    case "notSynced":
      return "尚未同步到 cc-switch 通用配置片段，重新安装对应 Hook 可重试。";
    case "notDetected":
      return "未检测到 cc-switch 数据库，Hook 已按普通全局配置工作。";
    case "invalidDb":
      return "设置中的 cc-switch 数据库路径不可用，已停止自动写入以避免误写。";
    case "unavailable":
      return status.wslMismatch
        ? "检测到 WSL 环境不匹配，请在「设置 -> 供应商」选择同一环境内的 cc-switch.db。"
        : "cc-switch 数据库暂不可用于通用配置同步。";
    case "syncFailed":
      return "cc-switch 通用配置同步失败，Hook 本身已安装，可稍后重试。";
  }
}

function CcSwitchProtectionCard({ status }: { status?: CcSwitchHookProtectionStatus | null }) {
  const state = status?.state ?? "notDetected";
  const isHealthy = state === "synced";
  const isWarning = state === "notSynced" || state === "unavailable";
  const Icon = isHealthy ? CheckCircle : isWarning || state === "notDetected" ? HelpCircle : AlertTriangle;
  const formattedMessage = formatCcSwitchMessage(status?.message ?? null);

  return (
    <Card className="border border-border bg-surface-container-low" p="sm" radius="lg">
      <Stack gap="xs">
        <Group justify="space-between" gap="sm" align="flex-start">
          <Group gap="sm" wrap="nowrap" className="min-w-0">
            <Box
              style={{
                color: isHealthy
                  ? "var(--success)"
                  : state === "syncFailed" || state === "invalidDb"
                    ? "var(--error)"
                    : "var(--warning)",
                marginTop: 2,
                flexShrink: 0,
              }}
            >
              <Icon size={18} />
            </Box>
            <Box className="min-w-0">
              <Text size="sm" fw={500} c="var(--on-surface)">
                cc-switch 通用配置保护
              </Text>
              <Text mt={4} size="xs" c="var(--on-surface-variant)">
                {getCcSwitchProtectionDescription(status)}
              </Text>
            </Box>
          </Group>
          <Badge variant="light" color={CCSWITCH_STATE_COLORS[state]} radius="xl" className="shrink-0">
            {CCSWITCH_STATE_LABELS[state]}
          </Badge>
        </Group>
        {status?.dbPath && (
          <Text
            component="code"
            size="xs"
            ff="var(--font-ui-mono)"
            c="var(--on-surface-variant)"
            className="break-all"
          >
            {status.dbPath}
          </Text>
        )}
        {formattedMessage && (
          <Text size="xs" c={state === "syncFailed" || state === "invalidDb" ? "red" : "yellow"}>
            {formattedMessage}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

function PathRow({ label, value }: { label: string; value: string | null }) {
  const formatted = formatPath(value);
  const hasValue = Boolean(value && value.trim());
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!hasValue || !value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getIcon = () => {
    if (label.includes('目录')) return <Folder size={16} />;
    if (label.includes('json') || label.includes('toml')) return <FileCode size={16} />;
    return <FileCode size={16} />;
  };

  return (
    <Card className="border border-border/50 bg-surface-container-lowest" p="sm" radius="md">
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Box
          style={{
            color: hasValue ? "var(--primary)" : "var(--text-muted)",
            marginTop: 2,
          }}
        >
          {getIcon()}
        </Box>
        <Stack gap={4} className="min-w-0 flex-1">
          <Text size="xs" fw={500} c="var(--on-surface-variant)">
            {label}
          </Text>
          <Text
            component="code"
            size="xs"
            ff="var(--font-ui-mono)"
            c={hasValue ? "var(--on-surface)" : "var(--text-muted)"}
            className="min-w-0 break-all leading-5"
            title={formatted}
          >
            {formatted}
          </Text>
        </Stack>
        {hasValue && (
          <Button
            variant="subtle"
            color="gray"
            size="compact-xs"
            onClick={handleCopy}
            className="shrink-0"
            aria-label="复制路径"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        )}
      </Group>
    </Card>
  );
}

interface HookCardProps {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  notifyEnabled?: boolean;
  onToggleNotify?: () => void;
  notifyDisabled?: boolean;
}

function HookCard({ icon, label, checked, notifyEnabled, onToggleNotify, notifyDisabled }: HookCardProps) {
  return (
    <Card
      className="border transition-colors"
      p="md"
      radius="lg"
      style={{
        borderColor: checked ? "var(--success)" : "var(--border)",
        backgroundColor: checked ? "var(--success-container)" : "var(--surface-container-low)",
      }}
    >
      <Stack gap={8} align="center">
        <Box
          style={{
            color: checked ? "var(--success)" : "var(--text-muted)",
            fontSize: 26,
            lineHeight: 1,
          }}
        >
          {icon}
        </Box>
        <Text size="xs" fw={500} c={checked ? "var(--on-success-container)" : "var(--on-surface-variant)"} ta="center" lh={1.3}>
          {label}
        </Text>
        <Group gap={4} align="center" wrap="nowrap">
          <Badge
            variant="filled"
            color={checked ? "green" : "gray"}
            radius="xl"
            size="xs"
          >
            {checked ? "已安装" : "未安装"}
          </Badge>
          {onToggleNotify && (
            <ActionIcon
              variant={notifyEnabled ? "light" : "subtle"}
              color={notifyEnabled ? "blue" : "gray"}
              size="sm"
              radius="xl"
              onClick={(e) => { e.stopPropagation(); onToggleNotify(); }}
              disabled={notifyDisabled}
              aria-label={`${label} 系统通知`}
            >
              {notifyEnabled ? <Bell size={12} /> : <BellOff size={12} />}
            </ActionIcon>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

function StatusPill({ status }: { status: HookInstallStatus }) {
  return (
    <Badge variant="light" color={STATUS_COLORS[status]} radius="xl">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function SettingsSwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
  icon: Icon,
  tools,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  icon?: React.ComponentType<{ size?: number }>;
  tools?: ("claude" | "codex")[];
}) {
  return (
    <Card className="border border-border bg-surface-container-low" p="sm" radius="lg">
      <Group justify="space-between" align="center" gap="md" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" className="min-w-0">
          {Icon && (
            <Box
              style={{
                color: checked ? "var(--primary)" : "var(--text-muted)",
                marginTop: 2,
                flexShrink: 0,
              }}
            >
              <Icon size={18} />
            </Box>
          )}
          <Box className="min-w-0">
            <Group gap="xs" align="center" wrap="wrap">
              <Text size="sm" fw={500} c="var(--on-surface)" className="whitespace-nowrap">
                {title}
              </Text>
              {tools?.map((tool) => (
                <Badge
                  key={tool}
                  variant="light"
                  size="xs"
                  color={tool === "claude" ? "orange" : "blue"}
                  style={{ textTransform: "none" }}
                >
                  {tool === "claude" ? "Claude" : "Codex"}
                </Badge>
              ))}
            </Group>
            <Text mt={4} size="xs" c="var(--text-muted)">
              {description}
            </Text>
          </Box>
        </Group>
        <Switch
          color="cliPrimary"
          className="shrink-0"
          checked={checked}
          onChange={(event) => onCheckedChange(event.currentTarget.checked)}
          aria-label={title}
        />
      </Group>
    </Card>
  );
}

export function HookSettingsPage() {
  const claudeHookConfigDir = useSettingsStore((s) => s.claudeHookConfigDir);
  const codexHookConfigDir = useSettingsStore((s) => s.codexHookConfigDir);
  const [status, setStatus] = useState<HookSettingsStatus | null>(null);
  const [selectedDir, setSelectedDir] = useState<string | null>(claudeHookConfigDir);
  const [codexSelectedDir, setCodexSelectedDir] = useState<string | null>(codexHookConfigDir);
  const [loading, setLoading] = useState(false);
  const [claudeWorking, setClaudeWorking] = useState(false);
  const [codexWorking, setCodexWorking] = useState(false);
  const hookPopupNotificationsEnabled = useSettingsStore((s) => s.hookPopupNotificationsEnabled);
  const hookPopupAutoCloseEnabled = useSettingsStore((s) => s.hookPopupAutoCloseEnabled);
  const hookPopupAutoCloseSeconds = useSettingsStore((s) => s.hookPopupAutoCloseSeconds);
  const systemNotificationsEnabled = useSettingsStore((s) => s.systemNotificationsEnabled);
  const systemNotificationEvents = useSettingsStore((s) => s.systemNotificationEvents);
  const ccSwitchDbPath = useSettingsStore((s) => s.ccSwitchDbPath);
  const claudeHookAutoRepairKnownInstalled = useSettingsStore((s) => s.claudeHookAutoRepairKnownInstalled);
  const claudeHookAutoRepairNoticeShown = useSettingsStore((s) => s.claudeHookAutoRepairNoticeShown);
  const updateSetting = useSettingsStore((s) => s.update);
  const [autoCloseSecondsDraft, setAutoCloseSecondsDraft] = useState(String(hookPopupAutoCloseSeconds));
  const [claudePathsOpen, setClaudePathsOpen] = useState(false);
  const [claudeInfoOpen, setClaudeInfoOpen] = useState(false);
  const [codexPathsOpen, setCodexPathsOpen] = useState(false);
  const [codexInfoOpen, setCodexInfoOpen] = useState(false);

  useEffect(() => {
    setAutoCloseSecondsDraft(String(hookPopupAutoCloseSeconds));
  }, [hookPopupAutoCloseSeconds]);

  const selectedDirArg = useMemo(() => selectedDir ?? undefined, [selectedDir]);
  const codexSelectedDirArg = useMemo(() => codexSelectedDir ?? undefined, [codexSelectedDir]);

  const refreshStatus = async (dir = selectedDirArg, codexDir = codexSelectedDirArg) => {
    setLoading(true);
    try {
      const nextStatus = await invoke<HookSettingsStatus>("hook_settings_get_status", {
        selectedDir: dir,
        codexSelectedDir: codexDir,
        ccSwitchDbPath: ccSwitchDbPath ?? undefined,
        autoRepair: claudeHookAutoRepairKnownInstalled,
      });
      setStatus(nextStatus);
      if (nextStatus.claude.configDir) {
        setSelectedDir(nextStatus.claude.configDir);
      }
      if (nextStatus.codex.configDir) {
        setCodexSelectedDir(nextStatus.codex.configDir);
      }
      if (nextStatus.claudeAutoRepaired && !claudeHookAutoRepairNoticeShown) {
        toast.info("Claude Hook 已自动恢复", {
          description: "检测到 Hook 被外部工具覆盖，已重新写入全局 Hook 配置。",
        });
        await updateSetting("claudeHookAutoRepairNoticeShown", true);
      }
    } catch (error) {
      toast.error("刷新 Hook 状态失败", { description: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const handleSelectDir = async () => {
    try {
      const dir = await invoke<string | null>("hook_settings_select_dir", {
        title: "选择 Claude 配置目录",
      });
      if (!dir) return;
      setSelectedDir(dir);
      await updateSetting("claudeHookConfigDir", dir);
      await refreshStatus(dir, codexSelectedDirArg);
    } catch (error) {
      toast.error("选择目录失败", { description: getErrorMessage(error) });
    }
  };

  const handleSelectCodexDir = async () => {
    try {
      const dir = await invoke<string | null>("hook_settings_select_dir", {
        title: "选择 Codex 配置目录",
      });
      if (!dir) return;
      setCodexSelectedDir(dir);
      await updateSetting("codexHookConfigDir", dir);
      await refreshStatus(selectedDirArg, dir);
    } catch (error) {
      toast.error("选择 Codex 目录失败", { description: getErrorMessage(error) });
    }
  };

  // 手动粘贴配置目录（支持 WSL UNC，如 \\wsl.localhost\Ubuntu-22.04\home\<用户名>\.claude）。
  // 原生选目录弹窗进 WSL 路径体验差，故提供文本输入兜底。
  const handleManualClaudeDirCommit = async (raw: string) => {
    const dir = raw.trim() || null;
    setSelectedDir(dir);
    await updateSetting("claudeHookConfigDir", dir);
    await refreshStatus(dir ?? undefined, codexSelectedDirArg);
  };

  const handleManualCodexDirCommit = async (raw: string) => {
    const dir = raw.trim() || null;
    setCodexSelectedDir(dir);
    await updateSetting("codexHookConfigDir", dir);
    await refreshStatus(selectedDirArg, dir ?? undefined);
  };

  const handleClaudeInstall = async () => {
    setClaudeWorking(true);
    try {
      const nextStatus = await invoke<HookSettingsStatus>("hook_settings_install", {
        selectedDir: selectedDirArg,
        codexSelectedDir: codexSelectedDirArg,
        ccSwitchDbPath: ccSwitchDbPath ?? undefined,
      });
      setStatus(nextStatus);
      if (nextStatus.claude.configDir) setSelectedDir(nextStatus.claude.configDir);
      await updateSetting("claudeHookAutoRepairKnownInstalled", true);
      await updateSetting("claudeHookAutoRepairNoticeShown", false);
      toast.success("Claude Hook 已安装", {
        description: getCcSwitchProtectionDescription(nextStatus.ccSwitch),
      });
    } catch (error) {
      toast.error("安装 Claude Hook 失败", { description: getErrorMessage(error) });
    } finally {
      setClaudeWorking(false);
    }
  };

  const handleClaudeUninstall = async () => {
    setClaudeWorking(true);
    try {
      const nextStatus = await invoke<HookSettingsStatus>("hook_settings_uninstall", {
        selectedDir: selectedDirArg,
        codexSelectedDir: codexSelectedDirArg,
        ccSwitchDbPath: ccSwitchDbPath ?? undefined,
      });
      setStatus(nextStatus);
      if (nextStatus.claude.configDir) setSelectedDir(nextStatus.claude.configDir);
      await updateSetting("claudeHookAutoRepairKnownInstalled", false);
      await updateSetting("claudeHookAutoRepairNoticeShown", false);
      toast.success("Claude Hook 已删除");
    } catch (error) {
      toast.error("删除 Claude Hook 失败", { description: getErrorMessage(error) });
    } finally {
      setClaudeWorking(false);
    }
  };

  const handleCodexInstall = async () => {
    setCodexWorking(true);
    try {
      const nextStatus = await invoke<HookSettingsStatus>("hook_settings_install_codex", {
        selectedDir: selectedDirArg,
        codexSelectedDir: codexSelectedDirArg,
        ccSwitchDbPath: ccSwitchDbPath ?? undefined,
      });
      setStatus(nextStatus);
      if (nextStatus.codex.configDir) setCodexSelectedDir(nextStatus.codex.configDir);
      toast.success("Codex Hook 已安装", {
        description: getCcSwitchProtectionDescription(nextStatus.ccSwitch),
      });
    } catch (error) {
      toast.error("安装 Codex Hook 失败", { description: getErrorMessage(error) });
    } finally {
      setCodexWorking(false);
    }
  };

  const handleCodexUninstall = async () => {
    setCodexWorking(true);
    try {
      const nextStatus = await invoke<HookSettingsStatus>("hook_settings_uninstall_codex", {
        selectedDir: selectedDirArg,
        codexSelectedDir: codexSelectedDirArg,
        ccSwitchDbPath: ccSwitchDbPath ?? undefined,
      });
      setStatus(nextStatus);
      if (nextStatus.codex.configDir) setCodexSelectedDir(nextStatus.codex.configDir);
      toast.success("Codex Hook 已删除");
    } catch (error) {
      toast.error("删除 Codex Hook 失败", { description: getErrorMessage(error) });
    } finally {
      setCodexWorking(false);
    }
  };

  const handleCommitAutoCloseSeconds = () => {
    const nextValue = Number(autoCloseSecondsDraft);
    const nextSeconds = Number.isFinite(nextValue) ? Math.round(nextValue) : hookPopupAutoCloseSeconds;
    const clampedSeconds = Math.max(5, Math.min(3600, nextSeconds));
    setAutoCloseSecondsDraft(String(clampedSeconds));
    if (clampedSeconds !== hookPopupAutoCloseSeconds) {
      void updateSetting("hookPopupAutoCloseSeconds", clampedSeconds);
    }
  };

  const claude = status?.claude;
  const codex = status?.codex;
  const ccSwitchProtection = status?.ccSwitch ?? null;
  const claudeStatus = claude?.status ?? "directoryMissing";
  const codexStatus = codex?.status ?? "directoryMissing";
  const claudeSessionStartInstalled = Boolean(claude?.attentionScriptInstalled && claude.sessionStartHookInstalled);
  const claudeRunningInstalled = Boolean(claude?.attentionScriptInstalled && claude.runningHookInstalled);
  const claudeAttentionInstalled = Boolean(claude?.attentionScriptInstalled && claude.attentionHookInstalled);
  // Claude — 拆分为独立事件
  const claudeStopInstalled = Boolean(claude?.finishedScriptInstalled && claude.stopHookInstalled);
  const claudeFailureInstalled = Boolean(claude?.finishedScriptInstalled && claude.failureHookInstalled);
  const claudeSubagentInstalled = Boolean(claude?.subagentStartHookInstalled);
  const codexSessionStartInstalled = Boolean(codex?.attentionScriptInstalled && codex.sessionStartHookInstalled);
  const codexRunningInstalled = Boolean(codex?.attentionScriptInstalled && codex.runningHookInstalled);
  const codexAttentionInstalled = Boolean(codex?.attentionScriptInstalled && codex.attentionHookInstalled);
  // Codex — 拆分为独立事件
  const codexStopInstalled = Boolean(codex?.finishedScriptInstalled && codex.stopHookInstalled);
  const codexSubagentInstalled = Boolean(codex?.subagentStartHookInstalled);

  // 切换一组 HookEventType 的系统通知状态
  const toggleNotifyEvents = (events: HookEventType[], enabled: boolean) => {
    const update = { ...systemNotificationEvents };
    for (const event of events) {
      update[event] = enabled;
    }
    void updateSetting("systemNotificationEvents", update);
  };
  const notifyState = (events: HookEventType[]) => events.every((e) => systemNotificationEvents[e]);

  return (
    <Stack gap="md">
      <section className="ui-surface-card rounded-2xl border border-border p-4">
        <Stack gap="md">
          <Box>
            <Text size="sm" fw={600} c="var(--on-surface)">
              Hook 通知弹框
            </Text>
            <Text mt={4} size="xs" c="var(--on-surface-variant)">
              控制 Claude Code 和 Codex CLI Hook 事件的右上角弹框；终端标签小圆点不受这里的弹框开关影响。
            </Text>
          </Box>
          <SettingsSwitchRow
            title="通知弹框"
            description="关闭后不再弹出 Hook 通知卡片，只更新标签栏小圆点颜色。"
            checked={hookPopupNotificationsEnabled}
            onCheckedChange={(checked) => void updateSetting("hookPopupNotificationsEnabled", checked)}
          />
          <SettingsSwitchRow
            title="自动关闭弹框"
            description="开启后 Hook 通知会在指定时间后自动消失。"
            checked={hookPopupAutoCloseEnabled}
            onCheckedChange={(checked) => void updateSetting("hookPopupAutoCloseEnabled", checked)}
          />
          <Card className="border border-border bg-surface-container-low" p="sm" radius="lg">
            <Group justify="space-between" align="center" gap="md">
              <Box>
                <Text size="sm" fw={500} c="var(--on-surface)">
                  默认关闭时间
                </Text>
                <Text mt={4} size="xs" c="var(--text-muted)">
                  单位：秒，默认 60 秒；仅在自动关闭开启时可编辑。
                </Text>
              </Box>
              <Group gap="xs">
              <TextInput
                type="number"
                min={5}
                max={3600}
                step={1}
                value={autoCloseSecondsDraft}
                disabled={!hookPopupAutoCloseEnabled}
                onChange={(e) => setAutoCloseSecondsDraft(e.target.value)}
                onBlur={handleCommitAutoCloseSeconds}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCommitAutoCloseSeconds();
                  }
                }}
                w={96}
                size="xs"
                aria-label="Hook 弹框默认关闭时间"
              />
                <Text size="xs" c="var(--on-surface-variant)">
                  秒
                </Text>
              </Group>
            </Group>
          </Card>
        </Stack>
      </section>

      <CcSwitchProtectionCard status={ccSwitchProtection} />

      <Card className="border border-border bg-surface-container-low" p="sm" radius="lg">
        <Group justify="space-between" align="center" gap="md">
          <Group gap="sm">
            <Bell
              size={16}
              style={{ color: systemNotificationsEnabled ? "var(--primary)" : "var(--text-muted)" }}
            />
            <Box>
              <Text size="sm" fw={500} c="var(--on-surface)">
                系统通知
              </Text>
              <Text size="xs" c="var(--on-surface-variant)">
                每个 Hook 卡片下方可独立开关对应事件的系统通知（灰色铃铛=关闭，蓝色铃铛=开启）
              </Text>
            </Box>
          </Group>
          <Switch
            color="cliPrimary"
            checked={systemNotificationsEnabled}
            onChange={(event) => void updateSetting("systemNotificationsEnabled", event.currentTarget.checked)}
            aria-label="启用系统通知"
          />
        </Group>
      </Card>

      <section className="ui-surface-card rounded-2xl border border-border p-4">
        <Stack gap="lg">
          <Group justify="space-between" align="flex-start" gap="md">
            <Box>
              <Text size="sm" fw={600} c="var(--on-surface)">
                Claude Code Hook 桥接
              </Text>
              <Text mt={4} size="xs" c="var(--on-surface-variant)">
                Claude Code 的运行中、待审批、完成和异常退出状态通过 Hook 上报；普通 shell 命令由通用 Shell 运行监控补充。
              </Text>
            </Box>
            <StatusPill status={claudeStatus} />
          </Group>

          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
            <HookCard
              icon={<Play />}
              label="会话启动"
              checked={claudeSessionStartInstalled}
              notifyEnabled={notifyState(["SessionStart"])}
              onToggleNotify={() => toggleNotifyEvents(["SessionStart"], !notifyState(["SessionStart"]))}
              notifyDisabled={!systemNotificationsEnabled}
            />
            <HookCard
              icon={<Activity />}
              label="运行中"
              checked={claudeRunningInstalled}
              notifyEnabled={notifyState(["UserPromptSubmit"])}
              onToggleNotify={() => toggleNotifyEvents(["UserPromptSubmit"], !notifyState(["UserPromptSubmit"]))}
              notifyDisabled={!systemNotificationsEnabled}
            />
            <HookCard
              icon={<Bell />}
              label="待审批"
              checked={claudeAttentionInstalled}
              notifyEnabled={notifyState(["Notification"])}
              onToggleNotify={() => toggleNotifyEvents(["Notification"], !notifyState(["Notification"]))}
              notifyDisabled={!systemNotificationsEnabled}
            />
            <HookCard
              icon={<CheckCircle />}
              label="任务完成"
              checked={claudeStopInstalled}
              notifyEnabled={notifyState(["Stop"])}
              onToggleNotify={() => toggleNotifyEvents(["Stop"], !notifyState(["Stop"]))}
              notifyDisabled={!systemNotificationsEnabled}
            />
            <HookCard
              icon={<XCircle size={26} />}
              label="执行失败"
              checked={claudeFailureInstalled}
              notifyEnabled={notifyState(["StopFailure"])}
              onToggleNotify={() => toggleNotifyEvents(["StopFailure"], !notifyState(["StopFailure"]))}
              notifyDisabled={!systemNotificationsEnabled}
            />
            <HookCard
              icon={<Layers size={26} />}
              label="子 Agent"
              checked={claudeSubagentInstalled}
            />
          </SimpleGrid>

          <Group gap="xs">
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              onClick={() => setClaudePathsOpen(!claudePathsOpen)}
              leftSection={claudePathsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            >
              查看配置路径
            </Button>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              onClick={() => setClaudeInfoOpen(!claudeInfoOpen)}
              leftSection={<HelpCircle size={14} />}
            >
              安装说明
            </Button>
          </Group>

          {claudePathsOpen && (
            <Card className="bg-surface-container-low/50" p="sm" radius="lg">
              <Stack gap="xs">
                <PathRow label="Claude 配置目录" value={claude?.configDir ?? selectedDir} />
                <PathRow label="hooks 目录" value={claude?.hooksDir ?? null} />
                <PathRow label="settings.json" value={claude?.configPath ?? null} />
              </Stack>
            </Card>
          )}

          {claudeInfoOpen && (
            <Card className="bg-surface-container-low/50" p="md" radius="lg">
              <Stack gap="md">
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <Box style={{ color: "var(--success)", marginTop: 2 }}>
                    <Check size={18} />
                  </Box>
                  <Stack gap={4}>
                    <Text size="xs" fw={500} c="var(--on-surface)">
                      安装内容
                    </Text>
                    <Stack gap={2}>
                      <Group gap="xs">
                        <FileCode size={12} style={{ color: "var(--text-muted)" }} />
                        <Text size="xs" c="var(--on-surface-variant)" ff="var(--font-ui-mono)">
                          settings.json 注册 __hook 命令
                        </Text>
                      </Group>
                      <Group gap="xs">
                        <FileCode size={12} style={{ color: "var(--text-muted)" }} />
                        <Text size="xs" c="var(--on-surface-variant)">
                          指向本程序，跨平台无需脚本
                        </Text>
                      </Group>
                    </Stack>
                  </Stack>
                </Group>

                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <Box style={{ color: "var(--warning)", marginTop: 2 }}>
                    <X size={18} />
                  </Box>
                  <Stack gap={4}>
                    <Text size="xs" fw={500} c="var(--on-surface)">
                      删除时保留
                    </Text>
                    <Stack gap={2}>
                      <Text size="xs" c="var(--on-surface-variant)">
                        • 用户自己的 hooks
                      </Text>
                      <Text size="xs" c="var(--on-surface-variant)">
                        • 其它工具注册的 hook 命令
                      </Text>

                    </Stack>
                  </Stack>
                </Group>
              </Stack>
            </Card>
          )}

          <TextInput
            size="xs"
            label="Claude 配置目录（可手动粘贴，支持 WSL UNC）"
            placeholder="\\wsl.localhost\Ubuntu-22.04\home\用户名\.claude"
            value={selectedDir ?? ""}
            onChange={(e) => setSelectedDir(e.currentTarget.value || null)}
            onBlur={(e) => void handleManualClaudeDirCommit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleManualClaudeDirCommit(e.currentTarget.value);
            }}
            disabled={loading || claudeWorking || codexWorking}
          />

          <Group gap="xs">
            <Button variant="light" color="cliPrimary" size="xs" onClick={handleSelectDir} disabled={loading || claudeWorking || codexWorking}>
              选择 Claude 目录
            </Button>
            <Button color="cliPrimary" size="xs" onClick={handleClaudeInstall} disabled={loading || claudeWorking || claudeStatus === "directoryMissing"}>
              {claudeWorking ? "处理中..." : "安装 Claude Hook"}
            </Button>
            <Button variant="light" color="red" size="xs" onClick={handleClaudeUninstall} disabled={loading || claudeWorking || claudeStatus === "directoryMissing"}>
              删除 Claude Hook
            </Button>
            <Button variant="default" color="gray" size="xs" onClick={() => void refreshStatus()} disabled={loading || claudeWorking || codexWorking}>
              {loading ? "刷新中..." : "刷新状态"}
            </Button>
          </Group>
        </Stack>
      </section>

      <section className="ui-surface-card rounded-2xl border border-border p-4">
        <Stack gap="lg">
          <Group justify="space-between" align="flex-start" gap="md">
            <Box>
              <Text size="sm" fw={600} c="var(--on-surface)">
                Codex CLI Hook 桥接
              </Text>
              <Text mt={4} size="xs" c="var(--on-surface-variant)">
                Codex 的运行中、待审批和完成状态通过 Hook 上报；普通 shell 命令由通用 Shell 运行监控补充。
              </Text>
            </Box>
            <StatusPill status={codexStatus} />
          </Group>

          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
            <HookCard
              icon={<Play />}
              label="会话启动"
              checked={codexSessionStartInstalled}
              notifyEnabled={notifyState(["SessionStart"])}
              onToggleNotify={() => toggleNotifyEvents(["SessionStart"], !notifyState(["SessionStart"]))}
              notifyDisabled={!systemNotificationsEnabled}
            />
            <HookCard
              icon={<Activity />}
              label="运行中"
              checked={codexRunningInstalled}
              notifyEnabled={notifyState(["UserPromptSubmit"])}
              onToggleNotify={() => toggleNotifyEvents(["UserPromptSubmit"], !notifyState(["UserPromptSubmit"]))}
              notifyDisabled={!systemNotificationsEnabled}
            />
            <HookCard
              icon={<ShieldAlert />}
              label="需要审批"
              checked={codexAttentionInstalled}
              notifyEnabled={notifyState(["PermissionRequest"])}
              onToggleNotify={() => toggleNotifyEvents(["PermissionRequest"], !notifyState(["PermissionRequest"]))}
              notifyDisabled={!systemNotificationsEnabled}
            />
            <HookCard
              icon={<CheckCircle />}
              label="完成"
              checked={codexStopInstalled}
              notifyEnabled={notifyState(["Stop"])}
              onToggleNotify={() => toggleNotifyEvents(["Stop"], !notifyState(["Stop"]))}
              notifyDisabled={!systemNotificationsEnabled}
            />
            <HookCard
              icon={<Layers size={26} />}
              label="子 Agent"
              checked={codexSubagentInstalled}
            />
            <HookCard
              icon={<ToggleRight />}
              label="Hooks 功能"
              checked={Boolean(codex?.hooksFeatureInstalled)}
            />
          </SimpleGrid>

          <Group gap="xs">
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              onClick={() => setCodexPathsOpen(!codexPathsOpen)}
              leftSection={codexPathsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            >
              查看配置路径
            </Button>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              onClick={() => setCodexInfoOpen(!codexInfoOpen)}
              leftSection={<HelpCircle size={14} />}
            >
              安装说明
            </Button>
          </Group>

          {codexPathsOpen && (
            <Card className="bg-surface-container-low/50" p="sm" radius="lg">
              <Stack gap="xs">
                <PathRow label="Codex 配置目录" value={codex?.configDir ?? codexSelectedDir} />
                <PathRow label="hooks 目录" value={codex?.hooksDir ?? null} />
                <PathRow label="hooks.json" value={codex?.configPath ?? null} />
                <PathRow label="config.toml" value={codex?.featureConfigPath ?? null} />
              </Stack>
            </Card>
          )}

          {codexInfoOpen && (
            <Card className="bg-surface-container-low/50" p="md" radius="lg">
              <Stack gap="md">
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <Box style={{ color: "var(--success)", marginTop: 2 }}>
                    <Check size={18} />
                  </Box>
                  <Stack gap={4}>
                    <Text size="xs" fw={500} c="var(--on-surface)">
                      安装内容
                    </Text>
                    <Stack gap={2}>
                      <Group gap="xs">
                        <FileCode size={12} style={{ color: "var(--text-muted)" }} />
                        <Text size="xs" c="var(--on-surface-variant)" ff="var(--font-ui-mono)">
                          hooks.json 注册 __hook 命令
                        </Text>
                      </Group>
                      <Group gap="xs">
                        <FileCode size={12} style={{ color: "var(--text-muted)" }} />
                        <Text size="xs" c="var(--on-surface-variant)">
                          指向本程序，跨平台无需脚本
                        </Text>
                      </Group>
                      <Group gap="xs">
                        <FileCode size={12} style={{ color: "var(--text-muted)" }} />
                        <Text size="xs" c="var(--on-surface-variant)">
                          config.toml 中开启 <span className="font-mono">[features].hooks = true</span>
                        </Text>
                      </Group>
                    </Stack>
                  </Stack>
                </Group>

                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <Box style={{ color: "var(--warning)", marginTop: 2 }}>
                    <AlertTriangle size={18} />
                  </Box>
                  <Stack gap={4}>
                    <Text size="xs" fw={500} c="var(--on-surface)">
                      注意事项
                    </Text>
                    <Stack gap={2}>
                      <Text size="xs" c="var(--on-surface-variant)">
                        • 不修改项目级 <span className="font-mono">.codex/hooks.json</span>
                      </Text>
                      <Text size="xs" c="var(--on-surface-variant)">
                        • Codex 0.129+ 仍需在 TUI 执行 <span className="font-mono">/hooks</span> 批准脚本
                      </Text>
                    </Stack>
                  </Stack>
                </Group>
              </Stack>
            </Card>
          )}

          <TextInput
            size="xs"
            label="Codex 配置目录（可手动粘贴，支持 WSL UNC）"
            placeholder="\\wsl.localhost\Ubuntu-22.04\home\用户名\.codex"
            value={codexSelectedDir ?? ""}
            onChange={(e) => setCodexSelectedDir(e.currentTarget.value || null)}
            onBlur={(e) => void handleManualCodexDirCommit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleManualCodexDirCommit(e.currentTarget.value);
            }}
            disabled={loading || claudeWorking || codexWorking}
          />

          <Group gap="xs">
            <Button variant="light" color="cliPrimary" size="xs" onClick={handleSelectCodexDir} disabled={loading || claudeWorking || codexWorking}>
              选择 Codex 目录
            </Button>
            <Button color="cliPrimary" size="xs" onClick={handleCodexInstall} disabled={loading || codexWorking || codexStatus === "directoryMissing"}>
              {codexWorking ? "处理中..." : "安装 Codex Hook"}
            </Button>
            <Button variant="light" color="red" size="xs" onClick={handleCodexUninstall} disabled={loading || codexWorking || codexStatus === "directoryMissing"}>
              删除 Codex Hook
            </Button>
            <Button variant="default" color="gray" size="xs" onClick={() => void refreshStatus()} disabled={loading || claudeWorking || codexWorking}>
              {loading ? "刷新中..." : "刷新状态"}
            </Button>
          </Group>
        </Stack>
      </section>
    </Stack>
  );
}
