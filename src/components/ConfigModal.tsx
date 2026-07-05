import { useState, useRef, useEffect, useCallback, useId, type Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../stores/projectStore";
import type { Project, Group } from "../lib/types";
import { getShellOptions } from "../lib/types";
import { getOsPlatform, normalizeShellKey } from "../lib/shell";
import { getConfigModalShellPrefill } from "../lib/configModalShellPrefill";
import type { OsPlatform } from "../lib/shell";
import { ConfirmDialog } from "./ConfirmDialog";
import { Check, ChevronDown } from "./icons";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { VendorIcon, inferVendor } from "./VendorIcon";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { logError, logInfo, logWarn } from "../lib/logger";
import { useI18n } from "../lib/i18n";

interface Props {
  project?: Project;
  cloneFrom?: Project;
  defaultGroupId?: string | null;
  onClose: () => void;
}

const CLI_TOOL_OPTIONS = ["claude", "codex"] as const;

export function ConfigModal({ project, cloneFrom, defaultGroupId, onClose }: Props) {
  const { createProject, updateProject, groups } = useProjectStore();
  const { t } = useI18n();
  const isEdit = !!project;
  const isClone = !!cloneFrom;
  const logInstanceIdRef = useRef(crypto.randomUUID().slice(0, 8));
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const dialogDescriptionId = useId();
  const nameFieldId = useId();
  const pathFieldId = useId();
  const cliToolFieldId = useId();
  const cliToolLabelId = useId();
  const shellFieldId = useId();

  const [osPlatform, setOsPlatform] = useState<OsPlatform>("windows");

  const [name, setName] = useState(
    cloneFrom ? `${cloneFrom.name} (副本)` : (project?.name ?? "")
  );
  const [path, setPath] = useState(cloneFrom?.path ?? project?.path ?? "");
  const [groupId, setGroupId] = useState<string | null>(
    cloneFrom?.group_id ?? project?.group_id ?? defaultGroupId ?? null
  );
  const [cliTool, setCliTool] = useState(cloneFrom?.cli_tool ?? project?.cli_tool ?? "");
  const [cliArgs, setCliArgs] = useState(cloneFrom?.cli_args ?? project?.cli_args ?? "");
  const [startupCmd, setStartupCmd] = useState(cloneFrom?.startup_cmd ?? project?.startup_cmd ?? "");
  const [shell, setShell] = useState(cloneFrom?.shell ?? project?.shell ?? "");
  const [envVarsText, setEnvVarsText] = useState(cloneFrom?.env_vars ?? project?.env_vars ?? "{}");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmEdit, setShowConfirmEdit] = useState(false);
  const [cliToolComboboxOpen, setCliToolComboboxOpen] = useState(false);

  useEffect(() => {
    logInfo("[config-modal] mounted", {
      instanceId: logInstanceIdRef.current,
      isEdit,
      isClone,
    });
    return () => {
      logInfo("[config-modal] unmounted", {
        instanceId: logInstanceIdRef.current,
        isEdit,
        isClone,
      });
    };
  }, [isClone, isEdit]);

  // Detect OS and set default shell on mount
  useEffect(() => {
    void (async () => {
      const platform = await getOsPlatform();
      setOsPlatform(platform);
      setShell((currentShell) => {
        const resolvedShell = getConfigModalShellPrefill(platform, currentShell, isEdit, isClone);
        logInfo("[config-modal] resolved shell prefill", {
          instanceId: logInstanceIdRef.current,
          platform,
          currentShell,
          resolvedShell,
          isEdit,
          isClone,
        });
        if (platform === "macos" && !isEdit && !isClone && !resolvedShell.trim()) {
          logWarn("[config-modal] macOS new terminal modal resolved empty shell prefill", {
            currentShell,
            resolvedShell,
          });
        }
        return resolvedShell;
      });
    })().catch((err) => {
      logError("[config-modal] failed to resolve shell prefill", { err, isEdit, isClone });
    });
  }, [isClone, isEdit]);

  useEffect(() => {
    if (isEdit || isClone || osPlatform === "unknown") return;
    const effectiveShell = getConfigModalShellPrefill(osPlatform, shell, isEdit, isClone);
    const optionValues = getShellOptions(osPlatform).map((opt) => opt.value);
    const hasShellOption = optionValues.includes(effectiveShell);
    logInfo("[config-modal] shell select state", {
      instanceId: logInstanceIdRef.current,
      osPlatform,
      shell,
      effectiveShell,
      hasShellOption,
      optionValues,
    });
    if (osPlatform === "macos" && !effectiveShell.trim()) {
      logWarn("[config-modal] macOS new terminal modal still has empty shell state", {
        shell,
        effectiveShell,
        optionValues,
      });
    }
  }, [isClone, isEdit, osPlatform, shell]);

  const handleBrowse = async () => {
    const selected = await open({ directory: true, title: "选择项目目录" });
    if (selected) {
      setPath(selected);
      if (!name.trim()) {
        const folderName = selected.replace(/\\/g, "/").split("/").pop() ?? "";
        setName(folderName);
      }
    }
  };

  const validatePath = useCallback(async (rawPath: string) => {
    try {
      const results = await invoke<boolean[]>("check_paths_exist", { paths: [rawPath] });
      return Boolean(results[0]);
    } catch (err) {
      logError("Path validation failed in ConfigModal", { rawPath, err });
      return false;
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError("名称和路径为必填项");
      toast.error("保存失败", { description: "名称和路径为必填项" });
      return;
    }

    const normalizedPath = path.trim();
    const pathOk = await validatePath(normalizedPath);
    if (!pathOk) {
      const description = "路径不存在或不可访问";
      setError(description);
      toast.error("路径校验失败", { description });
      return;
    }

    setError("");
    if (isEdit) {
      setShowConfirmEdit(true);
      return;
    }
    await saveProject();
  };

  const saveProject = async () => {
    setSubmitting(true);
    try {
      if (isEdit && project) {
        await updateProject(project.id, {
          name: name.trim(),
          path: path.trim(),
          group_id: groupId,
          cli_tool: cliTool.trim(),
          cli_args: cliArgs.trim(),
          startup_cmd: startupCmd.trim(),
          env_vars: envVarsText.trim(),
          shell,
        });
        toast.success("终端修改成功");
      } else {
        await createProject({
          name: name.trim(),
          path: path.trim(),
          group_id: groupId,
          cli_tool: cliTool.trim() || undefined,
          cli_args: cliArgs.trim() || undefined,
          startup_cmd: startupCmd.trim() || undefined,
          env_vars: envVarsText.trim() || undefined,
          shell,
        });
        toast.success("终端创建成功");
      }
      onClose();
    } catch (err) {
      const description = String(err);
      setError(description);
      toast.error(isEdit ? "修改终端失败" : "新增终端失败", { description });
      logError("Failed to save project in ConfigModal", {
        isEdit,
        name: name.trim(),
        path: path.trim(),
        groupId,
        shell,
        err,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedGroupName = groupId
    ? groups.find((g) => g.id === groupId)?.name ?? "未知分组"
    : "不分组";
  const shellSelectValue = getConfigModalShellPrefill(osPlatform, shell, isEdit, isClone);
  const shellSelectKey = `${osPlatform}:${isEdit ? "edit" : isClone ? "clone" : "create"}`;

  // Shell 选项：如果当前 shell 在平台选项中不存在，保留为"当前自定义（保留）"
  const normalizedShell = normalizeShellKey(shellSelectValue);
  const isCustomShell = shellSelectValue && !normalizedShell;
  const shellOptions = [
    ...(isCustomShell ? [{ value: shellSelectValue, label: `${shellSelectValue}（当前自定义）` }] : []),
    ...getShellOptions(osPlatform),
  ];

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent
          className="max-w-[420px]"
          showCloseButton={false}
          aria-describedby={dialogDescriptionId}
          onEscapeKeyDown={(event) => {
            const escapeTarget = event.target instanceof HTMLElement ? event.target : null;
            const hasOpenListbox = typeof document !== "undefined" && document.querySelector("[role='listbox']") !== null;
            const escapeFromOptionLayer = escapeTarget?.closest("[role='listbox'], [role='option']") !== null;
            if (!(cliToolComboboxOpen || hasOpenListbox || escapeFromOptionLayer)) return;
            event.preventDefault();
            setCliToolComboboxOpen(false);
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            nameInputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previousFocusRef.current?.focus();
          }}
        >
          <form onSubmit={handleSubmit}>
            <DialogTitle className="mb-4 text-base font-semibold text-text-primary">
              {isEdit ? "编辑终端" : isClone ? "复制终端配置" : "新增终端"}
            </DialogTitle>
            <DialogDescription id={dialogDescriptionId} className="sr-only">
              {t("configModal.a11y.dialogDescription")}
            </DialogDescription>

            {error && (
              <div className="mb-3 rounded bg-danger/15 px-2 py-1.5 text-xs text-danger">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <Field
                id={nameFieldId}
                inputRef={nameInputRef}
                label="名称 *"
                value={name}
                onChange={setName}
              />

              {/* Path with folder picker */}
              <div>
                <label htmlFor={pathFieldId} className="mb-1 block text-xs text-text-muted">路径 *</label>
                <div className="flex gap-1">
                  <Input
                    id={pathFieldId}
                    type="text"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="C:\\我的项目\\my-app"
                    className="flex-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleBrowse}
                    className="shrink-0 rounded border border-border bg-bg-tertiary px-2 py-1.5 text-xs text-text-secondary"
                  >
                    浏览
                  </button>
                </div>
              </div>

              {/* Group selector */}
              <div>
                <label className="mb-1 block text-xs text-text-muted">分组</label>
                <GroupSelector
                  groups={groups}
                  value={groupId}
                  onChange={setGroupId}
                  displayName={selectedGroupName}
                />
              </div>

              <div>
                <label id={cliToolLabelId} htmlFor={cliToolFieldId} className="mb-1 block text-xs text-text-muted">CLI 工具</label>
                <CliToolCombobox
                  id={cliToolFieldId}
                  ariaLabel={t("configModal.a11y.cliTool")}
                  labelledBy={cliToolLabelId}
                  open={cliToolComboboxOpen}
                  onOpenChange={setCliToolComboboxOpen}
                  value={cliTool}
                  onChange={setCliTool}
                />
              </div>

              <Field
                label="CLI 启动参数"
                value={cliArgs}
                onChange={setCliArgs}
                placeholder="--permission-mode bypassPermissions"
              />

              <div>
                <label htmlFor={shellFieldId} className="mb-1 block text-xs text-text-muted">Shell</label>
                <Select
                  id={shellFieldId}
                  key={shellSelectKey}
                  value={shellSelectValue}
                  aria-label={t("configModal.a11y.shell")}
                  onChange={(e) => {
                    const nextShell = e.target.value;
                    logInfo("[config-modal] shell select onChange", {
                      instanceId: logInstanceIdRef.current,
                      nextShell,
                    });
                    if (!nextShell.trim()) {
                      logWarn("[config-modal] ignored empty shell select onChange", {
                        instanceId: logInstanceIdRef.current,
                        shell,
                      });
                      return;
                    }
                    setShell(nextShell);
                  }}
                  className="text-sm"
                  placeholder="请选择"
                >
                  {shellOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </div>

              <Field label="启动命令" value={startupCmd} onChange={setStartupCmd} placeholder="npm run dev" />
              <div>
                <label className="mb-1 block text-xs text-text-muted">环境变量（JSON）</label>
                <Textarea
                  value={envVarsText}
                  onChange={(e) => setEnvVarsText(e.target.value)}
                  className="h-16 resize-none text-sm"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button type="submit" variant="default" disabled={submitting}>
                {submitting ? "保存中..." : isEdit ? "保存" : isClone ? "创建副本" : "新增"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showConfirmEdit}
        title="确认修改终端？"
        message="将保存当前修改内容。"
        confirmText="确认保存"
        onConfirm={() => {
          setShowConfirmEdit(false);
          void saveProject();
        }}
        onClose={() => setShowConfirmEdit(false)}
      />
    </>
  );
}

function CliToolCombobox({
  id,
  ariaLabel,
  labelledBy,
  open,
  onOpenChange,
  value,
  onChange,
}: {
  id?: string;
  ariaLabel?: string;
  labelledBy?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const { t } = useI18n();
  const vendor = inferVendor(value);
  const normalizedValue = value.trim().toLowerCase();
  const resolveOptionIndex = useCallback((nextValue: string) => {
    const normalized = nextValue.trim().toLowerCase();
    const exactMatch = CLI_TOOL_OPTIONS.findIndex((tool) => tool === normalized);
    if (exactMatch >= 0) return exactMatch;
    const prefixMatch = CLI_TOOL_OPTIONS.findIndex((tool) => tool.startsWith(normalized));
    return prefixMatch >= 0 ? prefixMatch : 0;
  }, []);

  useEffect(() => {
    if (!open) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      onOpenChange(false);
    };

    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    setActiveIndex(resolveOptionIndex(value));
  }, [resolveOptionIndex, value]);

  const selectTool = (tool: (typeof CLI_TOOL_OPTIONS)[number]) => {
    onChange(tool);
    onOpenChange(false);
    setActiveIndex(CLI_TOOL_OPTIONS.indexOf(tool));
    inputRef.current?.focus();
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const nextFocus = e.relatedTarget as Node | null;
    if (!nextFocus || !e.currentTarget.contains(nextFocus)) {
      onOpenChange(false);
    }
  };

  const activeOptionId = open ? `${listboxId}-option-${CLI_TOOL_OPTIONS[activeIndex]}` : undefined;

  return (
    <div ref={rootRef} className="relative" onBlur={handleBlur}>
      {vendor && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2">
          <VendorIcon vendor={vendor} size={16} />
        </span>
      )}
      <Input
        id={id}
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          const nextValue = e.target.value;
          onChange(nextValue);
          setActiveIndex(resolveOptionIndex(nextValue));
          onOpenChange(true);
        }}
        onClick={() => {
          setActiveIndex(resolveOptionIndex(value));
          onOpenChange(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) {
              setActiveIndex(resolveOptionIndex(value));
              onOpenChange(true);
              return;
            }
            setActiveIndex((current) => (current + 1) % CLI_TOOL_OPTIONS.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              setActiveIndex(resolveOptionIndex(value));
              onOpenChange(true);
              return;
            }
            setActiveIndex((current) => (current - 1 + CLI_TOOL_OPTIONS.length) % CLI_TOOL_OPTIONS.length);
          } else if (e.key === "Enter") {
            if (!open) {
              e.preventDefault();
              setActiveIndex(resolveOptionIndex(value));
              onOpenChange(true);
              return;
            }
            e.preventDefault();
            selectTool(CLI_TOOL_OPTIONS[activeIndex]);
          } else if (e.key === "Home" && open) {
            e.preventDefault();
            setActiveIndex(0);
          } else if (e.key === "End" && open) {
            e.preventDefault();
            setActiveIndex(CLI_TOOL_OPTIONS.length - 1);
          } else if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
            }
            onOpenChange(false);
          } else if (e.key === "Tab") {
            onOpenChange(false);
          }
        }}
        placeholder={t("configModal.cliToolPlaceholder")}
        role="combobox"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        className={`pr-8 text-sm ${vendor ? "pl-9" : ""}`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setActiveIndex(resolveOptionIndex(value));
          onOpenChange(!open);
          inputRef.current?.focus();
        }}
        className="ui-focus-ring absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-text-muted outline-none transition-colors hover:bg-surface-container-highest hover:text-text-primary"
      >
        <ChevronDown
          size={12}
          strokeWidth={1.8}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="ui-select-popover absolute left-0 top-full z-[60] mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-border bg-surface-container-high py-1 text-xs shadow-lg"
        >
          {CLI_TOOL_OPTIONS.map((tool, index) => {
            const selected = normalizedValue === tool;
            return (
              <button
                id={`${listboxId}-option-${tool}`}
                key={tool}
                type="button"
                role="option"
                aria-selected={selected}
                data-selected={selected ? "true" : undefined}
                data-active={activeIndex === index ? "true" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectTool(tool)}
                className="flex w-[calc(100%-8px)] cursor-pointer items-center gap-2 outline-none hover:bg-surface-container-highest hover:text-text-primary data-[active=true]:bg-surface-container-highest data-[active=true]:text-text-primary"
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                  <VendorIcon vendor={inferVendor(tool)} size={14} />
                </span>
                <span className="flex-1 truncate text-left font-mono">{tool}</span>
                {selected && <Check size={12} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Group tree selector ---

function GroupSelector({
  groups,
  value,
  onChange,
  displayName,
}: {
  groups: Group[];
  value: string | null;
  onChange: (id: string | null) => void;
  displayName: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  // Build flat indented list
  const groupMap = new Map<string | null, Group[]>();
  for (const g of groups) {
    const arr = groupMap.get(g.parent_id) ?? [];
    arr.push(g);
    groupMap.set(g.parent_id, arr);
  }

  type FlatItem = { group: Group; depth: number };
  const flatList: FlatItem[] = [];

  function flatten(parentId: string | null, depth: number) {
    const children = (groupMap.get(parentId) ?? []).sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
    for (const g of children) {
      flatList.push({ group: g, depth });
      flatten(g.id, depth + 1);
    }
  }
  flatten(null, 0);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded border border-border bg-bg-tertiary px-2 py-1.5 text-left text-sm text-text-primary outline-none"
      >
        <span className={value ? "" : "opacity-50"}>{displayName}</span>
        <ChevronDown size={12} strokeWidth={1.8} className="text-text-muted" />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute left-0 top-full z-[60] mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-bg-secondary animate-slide-down"
        >
          {/* No group option */}
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full px-2 py-1.5 text-left text-sm transition-opacity hover:opacity-80 ${!value ? "bg-bg-tertiary text-accent" : "text-text-secondary"}`}
          >
            不分组
          </button>

          {flatList.map(({ group: g, depth }) => (
            <button
              key={g.id}
              type="button"
              onClick={() => { onChange(g.id); setOpen(false); }}
              className={`w-full py-1.5 text-left text-sm transition-opacity hover:opacity-80 ${value === g.id ? "bg-bg-tertiary text-accent" : "text-text-secondary"}`}
              style={{ paddingLeft: 8 + depth * 16, paddingRight: 8 }}
            >
              {g.name}
            </button>
          ))}

          {flatList.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-text-muted">暂无分组</div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  id,
  inputRef,
  label,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-text-muted">{label}</label>
      <Input
        id={id}
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-sm"
      />
    </div>
  );
}
