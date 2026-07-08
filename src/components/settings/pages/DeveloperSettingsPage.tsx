import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Box, Card, Group, Stack, Switch, Text } from "@mantine/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { Bug, Cpu, HardDrive, Link2, MonitorCog } from "lucide-react";
import { toast } from "sonner";
import { useSettingsStore } from "../../../stores/settingsStore";
import { getOsPlatform, type OsPlatform } from "../../../lib/shell";
import { useI18n, type TranslationKey } from "../../../lib/i18n";
import { ConfirmDialog } from "../../ConfirmDialog";

interface SettingSwitchCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}

function SettingSwitchCard({
  icon,
  title,
  description,
  checked,
  onChange,
  ariaLabel,
}: SettingSwitchCardProps) {
  return (
    <Card className="border border-border bg-surface-container-lowest" p="sm" radius="lg">
      <Group justify="space-between" align="center" gap="md" wrap="nowrap">
        <Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0 }}>
          <Box style={{ color: "var(--primary)", marginTop: 2 }}>{icon}</Box>
          <Box style={{ minWidth: 0 }}>
            <Text size="xs" c="var(--on-surface-variant)">
              {title}
            </Text>
            <Text mt={4} size="xs" lh={1.55} c="var(--text-muted)">
              {description}
            </Text>
          </Box>
        </Group>
        <Switch
          color="cliPrimary"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
          aria-label={ariaLabel}
        />
      </Group>
    </Card>
  );
}

export function DeveloperSettingsPage() {
  const { t } = useI18n();
  const windowsConptyCompatibilityFixEnabled = useSettingsStore((s) => s.windowsConptyCompatibilityFixEnabled);
  const symlinkCompatibilityEnabled = useSettingsStore((s) => s.symlinkCompatibilityEnabled);
  const lowMemoryMode = useSettingsStore((s) => s.lowMemoryMode);
  const disableHardwareAcceleration = useSettingsStore((s) => s.disableHardwareAcceleration);
  const debugMode = useSettingsStore((s) => s.debugMode);
  const update = useSettingsStore((s) => s.update);
  const [osPlatform, setOsPlatform] = useState<OsPlatform>("unknown");
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getOsPlatform().then((platform) => {
      if (!cancelled) setOsPlatform(platform);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateBooleanSetting = (
    key:
      | "symlinkCompatibilityEnabled"
      | "lowMemoryMode"
      | "disableHardwareAcceleration"
      | "debugMode",
    value: boolean
  ) => {
    void update(key, value);
  };

  const toggleWindowsConptyCompatibilityFix = (checked: boolean) => {
    void update("windowsConptyCompatibilityFixEnabled", checked).then(() => {
      setRestartConfirmOpen(true);
    });
  };

  const restartNow = async () => {
    try {
      await relaunch();
    } catch (err) {
      toast.error(t("settings.developer.restartFailed"), { description: String(err) });
    }
  };

  const developerCards: {
    key: string;
    icon: ReactNode;
    titleKey: TranslationKey;
    descriptionKey: TranslationKey;
    checked: boolean;
    onChange: (checked: boolean) => void;
    enabledLabelKey: TranslationKey;
    disabledLabelKey: TranslationKey;
  }[] = [
    {
      key: "symlinkCompatibilityEnabled",
      icon: <Link2 size={16} />,
      titleKey: "settings.general.symlinkCompatibility",
      descriptionKey: "settings.general.symlinkCompatibilityDescription",
      checked: symlinkCompatibilityEnabled,
      onChange: (checked) => updateBooleanSetting("symlinkCompatibilityEnabled", checked),
      enabledLabelKey: "settings.general.disableSymlinkCompatibility",
      disabledLabelKey: "settings.general.enableSymlinkCompatibility",
    },
    {
      key: "lowMemoryMode",
      icon: <HardDrive size={16} />,
      titleKey: "settings.general.lowMemoryMode",
      descriptionKey: "settings.general.lowMemoryModeDescription",
      checked: lowMemoryMode,
      onChange: (checked) => updateBooleanSetting("lowMemoryMode", checked),
      enabledLabelKey: "settings.general.disableLowMemoryMode",
      disabledLabelKey: "settings.general.enableLowMemoryMode",
    },
    {
      key: "disableHardwareAcceleration",
      icon: <Cpu size={16} />,
      titleKey: "settings.general.disableHardwareAcceleration",
      descriptionKey: "settings.general.disableHardwareAccelerationDescription",
      checked: disableHardwareAcceleration,
      onChange: (checked) => updateBooleanSetting("disableHardwareAcceleration", checked),
      enabledLabelKey: "settings.general.allowHardwareAcceleration",
      disabledLabelKey: "settings.general.disableHardwareAccelerationAction",
    },
    {
      key: "debugMode",
      icon: <Bug size={16} />,
      titleKey: "settings.general.debugMode",
      descriptionKey: "settings.developer.debugModeDescription",
      checked: debugMode,
      onChange: (checked) => updateBooleanSetting("debugMode", checked),
      enabledLabelKey: "settings.general.disableDebugMode",
      disabledLabelKey: "settings.general.enableDebugMode",
    },
  ];

  return (
    <Stack gap="md">
      <section className="ui-surface-card rounded-2xl border border-border p-4">
        <Stack gap="sm">
          <Box>
            <Text size="sm" fw={600} c="var(--on-surface)">
              {t("settings.developer.compatibility")}
            </Text>
            <Text mt={4} size="xs" c="var(--text-muted)">
              {t("settings.developer.compatibilityDescription")}
            </Text>
          </Box>

          {osPlatform === "windows" && (
            <SettingSwitchCard
              icon={<MonitorCog size={16} />}
              title={t("settings.developer.windowsConptyCompatibilityFix")}
              description={t("settings.developer.windowsConptyCompatibilityFixDescription")}
              checked={windowsConptyCompatibilityFixEnabled}
              onChange={toggleWindowsConptyCompatibilityFix}
              ariaLabel={
                windowsConptyCompatibilityFixEnabled
                  ? t("settings.developer.disableWindowsConptyCompatibilityFix")
                  : t("settings.developer.enableWindowsConptyCompatibilityFix")
              }
            />
          )}

          {developerCards.map((card) => (
            <SettingSwitchCard
              key={card.key}
              icon={card.icon}
              title={t(card.titleKey)}
              description={t(card.descriptionKey)}
              checked={card.checked}
              onChange={card.onChange}
              ariaLabel={card.checked ? t(card.enabledLabelKey) : t(card.disabledLabelKey)}
            />
          ))}
        </Stack>
      </section>

      <ConfirmDialog
        open={restartConfirmOpen}
        title={t("settings.developer.restartRequiredTitle")}
        message={t("settings.developer.restartRequiredMessage")}
        confirmText={t("settings.developer.restartNow")}
        cancelText={t("settings.developer.restartLater")}
        onConfirm={() => void restartNow()}
        onClose={() => setRestartConfirmOpen(false)}
      />
    </Stack>
  );
}
