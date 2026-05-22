import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getTerminalTheme, getTerminalBackground } from "../lib/terminalThemes";
import { useCommandHistoryStore } from "../stores/commandHistoryStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useSettingsStore, type LightThemePalette, type DarkThemePalette } from "../stores/settingsStore";

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;
// 模块级单例：每帧每会话都 new TextDecoder 在高吞吐场景下会成为 GC 热点，
// 而 TextDecoder 本身是无状态可复用的（fatal=false, ignoreBOM=false 都是默认值）。
const SHARED_TEXT_DECODER = new TextDecoder("utf-8");
import { toast } from "sonner";
import { logError } from "../lib/logger";

interface Props {
  sessionId: string;
  isActive?: boolean;
  fontSize?: number;
  fontFamily?: string;
  resolvedTheme?: "dark" | "light";
  terminalThemeName?: string;
  lightThemePalette?: LightThemePalette;
  darkThemePalette?: DarkThemePalette;
}

export function XTermTerminal({ sessionId, isActive = true, fontSize = 14, fontFamily = "Cascadia Code, Consolas, monospace", resolvedTheme = "dark", terminalThemeName = "auto", lightThemePalette = "warm-paper", darkThemePalette = "night-indigo" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBuffer = useRef("");
  const fitRafRef = useRef<number | null>(null);
  const isComposingRef = useRef(false);
  const isActiveRef = useRef(isActive);
  const lastObservedSizeRef = useRef<{ width: number; height: number } | null>(null);
  const inactiveBufferRef = useRef<string[]>([]);
  const inactiveBufferSizeRef = useRef(0);
  const INACTIVE_BUFFER_MAX = 256 * 1024;

  const scheduleFit = (force = false) => {
    if (fitRafRef.current !== null) {
      cancelAnimationFrame(fitRafRef.current);
    }
    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = null;
      const container = containerRef.current;
      const fitAddon = fitAddonRef.current;
      if (!container || !fitAddon) return;
      if (!force && (!isActiveRef.current || isComposingRef.current)) return;
      if (container.offsetWidth <= 0 || container.offsetHeight <= 0) return;
      fitAddon.fit();
    });
  };

  const reportPtyWriteError = (stage: string, err: unknown) => {
    toast.error("终端写入失败", { description: String(err) });
    logError("PTY write failed in XTermTerminal", { sessionId, stage, err });
  };

  // Hot-update theme / fontSize / fontFamily without recreating the terminal.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = getTerminalTheme(terminalThemeName, resolvedTheme, lightThemePalette, darkThemePalette);
    const sizeChanged = terminal.options.fontSize !== fontSize || terminal.options.fontFamily !== fontFamily;
    if (sizeChanged) {
      terminal.options.fontSize = fontSize;
      terminal.options.fontFamily = fontFamily;
      scheduleFit(true);
    }
  }, [fontSize, fontFamily, resolvedTheme, terminalThemeName, lightThemePalette, darkThemePalette]);

  // Refit terminal when tab becomes active
  useEffect(() => {
    const wasActive = isActiveRef.current;
    isActiveRef.current = isActive;
    if (terminalRef.current) {
      terminalRef.current.options.cursorBlink = isActive;
      if (!isActive) {
        terminalRef.current.blur();
      }
    }
    if (isActive && fitAddonRef.current && containerRef.current) {
      // Flush data stashed while this tab was hidden
      if (!wasActive && inactiveBufferRef.current.length > 0 && terminalRef.current) {
        const combined = inactiveBufferRef.current.join("");
        inactiveBufferRef.current = [];
        inactiveBufferSizeRef.current = 0;
        terminalRef.current.write(combined);
      }
      // Wait one frame to ensure display:block has taken effect and layout is stable.
      scheduleFit(true);
      terminalRef.current?.focus();
    }
  }, [isActive]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: isActive,
      cursorStyle: "block",
      fontSize,
      fontFamily,
      scrollback: 5000,
      theme: getTerminalTheme(terminalThemeName, resolvedTheme, lightThemePalette, darkThemePalette),
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not supported, fall back to canvas
    }

    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    if (isActive) {
      terminal.focus();
    }

    const copySelection = async () => {
      const selection = terminal.getSelection();
      if (!selection) return;
      try {
        await navigator.clipboard.writeText(selection);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = selection;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand("copy");
        } finally {
          document.body.removeChild(textarea);
        }
      }
    };

    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.key === "Enter") {
        const shortcut = useSettingsStore.getState().terminalNewlineShortcut;
        const matched =
          (shortcut === "Shift+Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) ||
          (shortcut === "Ctrl+Enter" && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) ||
          (shortcut === "Alt+Enter" && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey);
        if (matched) {
          e.preventDefault();
          invoke("pty_write", { sessionId, data: "\n" }).catch((err) => reportPtyWriteError("newline", err));
          return false;
        }
      }
      if (e.type !== "keydown" || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return true;
      const key = e.key.toLowerCase();
      if (key === "c" && terminal.hasSelection()) {
        e.preventDefault();
        void copySelection();
        terminal.clearSelection();
        return false;
      }
      if (key === "v") {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) {
            invoke("pty_write", { sessionId, data: text }).catch((err) => reportPtyWriteError("paste", err));
            inputBuffer.current += text;
          }
        }).catch((err) => {
          logError("Failed to read clipboard text", { sessionId, err });
        });
        return false;
      }
      return true;
    });

    // Forward keyboard input to PTY and record command history
    const addCommand = useCommandHistoryStore.getState().addCommand;
    const getProjectId = () => useTerminalStore.getState().sessions.find((s) => s.id === sessionId)?.projectId ?? null;

    terminal.onData((data) => {
      invoke("pty_write", { sessionId, data }).catch((err) => reportPtyWriteError("onData", err));

      if (data === "\r") {
        const cmd = inputBuffer.current;
        if (cmd.trim()) {
          addCommand(getProjectId(), cmd);
        }
        inputBuffer.current = "";
      } else if (data === "\x7f" || data === "\b") {
        inputBuffer.current = inputBuffer.current.slice(0, -1);
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        inputBuffer.current += data;
      } else if (data.length > 1 && !data.startsWith("\x1b")) {
        // Pasted text
        inputBuffer.current += data;
      }
    });

    // Sync resize to PTY
    terminal.onResize(({ cols, rows }) => {
      invoke("pty_resize", { sessionId, cols, rows }).catch((err) => {
        logError("PTY resize failed in XTermTerminal", { sessionId, cols, rows, err });
      });
    });

    // Listen for PTY output (Base64 encoded to preserve control characters)
    // Batch chunks per animation frame to keep main thread responsive on high-throughput output.
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    let pendingChunks: string[] = [];
    let writeRafId: number | null = null;
    const flushPendingWrites = () => {
      writeRafId = null;
      if (cancelled || pendingChunks.length === 0) return;
      const combined = pendingChunks.length === 1 ? pendingChunks[0] : pendingChunks.join("");
      pendingChunks = [];
      terminal.write(combined);
    };
    listen<string>(`pty-output-${sessionId}`, (event) => {
      if (cancelled) return;
      const binaryString = atob(event.payload);
      const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));
      const text = SHARED_TEXT_DECODER.decode(bytes);
      if (isActiveRef.current) {
        pendingChunks.push(text);
        if (writeRafId === null) {
          writeRafId = requestAnimationFrame(flushPendingWrites);
        }
      } else {
        // Tab hidden — stash to a bounded ring buffer; flush when reactivated
        inactiveBufferRef.current.push(text);
        inactiveBufferSizeRef.current += text.length;
        while (
          inactiveBufferSizeRef.current > INACTIVE_BUFFER_MAX &&
          inactiveBufferRef.current.length > 1
        ) {
          const removed = inactiveBufferRef.current.shift();
          if (removed) inactiveBufferSizeRef.current -= removed.length;
        }
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    const textarea = containerRef.current.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null;
    const viewport = containerRef.current.querySelector(".xterm-viewport") as HTMLElement | null;
    let compositionScrollRafId: number | null = null;
    let compositionScrollLock: { element: HTMLElement; scrollTop: number; scrollLeft: number }[] = [];

    const captureCompositionScroll = () => {
      const container = containerRef.current;
      compositionScrollLock = [container, viewport]
        .filter((element): element is HTMLElement => Boolean(element))
        .map((element) => ({
          element,
          scrollTop: element.scrollTop,
          scrollLeft: element.scrollLeft,
        }));
    };

    const restoreCompositionScroll = () => {
      for (const { element, scrollTop, scrollLeft } of compositionScrollLock) {
        element.scrollTop = scrollTop;
        element.scrollLeft = scrollLeft;
      }
    };

    const scheduleCompositionScrollRestore = () => {
      restoreCompositionScroll();
      if (compositionScrollRafId !== null) {
        cancelAnimationFrame(compositionScrollRafId);
      }
      compositionScrollRafId = requestAnimationFrame(() => {
        compositionScrollRafId = null;
        restoreCompositionScroll();
      });
    };

    const onCompositionStart = () => {
      isComposingRef.current = true;
      captureCompositionScroll();
      scheduleCompositionScrollRestore();
    };
    const onCompositionUpdate = () => {
      scheduleCompositionScrollRestore();
    };
    const onCompositionEnd = () => {
      isComposingRef.current = false;
      scheduleCompositionScrollRestore();
      scheduleFit(true);
    };

    textarea?.addEventListener("compositionstart", onCompositionStart);
    textarea?.addEventListener("compositionupdate", onCompositionUpdate);
    textarea?.addEventListener("compositionend", onCompositionEnd);

    // Ctrl + wheel adjusts global font size (writes settings store, like Windows Terminal but persistent).
    const wheelTarget = containerRef.current;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      const current = useSettingsStore.getState().fontSize;
      const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, current + (e.deltaY > 0 ? -1 : 1)));
      if (next !== current) {
        void useSettingsStore.getState().update("fontSize", next);
      }
    };
    wheelTarget.addEventListener("wheel", onWheel, { passive: false, capture: true });

    // Resize observer — skip fit when container is hidden or IME composition is active.
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      const lastSize = lastObservedSizeRef.current;
      if (lastSize && Math.abs(lastSize.width - width) < 2 && Math.abs(lastSize.height - height) < 2) {
        return;
      }
      lastObservedSizeRef.current = { width, height };
      scheduleFit();
    });
    resizeObserver.observe(containerRef.current);

    // Initial resize sync
    const dims = fitAddon.proposeDimensions();
    if (dims) {
      invoke("pty_resize", { sessionId, cols: dims.cols, rows: dims.rows }).catch((err) => {
        logError("Initial PTY resize failed in XTermTerminal", { sessionId, dims, err });
      });
    }

    return () => {
      cancelled = true;
      textarea?.removeEventListener("compositionstart", onCompositionStart);
      textarea?.removeEventListener("compositionupdate", onCompositionUpdate);
      textarea?.removeEventListener("compositionend", onCompositionEnd);
      wheelTarget.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
      resizeObserver.disconnect();
      if (fitRafRef.current !== null) {
        cancelAnimationFrame(fitRafRef.current);
        fitRafRef.current = null;
      }
      if (compositionScrollRafId !== null) {
        cancelAnimationFrame(compositionScrollRafId);
        compositionScrollRafId = null;
      }
      if (writeRafId !== null) {
        cancelAnimationFrame(writeRafId);
        writeRafId = null;
      }
      pendingChunks = [];
      inactiveBufferRef.current = [];
      inactiveBufferSizeRef.current = 0;
      unlisten?.();
      webglAddon?.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  const backgroundColor = getTerminalBackground(terminalThemeName, resolvedTheme, lightThemePalette, darkThemePalette);

  return (
    <div className="h-full w-full overflow-hidden p-2" style={{ backgroundColor }}>
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
    </div>
  );
}
