import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  useSettingsStore,
  type ShortcutAction,
  type KeyboardShortcutMap,
  type TabSwitchShortcutModifier,
  type TerminalNewlineShortcut,
} from "../../../stores/settingsStore";
import { eventToCombo } from "../../../hooks/useKeyboardShortcuts";

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  newTerminal: "新建终端",
  closeTerminal: "关闭终端",
  nextTab: "下一个标签",
  prevTab: "上一个标签",
  commandPalette: "命令面板",
};

const TERMINAL_NEWLINE_OPTIONS: { value: TerminalNewlineShortcut; label: string }[] = [
  { value: "Shift+Enter", label: "Shift + Enter" },
  { value: "Ctrl+Enter", label: "Ctrl + Enter" },
  { value: "Alt+Enter", label: "Alt + Enter" },
];

const TAB_SWITCH_OPTIONS: { value: TabSwitchShortcutModifier; label: string }[] = [
  { value: "Alt", label: "Alt + 方向键" },
  { value: "Ctrl", label: "Ctrl + 方向键" },
  { value: "Shift", label: "Shift + 方向键" },
];

interface ShortcutSettingsPageProps {
  searchValue: string;
}

export function ShortcutSettingsPage({ searchValue }: ShortcutSettingsPageProps) {
  const shortcuts = useSettingsStore((s) => s.keyboardShortcuts);
  const terminalNewlineShortcut = useSettingsStore((s) => s.terminalNewlineShortcut);
  const update = useSettingsStore((s) => s.update);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);

  const currentTabSwitchModifier = useMemo<TabSwitchShortcutModifier | null>(() => {
    const option = TAB_SWITCH_OPTIONS.find(
      (opt) => shortcuts.prevTab === `${opt.value}+ArrowLeft` && shortcuts.nextTab === `${opt.value}+ArrowRight`
    );
    return option?.value ?? null;
  }, [shortcuts.prevTab, shortcuts.nextTab]);

  const updateTabSwitchModifier = useCallback(
    (modifier: TabSwitchShortcutModifier) => {
      void update("keyboardShortcuts", {
        ...shortcuts,
        prevTab: `${modifier}+ArrowLeft`,
        nextTab: `${modifier}+ArrowRight`,
      });
      setRecording(null);
    },
    [shortcuts, update]
  );

  const handleRecord = useCallback(
    (event: KeyboardEvent) => {
      if (!recording) return;
      event.preventDefault();
      event.stopPropagation();
      const combo = eventToCombo(event);
      if (!combo) return;
      const next: KeyboardShortcutMap = { ...shortcuts, [recording]: combo };
      void update("keyboardShortcuts", next);
      setRecording(null);
    },
    [recording, shortcuts, update]
  );

  useEffect(() => {
    if (!recording) return;
    window.addEventListener("keydown", handleRecord, true);
    return () => window.removeEventListener("keydown", handleRecord, true);
  }, [recording, handleRecord]);

  const resetDefaults = () => {
    void update("keyboardShortcuts", DEFAULT_KEYBOARD_SHORTCUTS);
    setRecording(null);
  };

  const keyword = searchValue.trim().toLowerCase();
  const visibleActions = useMemo(() => {
    const all = Object.keys(SHORTCUT_LABELS) as ShortcutAction[];
    if (!keyword) return all;
    return all.filter((action) => SHORTCUT_LABELS[action].toLowerCase().includes(keyword));
  }, [keyword]);

  const conflictMap = useMemo(() => {
    const comboToActions = new Map<string, ShortcutAction[]>();
    (Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).forEach((action) => {
      const key = shortcuts[action].trim().toLowerCase();
      const group = comboToActions.get(key) ?? [];
      group.push(action);
      comboToActions.set(key, group);
    });
    const conflictByAction = new Map<ShortcutAction, string>();
    comboToActions.forEach((actions) => {
      if (actions.length <= 1) return;
      actions.forEach((action) => {
        const peer = actions.find((candidate) => candidate !== action);
        if (peer) {
          conflictByAction.set(action, `与「${SHORTCUT_LABELS[peer]}」冲突`);
        }
      });
    });
    return conflictByAction;
  }, [shortcuts]);

  return (
    <div className="space-y-4">
      <section className="ui-surface-card rounded-2xl border border-border p-4">
        <div className="mb-1 text-sm font-semibold text-on-surface">终端键位</div>
        <div className="mb-3 text-[11px] text-on-surface-variant">
          在终端中按下该组合键时，向 PTY 发送换行符 <code>\n</code>（适配 Claude Code、Codex 等 AI CLI 的「换行不提交」）。单按 Enter 行为不变。
        </div>
        <div className="flex flex-wrap gap-2">
          {TERMINAL_NEWLINE_OPTIONS.map((opt) => {
            const active = terminalNewlineShortcut === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => {
                  if (!active) void update("terminalNewlineShortcut", opt.value);
                }}
                className="ui-interactive rounded-lg border px-3 py-1.5 text-xs"
                style={{
                  borderColor: active ? "var(--primary)" : "var(--border)",
                  backgroundColor: active
                    ? "color-mix(in srgb, var(--primary) 12%, var(--surface-container-high) 88%)"
                    : "var(--surface-container-high)",
                  color: active ? "var(--primary)" : "var(--on-surface)",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="ui-surface-card rounded-2xl border border-border p-4">
        <div className="mb-1 text-sm font-semibold text-on-surface">终端标签切换</div>
        <div className="mb-3 text-[11px] text-on-surface-variant">
          左方向键切到上一个标签，右方向键切到下一个标签。
        </div>
        <div className="flex flex-wrap gap-2">
          {TAB_SWITCH_OPTIONS.map((opt) => {
            const active = currentTabSwitchModifier === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => {
                  if (!active) updateTabSwitchModifier(opt.value);
                }}
                className="ui-interactive rounded-lg border px-3 py-1.5 text-xs"
                style={{
                  borderColor: active ? "var(--primary)" : "var(--border)",
                  backgroundColor: active
                    ? "color-mix(in srgb, var(--primary) 12%, var(--surface-container-high) 88%)"
                    : "var(--surface-container-high)",
                  color: active ? "var(--primary)" : "var(--on-surface)",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {currentTabSwitchModifier === null && (
          <div className="mt-2 text-[11px] text-on-surface-variant">
            当前为自定义标签切换快捷键，可在下方单独修改。
          </div>
        )}
      </section>

      <section className="ui-surface-card rounded-2xl border border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-on-surface">快捷键绑定</div>
          <button
            onClick={resetDefaults}
            className="ui-interactive rounded-lg border border-border px-3 py-1.5 text-xs text-on-surface-variant"
          >
            恢复默认
          </button>
        </div>

        <div className="space-y-2">
          {visibleActions.map((action) => {
            const conflict = conflictMap.get(action);
            const isRecording = recording === action;
            return (
              <div
                key={action}
                className={`rounded-xl border px-3 py-2 ${conflict ? "border-warning/60" : "border-border"}`}
                style={{
                  backgroundColor: conflict
                    ? "color-mix(in srgb, var(--warning) 10%, var(--surface-container-high) 90%)"
                    : "var(--surface-container-high)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-on-surface">{SHORTCUT_LABELS[action]}</div>
                    {conflict && <div className="mt-0.5 text-[11px] text-warning">{conflict}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isRecording ? (
                      <span
                        className="animate-pulse rounded-md px-2 py-1 text-xs"
                        style={{ backgroundColor: "var(--primary)", color: "var(--on-primary)" }}
                      >
                        请按下快捷键...
                      </span>
                    ) : (
                      <kbd
                        className="min-w-[108px] rounded-md border px-2 py-1 text-center text-[11px] font-medium"
                        style={{
                          backgroundColor: "var(--surface-container-lowest)",
                          borderColor: "var(--border)",
                          color: "var(--on-surface)",
                          boxShadow: "0 1px 0 color-mix(in srgb, var(--surface-container-lowest) 78%, var(--border) 22%)",
                        }}
                      >
                        {shortcuts[action]}
                      </kbd>
                    )}
                    <button
                      onClick={() => setRecording(isRecording ? null : action)}
                      className="ui-interactive rounded-md border border-border px-2 py-1 text-[11px] text-primary"
                    >
                      {isRecording ? "取消" : "修改"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {visibleActions.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-on-surface-variant">
              未找到匹配的快捷键动作
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
