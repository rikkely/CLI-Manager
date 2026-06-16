import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { AlertTriangle, Copy } from "@/components/icons";
import { useSettingsStore } from "@/stores/settingsStore";

interface CcSwitchProvider {
  id: string;
  appType: string;
  name: string;
  category: string | null;
  websiteUrl: string | null;
  notes: string | null;
  sortIndex: number | null;
  createdAt: number | null;
  isCurrent: boolean;
  baseUrl: string | null;
  model: string | null;
  apiFormat: string | null;
  maskedEnv: Record<string, string>;
  configParseError: boolean;
  rawSettingsConfig: string;
}

interface CcSwitchProvidersResponse {
  dbPath: string;
  providers: CcSwitchProvider[];
}

interface CcSwitchConfigSnippet {
  id: string;
  name: string;
  description: string | null;
  configJson: string;
  createdAt: number | null;
}

interface CcSwitchConfigSnippetsResponse {
  dbPath: string;
  snippets: CcSwitchConfigSnippet[];
}

const jsonCodeBlockStyles = `
.json-code-block {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 16px;
  overflow-y: auto;
  font-family: var(--font-ui-mono);
}

.json-code-block pre {
  margin: 0;
  padding: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
}

.json-key { color: #9cdcfe; }
.json-string { color: #ce9178; }
.json-number { color: #b5cea8; }
.json-boolean { color: #569cd6; }
`;

const ERROR_HINTS: Record<string, string> = {
  db_not_found: "未找到 cc-switch 数据库文件，请确认已安装 cc-switch，或手动选择 cc-switch.db。",
  unsupported_format: "所选文件不是 .db 数据库文件，请重新选择。",
};

function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  for (const [code, hint] of Object.entries(ERROR_HINTS)) {
    if (message.startsWith(code)) return hint;
  }
  return `读取 cc-switch 数据库失败：${message}`;
}

function CopyButton({ value, label = "已复制" }: { value: string; label?: string }) {
  return (
    <ActionIcon
      size="xs"
      variant="subtle"
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast.success(label);
      }}
      title="复制"
    >
      <Copy size={12} />
    </ActionIcon>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function JsonCodeBlock({ json, maxHeight = "400px" }: { json: string; maxHeight?: string }) {
  // 简单的 JSON 语法高亮（纯 CSS）；先转义 HTML 再注入 span，避免 XSS
  const highlightedJson = useMemo(() => {
    // escapeHtml 仅转义 & < >，引号保留，正则可直接匹配
    return escapeHtml(json)
      .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:') // 键名
      .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>') // 字符串值
      .replace(/: (-?\d+(?:\.\d+)?)/g, ': <span class="json-number">$1</span>') // 数字
      .replace(/: (true|false|null)/g, ': <span class="json-boolean">$1</span>'); // 布尔/null
  }, [json]);

  return (
    <Box className="json-code-block ui-thin-scroll" style={{ maxHeight }}>
      <pre dangerouslySetInnerHTML={{ __html: highlightedJson }} />
    </Box>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Group gap="md" wrap="nowrap" className="min-w-0">
      <Text size="xs" c="var(--text-muted)" w={88} className="shrink-0">
        {label}
      </Text>
      <Text
        component="code"
        size="xs"
        ff="var(--font-ui-mono)"
        c="var(--on-surface)"
        className="min-w-0 flex-1 break-all leading-5"
        title={value}
      >
        {value}
      </Text>
    </Group>
  );
}

function ProviderListItem({
  provider,
  isSelected,
  onClick,
}: {
  provider: CcSwitchProvider;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
        isSelected
          ? "border-accent/40 bg-accent/10"
          : "border-border bg-bg-tertiary hover:opacity-80"
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-text-primary" title={provider.name}>
            {provider.name}
          </span>
          {provider.isCurrent && (
            <Badge variant="light" color="green" radius="xl" size="xs" className="shrink-0">
              当前
            </Badge>
          )}
          {provider.category && (
            <Badge variant="light" color="gray" radius="xl" size="xs" className="shrink-0">
              {provider.category}
            </Badge>
          )}
        </span>
      </span>
    </button>
  );
}

function ProviderDetailPanel({ provider }: { provider: CcSwitchProvider }) {
  const ccSwitchDbPath = useSettingsStore((s) => s.ccSwitchDbPath);
  const envEntries = Object.entries(provider.maskedEnv);
  const websiteUrl = provider.websiteUrl;
  // 优化 9: 环境变量折叠状态
  const [envExpanded, setEnvExpanded] = useState(false);
  const displayedEnv = envExpanded ? envEntries : envEntries.slice(0, 5);
  const hasMoreEnv = envEntries.length > 5;

  // 配置片段加载
  const [snippets, setSnippets] = useState<CcSwitchConfigSnippet[]>([]);
  const [snippetsLoaded, setSnippetsLoaded] = useState(false);

  // 加载配置片段
  useEffect(() => {
    const loadSnippets = async () => {
      try {
        const response = await invoke<CcSwitchConfigSnippetsResponse>(
          "ccswitch_list_config_snippets",
          { dbPath: ccSwitchDbPath ?? undefined }
        );
        setSnippets(response.snippets);
      } catch {
        setSnippets([]);
      } finally {
        setSnippetsLoaded(true);
      }
    };
    void loadSnippets();
  }, [ccSwitchDbPath]);

  // 解析供应商配置中的片段引用
  const { providerConfig, referencedSnippets } = useMemo(() => {
    try {
      const config = JSON.parse(provider.rawSettingsConfig);
      const refs = config.config_snippet_refs || [];
      const referenced = refs
        .map((refId: string) => snippets.find((s) => s.id === refId))
        .filter(Boolean);
      return { providerConfig: config, referencedSnippets: referenced };
    } catch {
      return { providerConfig: null, referencedSnippets: [] };
    }
  }, [provider.rawSettingsConfig, snippets]);

  // 合并配置：片段 → 供应商配置（供应商优先）
  const mergedConfig = useMemo(() => {
    if (!snippetsLoaded || !providerConfig) return null;
    if (referencedSnippets.length === 0) return providerConfig;

    let merged = {};
    for (const snippet of referencedSnippets) {
      try {
        const snippetConfig = JSON.parse(snippet.configJson);
        merged = { ...merged, ...snippetConfig };
      } catch {
        // 片段解析失败，跳过
      }
    }
    merged = { ...merged, ...providerConfig };
    return merged;
  }, [providerConfig, referencedSnippets, snippetsLoaded]);

  // 切换供应商时重置折叠状态
  useEffect(() => {
    setEnvExpanded(false);
  }, [provider.id]);

  return (
    <Card className="border border-border bg-surface-container-low" p="md" radius="lg">
      <Stack gap="md">
        <Box>
          <Group gap="xs" wrap="wrap">
            <Text size="lg" fw={600} c="var(--on-surface)">
              {provider.name}
            </Text>
            {provider.isCurrent && (
              <Badge variant="light" color="green" radius="xl">
                全局当前
              </Badge>
            )}
            {provider.category && (
              <Badge variant="light" color="gray" radius="xl">
                {provider.category}
              </Badge>
            )}
            {provider.apiFormat && (
              <Badge variant="light" color="blue" radius="xl">
                {provider.apiFormat}
              </Badge>
            )}
            {provider.configParseError && (
              <Badge variant="light" color="red" radius="xl">
                配置解析失败
              </Badge>
            )}
          </Group>
          {websiteUrl && (
            <Button
              size="compact-sm"
              variant="subtle"
              mt="xs"
              onClick={() => {
                void openUrl(websiteUrl).catch((err) => {
                  toast.error("无法打开链接", { description: String(err) });
                });
              }}
            >
              官网
            </Button>
          )}
        </Box>

        {provider.configParseError && (
          <Box className="rounded border border-danger/40 bg-danger/10 px-2 py-1.5">
            <Text size="xs" c="var(--danger)">
              该供应商配置解析失败，env 数据可能不完整，无法应用到项目。
            </Text>
          </Box>
        )}

        <Divider />

        <Stack gap="xs">
          {provider.baseUrl && (
            <Group gap="md" wrap="nowrap" className="min-w-0">
              <Text size="xs" c="var(--text-muted)" w={88} className="shrink-0">
                BASE_URL
              </Text>
              <Text
                component="code"
                size="xs"
                ff="var(--font-ui-mono)"
                c="var(--on-surface)"
                className="min-w-0 flex-1 break-all leading-5"
                title={provider.baseUrl}
              >
                {provider.baseUrl}
              </Text>
              <CopyButton value={provider.baseUrl} />
            </Group>
          )}
          {provider.model && <InfoRow label="模型" value={provider.model} />}
          {provider.notes && (
            <Box>
              <Text size="xs" c="var(--text-muted)" mb={4}>
                备注
              </Text>
              <Text size="xs" c="var(--on-surface)" className="break-all">
                {provider.notes}
              </Text>
            </Box>
          )}
        </Stack>

        {envEntries.length > 0 && (
          <>
            <Divider />
            <Box>
              <Text size="xs" c="var(--text-muted)" mb="xs">
                环境变量 ({envEntries.length})
              </Text>
              <Stack gap={4} className="rounded-md bg-surface-container-lowest/70 px-3 py-2">
                {displayedEnv.map(([key, value]) => (
                  <Group key={key} gap="xs" wrap="nowrap" justify="space-between">
                    <Text
                      component="code"
                      size="xs"
                      ff="var(--font-ui-mono)"
                      c="var(--on-surface)"
                      className="min-w-0 flex-1 break-all leading-5"
                    >
                      {key}={value}
                    </Text>
                    <CopyButton value={`${key}=${value}`} />
                  </Group>
                ))}
              </Stack>
              {hasMoreEnv && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  mt="xs"
                  onClick={() => setEnvExpanded(!envExpanded)}
                >
                  {envExpanded ? "收起" : `展开全部（还有 ${envEntries.length - 5} 个）`}
                </Button>
              )}
            </Box>
          </>
        )}

        <Divider />

        {/* 配置 Tabs */}
        <Tabs defaultValue="provider" variant="outline">
          <Tabs.List>
            <Tabs.Tab value="provider">供应商配置</Tabs.Tab>
            {snippetsLoaded && referencedSnippets.length > 0 && (
              <Tabs.Tab value="snippets">通用片段 ({referencedSnippets.length})</Tabs.Tab>
            )}
            <Tabs.Tab value="merged">完整配置</Tabs.Tab>
          </Tabs.List>

          {/* Tab 1: 供应商配置 */}
          <Tabs.Panel value="provider" pt="xs">
            <Group justify="space-between" mb="xs">
              <Text size="xs" c="var(--text-muted)">
                供应商原始配置
              </Text>
              <CopyButton value={provider.rawSettingsConfig} label="已复制" />
            </Group>
            {providerConfig ? (
              <JsonCodeBlock json={JSON.stringify(providerConfig, null, 2)} />
            ) : (
              <Box className="rounded-md bg-surface-container-lowest/70 px-3 py-2">
                <Text size="xs" c="var(--text-muted)">
                  配置解析失败
                </Text>
              </Box>
            )}
          </Tabs.Panel>

          {/* Tab 2: 通用片段 */}
          {snippetsLoaded && referencedSnippets.length > 0 && (
            <Tabs.Panel value="snippets" pt="xs">
              <Stack gap="sm">
                {referencedSnippets.map((snippet: CcSwitchConfigSnippet) => (
                  <Box key={snippet.id}>
                    <Group justify="space-between" mb="xs">
                      <Box>
                        <Text size="xs" fw={500} c="var(--on-surface)">
                          {snippet.name}
                        </Text>
                        {snippet.description && (
                          <Text size="xs" c="var(--text-muted)">
                            {snippet.description}
                          </Text>
                        )}
                      </Box>
                      <CopyButton value={snippet.configJson} label="已复制片段" />
                    </Group>
                    <JsonCodeBlock
                      json={(() => {
                        try {
                          return JSON.stringify(JSON.parse(snippet.configJson), null, 2);
                        } catch {
                          return snippet.configJson;
                        }
                      })()}
                      maxHeight="200px"
                    />
                  </Box>
                ))}
              </Stack>
            </Tabs.Panel>
          )}

          {/* Tab 3: 完整配置 */}
          <Tabs.Panel value="merged" pt="xs">
            <Group justify="space-between" mb="xs">
              <Text size="xs" c="var(--text-muted)">
                {snippetsLoaded && referencedSnippets.length > 0
                  ? "供应商配置 + 通用片段合并结果"
                  : "供应商配置（无片段引用）"}
              </Text>
              <CopyButton
                value={mergedConfig ? JSON.stringify(mergedConfig, null, 2) : provider.rawSettingsConfig}
                label="已复制完整配置"
              />
            </Group>
            {mergedConfig ? (
              <JsonCodeBlock json={JSON.stringify(mergedConfig, null, 2)} />
            ) : (
              <Box className="rounded-md bg-surface-container-lowest/70 px-3 py-2">
                <Text size="xs" c="var(--text-muted)">
                  加载中...
                </Text>
              </Box>
            )}
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Card>
  );
}

function EmptyStateGuideCard() {
  return (
    <Card className="border border-border bg-surface-container-low" p="md" radius="lg">
      <Stack gap="md">
        <Box>
          <Text size="lg" fw={600} c="var(--on-surface)" mb="xs">
            欢迎使用供应商设置
          </Text>
          <Text size="sm" c="var(--text-muted)" mb="md">
            cc-switch 是一款供应商切换工具，可以帮助你管理多个 AI 服务提供商的配置。
          </Text>
        </Box>

        <Divider />

        <Box>
          <Text size="sm" fw={500} c="var(--on-surface)" mb="xs">
            开始使用
          </Text>
          <Stack gap="xs">
            <Group gap="xs">
              <Badge variant="light" color="blue" radius="xl" size="sm">
                1
              </Badge>
              <Text size="sm" c="var(--on-surface)">
                安装 cc-switch
              </Text>
            </Group>
            <Group gap="xs">
              <Badge variant="light" color="blue" radius="xl" size="sm">
                2
              </Badge>
              <Text size="sm" c="var(--on-surface)">
                配置你的供应商
              </Text>
            </Group>
            <Group gap="xs">
              <Badge variant="light" color="blue" radius="xl" size="sm">
                3
              </Badge>
              <Text size="sm" c="var(--on-surface)">
                回到此页点击刷新
              </Text>
            </Group>
          </Stack>
        </Box>

        <Button
          variant="light"
          onClick={() => {
            void openUrl("https://github.com/deanxv/cc-switch").catch((err) => {
              toast.error("无法打开链接", { description: String(err) });
            });
          }}
        >
          访问 cc-switch 官网
        </Button>
      </Stack>
    </Card>
  );
}

export function ProviderSettingsPage({ searchValue }: { searchValue: string }) {
  const ccSwitchDbPath = useSettingsStore((s) => s.ccSwitchDbPath);
  const updateSetting = useSettingsStore((s) => s.update);
  const [data, setData] = useState<CcSwitchProvidersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appTypeFilter, setAppTypeFilter] = useState("claude");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  const loadProviders = useCallback(async (showToast = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await invoke<CcSwitchProvidersResponse>("ccswitch_list_providers", {
        dbPath: ccSwitchDbPath ?? undefined,
      });
      setData(response);
      // 优化 7: 刷新成功反馈（仅在手动刷新时显示）
      if (showToast) {
        toast.success(`已刷新，共 ${response.providers.length} 个供应商`);
      }
    } catch (err) {
      setData(null);
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [ccSwitchDbPath]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const pickDbFile = async () => {
    let selected: string | string[] | null = null;
    try {
      selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "SQLite 数据库", extensions: ["db"] }],
      });
    } catch (err) {
      toast.error("无法打开文件选择器", { description: String(err) });
      return;
    }
    if (typeof selected === "string" && selected.trim()) {
      await updateSetting("ccSwitchDbPath", selected);
    }
  };

  const resetDbPath = async () => {
    await updateSetting("ccSwitchDbPath", null);
  };

  const appTypeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const provider of data?.providers ?? []) {
      counts.set(provider.appType, (counts.get(provider.appType) ?? 0) + 1);
    }
    const types = [...counts.keys()].sort((a, b) =>
      a === "claude" ? -1 : b === "claude" ? 1 : a.localeCompare(b)
    );
    return types.map((type) => ({
      value: type,
      label: `${type} (${counts.get(type)})`,
    }));
  }, [data]);

  useEffect(() => {
    if (appTypeOptions.length === 0) return;
    if (!appTypeOptions.some((option) => option.value === appTypeFilter)) {
      setAppTypeFilter(appTypeOptions[0].value);
    }
  }, [appTypeOptions, appTypeFilter]);

  const providersByType = useMemo(() => {
    return (data?.providers ?? []).reduce((acc, p) => {
      if (!acc[p.appType]) acc[p.appType] = [];
      acc[p.appType].push(p);
      return acc;
    }, {} as Record<string, CcSwitchProvider[]>);
  }, [data]);

  const visibleProviders = useMemo(() => {
    const list = providersByType[appTypeFilter] ?? [];
    const keyword = searchValue.trim().toLowerCase();
    if (!keyword) return list;
    return list.filter((provider) => {
      return [
        provider.name,
        provider.baseUrl,
        provider.category,
        provider.model,
        provider.websiteUrl,
        provider.notes,
      ]
        .filter((field): field is string => typeof field === "string")
        .some((field) => field.toLowerCase().includes(keyword));
    });
  }, [providersByType, appTypeFilter, searchValue]);

  useEffect(() => {
    if (visibleProviders.length === 0) {
      setSelectedProviderId(null);
    } else if (!selectedProviderId || !visibleProviders.some((p) => p.id === selectedProviderId)) {
      setSelectedProviderId(visibleProviders[0].id);
    }
  }, [visibleProviders, selectedProviderId]);

  const selectedProvider = visibleProviders.find((p) => p.id === selectedProviderId) ?? null;

  return (
    <Stack gap="md" className="flex-1">
      <style>{jsonCodeBlockStyles}</style>
      <Card className="border border-border bg-surface-container-low" p="sm" radius="lg">
        <Stack gap="xs">
          <Group justify="space-between" align="center" gap="md" wrap="nowrap">
            <Box className="min-w-0 flex-1">
              <Group gap="xs" mb={4}>
                <Text size="sm" fw={500} c="var(--on-surface)">
                  cc-switch 数据库
                </Text>
                <Badge variant="light" color={data ? "green" : "gray"} radius="xl" size="sm">
                  {data ? "已连接" : "未连接"}
                </Badge>
              </Group>
              <Text size="xs" c="var(--text-muted)">
                只读解析 cc-switch 的供应商配置；密钥已脱敏，留空使用默认路径
                ~/.cc-switch/cc-switch.db。
              </Text>
            </Box>
            <Group gap="xs" className="shrink-0">
              <Button size="compact-sm" variant="default" onClick={() => void pickDbFile()}>
                选择文件
              </Button>
              {ccSwitchDbPath && (
                <Button size="compact-sm" variant="subtle" color="gray" onClick={() => void resetDbPath()}>
                  使用默认路径
                </Button>
              )}
              <Button size="compact-sm" variant="default" onClick={() => void loadProviders(true)} loading={loading}>
                刷新
              </Button>
            </Group>
          </Group>
          <Box className="rounded bg-surface-container-lowest/70 px-3 py-2">
            <Text
              component="code"
              size="xs"
              ff="var(--font-ui-mono)"
              c="var(--on-surface)"
              className="break-all leading-5"
            >
              {data?.dbPath ?? ccSwitchDbPath ?? "默认路径"}
            </Text>
          </Box>
        </Stack>
      </Card>

      {error && (
        <Card className="border border-danger/40 bg-surface-container-low" p="sm" radius="lg">
          <Group gap="xs" align="start">
            <AlertTriangle size={16} className="shrink-0 text-danger" />
            <Text size="sm" c="var(--danger)" className="flex-1">
              {error}
            </Text>
          </Group>
        </Card>
      )}

      {!data && !loading && !error && <EmptyStateGuideCard />}

      {loading && !data && (
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      )}

      {data && appTypeOptions.length > 0 && (
        <SegmentedControl
          value={appTypeFilter}
          onChange={setAppTypeFilter}
          data={appTypeOptions}
          size="xs"
          className="self-start"
        />
      )}

      {/* 优化 8: 供应商数量提示 */}
      {data && visibleProviders.length > 0 && (
        <Text size="xs" c="var(--text-muted)">
          共 {visibleProviders.length} 个供应商
        </Text>
      )}

      {data && visibleProviders.length === 0 && !loading && (
        <Text size="sm" c="var(--text-muted)" py="md">
          {searchValue.trim()
            ? `未找到匹配「${searchValue.trim()}」的供应商，已搜索：名称、BASE_URL、分类、模型、官网、备注`
            : "该类型下没有供应商。"}
        </Text>
      )}

      {data && visibleProviders.length > 0 && (
        <Box className="flex min-h-0 flex-1 gap-4">
          <Box className="min-w-[280px] max-w-[400px] w-[30%] shrink-0 space-y-1 overflow-y-auto">
            {visibleProviders.map((provider) => (
              <ProviderListItem
                key={`${provider.appType}-${provider.id}`}
                provider={provider}
                isSelected={provider.id === selectedProviderId}
                onClick={() => setSelectedProviderId(provider.id)}
              />
            ))}
          </Box>
          <Box className="min-w-0 flex-1 overflow-y-auto">
            {selectedProvider ? (
              <ProviderDetailPanel provider={selectedProvider} />
            ) : (
              <Text size="sm" c="var(--text-muted)" py="md">
                请选择一个供应商
              </Text>
            )}
          </Box>
        </Box>
      )}
    </Stack>
  );
}
