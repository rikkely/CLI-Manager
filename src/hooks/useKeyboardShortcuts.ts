import { useEffect, useRef } from "react";
import { useTerminalStore } from "../stores/terminalStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useCommandPaletteStore } from "../components/CommandPalette";
import { useHistoryStore } from "../stores/historyStore";

/** Convert a KeyboardEvent to a combo string like "Ctrl+Shift+T" */
export function eventToCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Meta");

  const key = e.key;
  // Ignore modifier-only presses
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return "";

  // Normalize key name
  const normalized = key.length === 1 ? key.toUpperCase() : key;
  parts.push(normalized);
  return parts.join("+");
}

interface KeyboardShortcutOptions {
  onToggleTerminalFullscreen?: () => void;
}

export function useKeyboardShortcuts(options: KeyboardShortcutOptions = {}) {
  const shortcuts = useSettingsStore((s) => s.keyboardShortcuts);
  const viewMode = useSettingsStore((s) => s.viewMode);

  // Refs hold the latest values; the actual handler is bound once.
  const shortcutsRef = useRef(shortcuts);
  const viewModeRef = useRef(viewMode);
  const onToggleTerminalFullscreenRef = useRef(options.onToggleTerminalFullscreen);
  shortcutsRef.current = shortcuts;
  viewModeRef.current = viewMode;
  onToggleTerminalFullscreenRef.current = options.onToggleTerminalFullscreen;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const combo = eventToCombo(e);
      if (!combo) return;
      const shortcuts = shortcutsRef.current;
      const viewMode = viewModeRef.current;

      // Command palette toggle works regardless of focus context
      if (combo === shortcuts.commandPalette) {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
        return;
      }

      if (combo === shortcuts.toggleTerminalFullscreen) {
        e.preventDefault();
        onToggleTerminalFullscreenRef.current?.();
        return;
      }

      // Global history search
      if (combo === "Ctrl+K") {
        e.preventDefault();
        void useHistoryStore.getState().openHistory();
        useHistoryStore.getState().triggerGlobalSearchFocus();
        return;
      }

      // In-session history search
      if (combo === "Ctrl+F" && useHistoryStore.getState().isOpen) {
        e.preventDefault();
        useHistoryStore.getState().triggerSessionSearchFocus();
        return;
      }

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isXtermTarget = !!target?.closest(".xterm");
      const isEditingTarget =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        !!target?.closest("[contenteditable='true']");

      const terminalState = useTerminalStore.getState();
      const { sessions, activeSessionId, setActive, closeSession, createSession } = terminalState;

      if (combo === shortcuts.nextTab || combo === shortcuts.prevTab) {
        if (viewMode === "compact" || (isEditingTarget && !isXtermTarget)) return;
        e.preventDefault();
        if (sessions.length < 2) return;
        const delta = combo === shortcuts.nextTab ? 1 : -1;
        const nextSessionId = terminalState.getNextSessionIdForShortcut(delta);
        if (nextSessionId) setActive(nextSessionId);
        return;
      }

      // Skip global shortcuts while user is typing/editing.
      if (isEditingTarget || isXtermTarget) {
        return;
      }

      if (combo === shortcuts.newTerminal) {
        if (viewMode === "compact") return;
        e.preventDefault();
        createSession(undefined, undefined, "Terminal");
        return;
      }

      if (combo === shortcuts.closeTerminal) {
        if (viewMode === "compact") return;
        e.preventDefault();
        if (activeSessionId) closeSession(activeSessionId);
        return;
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);
}
