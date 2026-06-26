import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { eventToCombo } from "../../hooks/useKeyboardShortcuts";
import { copyAiText } from "../../lib/aiClipboard";
import { formatAiAnchor, formatAiContextBlock, type AiTextSelection } from "../../lib/aiPathFormatter";
import { useI18n } from "../../lib/i18n";
import type { TerminalSession } from "../../lib/types";
import { configureMonaco, languageFromPath } from "../../lib/monacoSetup";
import { useSettingsStore } from "../../stores/settingsStore";
import { useFileExplorerStore } from "../../stores/fileExplorerStore";
import { MarkdownContent } from "../ui/MarkdownContent";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../ui/dialog";
import { Copy, FileCode, Image, Save, X } from "../icons";

configureMonaco();

interface FileEditorPaneProps {
  session: TerminalSession;
  isActive: boolean;
  terminalThemeBackground: string;
  onClose: () => void;
}

type PendingAction =
  | { kind: "close-pane" }
  | { kind: "close-file"; path: string }
  | null;

type MonacoEditor = Parameters<OnMount>[0];

function clearSearchDecorations(editor: MonacoEditor, decorationIdsRef: MutableRefObject<string[]>): void {
  if (decorationIdsRef.current.length === 0) return;
  decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
}

function findLineTextColumn(line: string, lineText: string): { start: number; end: number } {
  const needle = lineText.trim();
  if (!needle) return { start: 1, end: Math.max(line.length + 1, 1) };
  const index = line.indexOf(needle);
  if (index === -1) return { start: 1, end: Math.max(line.length + 1, 1) };
  return { start: index + 1, end: index + needle.length + 1 };
}

function findSearchColumn(line: string, searchQuery: string, fallbackLineText: string): { start: number; end: number } {
  const needle = searchQuery.trim();
  if (!needle) return findLineTextColumn(line, fallbackLineText);
  const index = line.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return findLineTextColumn(line, fallbackLineText);
  return { start: index + 1, end: index + needle.length + 1 };
}

function openFindWidget(editor: MonacoEditor, searchQuery: string): void {
  const query = searchQuery.trim();
  const findWithArgs = editor.getAction("editor.actions.findWithArgs");
  if (query && findWithArgs?.isSupported()) {
    void findWithArgs.run({
      searchString: query,
      isRegex: false,
      matchWholeWord: false,
      isCaseSensitive: false,
      findInSelection: false,
    }).catch(() => {
      void editor.getAction("actions.find")?.run();
    });
    return;
  }
  void editor.getAction("actions.find")?.run();
}

function isDarkHexColor(color: string): boolean {
  const raw = color.trim().replace(/^#/, "");
  const hex = raw.length === 3
    ? raw.split("").map((char) => `${char}${char}`).join("")
    : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return true;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance < 0.5;
}

export function FileEditorPane({ session, isActive, terminalThemeBackground, onClose }: FileEditorPaneProps) {
  const { t } = useI18n();
  const editorRef = useRef<MonacoEditor | null>(null);
  const searchDecorationIdsRef = useRef<string[]>([]);
  const [editorReadyNonce, setEditorReadyNonce] = useState(0);
  const copyAiShortcut = useSettingsStore((s) => s.keyboardShortcuts.copyAi);
  const project = useFileExplorerStore((s) => s.project);
  const openProject = useFileExplorerStore((s) => s.openProject);
  const openFiles = useFileExplorerStore((s) => s.openFiles);
  const activeFilePath = useFileExplorerStore((s) => s.activeFilePath);
  const activeFile = useFileExplorerStore((s) => s.activeFile);
  const searchQuery = useFileExplorerStore((s) => s.searchQuery);
  const searchNavigationTarget = useFileExplorerStore((s) => s.searchNavigationTarget);
  const setActiveFilePath = useFileExplorerStore((s) => s.setActiveFilePath);
  const clearSearchNavigationTarget = useFileExplorerStore((s) => s.clearSearchNavigationTarget);
  const closeFile = useFileExplorerStore((s) => s.closeFile);
  const setActiveContent = useFileExplorerStore((s) => s.setActiveContent);
  const saveFile = useFileExplorerStore((s) => s.saveFile);
  const saveActiveFile = useFileExplorerStore((s) => s.saveActiveFile);
  const [previewMode, setPreviewMode] = useState<"source" | "preview">("source");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const ownsFileState = Boolean(project?.id && session.fileEditor?.projectId && project.id === session.fileEditor.projectId);
  const visibleFiles = ownsFileState ? openFiles : [];
  const visibleFile = ownsFileState ? activeFile : null;
  const dirty = Boolean(visibleFile && visibleFile.content !== visibleFile.savedContent);
  const dirtyFiles = visibleFiles.filter((file) => file.content !== file.savedContent);
  const language = useMemo(() => visibleFile ? languageFromPath(visibleFile.path) : "plaintext", [visibleFile]);
  const editorTheme = useMemo(
    () => isDarkHexColor(terminalThemeBackground) ? "vs-dark" : "vs",
    [terminalThemeBackground]
  );

  const handleEditorMount = useCallback<OnMount>((editor) => {
    editorRef.current = editor;
    setEditorReadyNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    const fileProject = session.fileEditor?.project;
    if (!isActive || !project || !fileProject || project.id === fileProject.id) return;
    void openProject(fileProject);
  }, [isActive, openProject, project?.id, session.fileEditor?.project]);

  useEffect(() => {
    setPreviewMode("source");
  }, [visibleFile?.path]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    clearSearchDecorations(editor, searchDecorationIdsRef);
  }, [visibleFile?.path]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !visibleFile || !searchNavigationTarget) return;
    if (visibleFile.path !== searchNavigationTarget.path) return;
    if (visibleFile.previewKind !== "text" && visibleFile.previewKind !== "markdown") return;
    if (visibleFile.previewKind === "markdown" && previewMode !== "source") {
      setPreviewMode("source");
      return;
    }

    const model = editor.getModel();
    const lineNumber = Math.min(Math.max(searchNavigationTarget.lineNumber, 1), model?.getLineCount() ?? 1);
    const line = model?.getLineContent(lineNumber) ?? "";
    const column = findSearchColumn(line, searchQuery, searchNavigationTarget.lineText);

    clearSearchDecorations(editor, searchDecorationIdsRef);
    searchDecorationIdsRef.current = editor.deltaDecorations([], [
      {
        range: {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: Math.max(line.length + 1, 1),
        },
        options: {
          isWholeLine: true,
          className: "ui-file-editor-search-line-highlight",
        },
      },
      {
        range: {
          startLineNumber: lineNumber,
          startColumn: column.start,
          endLineNumber: lineNumber,
          endColumn: column.end,
        },
        options: {
          inlineClassName: "ui-file-editor-search-snippet-highlight",
        },
      },
    ]);
    editor.setSelection({
      startLineNumber: lineNumber,
      startColumn: column.start,
      endLineNumber: lineNumber,
      endColumn: column.end,
    });
    editor.revealLineInCenter(lineNumber);
    editor.focus();
    openFindWidget(editor, searchQuery);
    clearSearchNavigationTarget();
  }, [clearSearchNavigationTarget, editorReadyNonce, previewMode, searchNavigationTarget, searchQuery, visibleFile]);

  const save = useCallback(async () => {
    if (!visibleFile || visibleFile.previewKind === "image") return;
    await saveActiveFile();
  }, [saveActiveFile, visibleFile]);

  const getEditorSelection = useCallback((): AiTextSelection | null => {
    const selection = editorRef.current?.getSelection();
    if (!editorRef.current || !selection || selection.isEmpty()) return null;
    return {
      startLine: selection.startLineNumber,
      endLine: selection.endLineNumber,
      text: editorRef.current.getModel()?.getValueInRange(selection),
    };
  }, []);

  const copyActiveAiPath = useCallback(() => {
    if (!project || !visibleFile) return;
    const selection = (visibleFile.previewKind === "text" || visibleFile.previewKind === "markdown") && previewMode === "source"
      ? getEditorSelection()
      : null;
    void copyAiText(formatAiAnchor(project, visibleFile.path, selection), t("files.toast.aiPathCopied"));
  }, [getEditorSelection, previewMode, project, t, visibleFile]);

  const copyActiveAiContext = useCallback(() => {
    if (!project || !visibleFile) return;
    const selection = (visibleFile.previewKind === "text" || visibleFile.previewKind === "markdown") && previewMode === "source"
      ? getEditorSelection()
      : null;
    void copyAiText(formatAiContextBlock(project, visibleFile.path, selection), t("files.toast.aiContextCopied"));
  }, [getEditorSelection, previewMode, project, t, visibleFile]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isActive || !copyAiShortcut.trim()) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".ui-file-editor-pane")) return;
      if (eventToCombo(event) !== copyAiShortcut) return;
      event.preventDefault();
      event.stopPropagation();
      copyActiveAiPath();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [copyActiveAiPath, copyAiShortcut, isActive]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isActive) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void save();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, save]);

  const requestClose = () => {
    if (dirtyFiles.length > 0) {
      setPendingAction({ kind: "close-pane" });
      return;
    }
    onClose();
  };

  const discardAndRun = () => {
    setPendingAction(null);
    if (pendingAction?.kind === "close-file") {
      closeFile(pendingAction.path);
      return;
    }
    visibleFiles.forEach((file) => closeFile(file.path));
    onClose();
  };

  const saveAndRun = async () => {
    if (pendingAction?.kind === "close-file") {
      await saveFile(pendingAction.path);
      closeFile(pendingAction.path);
      setPendingAction(null);
      return;
    }
    for (const file of dirtyFiles) {
      await saveFile(file.path);
    }
    visibleFiles.forEach((file) => closeFile(file.path));
    setPendingAction(null);
    onClose();
  };

  const requestCloseFile = (path: string) => {
    const file = visibleFiles.find((item) => item.path === path);
    if (!file) return;
    if (file.content !== file.savedContent) {
      setPendingAction({ kind: "close-file", path });
      return;
    }
    closeFile(path);
  };

  return (
    <div className="ui-file-editor-pane flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="ui-file-editor-header flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface-container-low px-3">
        <FileCode size={15} strokeWidth={1.8} className="text-on-surface-variant" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-on-surface">
            {visibleFile ? visibleFile.name : session.fileEditor?.projectName ?? project?.name ?? t("files.editor.titleFallback")}
            {dirty ? " *" : ""}
          </div>
          <div className="truncate text-[10px] text-text-muted">
            {visibleFile?.path ?? session.fileEditor?.projectPath ?? project?.path ?? t("files.editor.noFile")}
          </div>
        </div>
        {visibleFile?.previewKind === "markdown" && (
          <div className="ui-file-editor-segment flex rounded-md border border-border bg-surface-container-lowest p-0.5">
            <button
              type="button"
              className="rounded px-2 py-1 text-[11px]"
              data-active={previewMode === "source" ? "true" : "false"}
              onClick={() => setPreviewMode("source")}
            >
              {t("files.editor.source")}
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-[11px]"
              data-active={previewMode === "preview" ? "true" : "false"}
              onClick={() => setPreviewMode("preview")}
            >
              {t("files.editor.preview")}
            </button>
          </div>
        )}
        <Button size="sm" variant="outline" disabled={!visibleFile} onClick={copyActiveAiPath}>
          <Copy size={13} />
          {t("files.editor.aiPath")}
        </Button>
        <Button size="sm" variant="outline" disabled={!visibleFile} onClick={copyActiveAiContext}>
          <Copy size={13} />
          {t("files.editor.aiContext")}
        </Button>
        <Button size="sm" variant="outline" disabled={!dirty} onClick={() => void save()}>
          <Save size={13} />
          {t("common.save")}
        </Button>
        <button type="button" className="ui-icon-action" title={t("files.editor.close")} aria-label={t("files.editor.close")} onClick={requestClose}>
          <X size={15} />
        </button>
      </div>

      {visibleFiles.length > 0 && (
        <div className="ui-file-editor-tabs flex h-8 shrink-0 items-center overflow-x-auto border-b border-border bg-surface-container-lowest px-1">
          {visibleFiles.map((file) => {
            const isActiveFile = file.path === activeFilePath;
            const isDirty = file.content !== file.savedContent;
            return (
              <div
                key={file.path}
                className="ui-file-editor-tab group flex h-7 max-w-[180px] shrink-0 items-center rounded-t text-[11px] text-on-surface-variant hover:bg-surface-container-high"
                data-active={isActiveFile ? "true" : "false"}
                style={isActiveFile ? { background: "var(--surface-container)", color: "var(--on-surface)" } : undefined}
                title={file.path}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate px-2 text-left"
                  onClick={() => setActiveFilePath(file.path)}
                >
                  {file.name}{isDirty ? " *" : ""}
                </button>
                <button
                  type="button"
                  className="mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-70 hover:bg-surface-container-highest hover:opacity-100"
                  aria-label={t("files.editor.closeNamed", { name: file.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    requestCloseFile(file.path);
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="ui-file-editor-body min-h-0 flex-1 overflow-hidden bg-surface">
        {!visibleFile && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-text-muted">
            <FileCode size={36} strokeWidth={1.2} />
            <div className="text-sm">{t("files.editor.selectFromTree")}</div>
          </div>
        )}
        {visibleFile?.previewKind === "unsupported" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-text-muted">
            <FileCode size={36} strokeWidth={1.2} />
            <div className="text-sm">{t("files.editor.unsupported")}</div>
          </div>
        )}
        {visibleFile?.previewKind === "image" && visibleFile.image && (
          <div className="ui-file-editor-image-preview flex h-full items-center justify-center overflow-auto bg-surface-container-lowest p-4">
            <div className="flex max-h-full max-w-full flex-col items-center gap-3">
              <img
                src={`data:${visibleFile.image.mimeType};base64,${visibleFile.image.dataBase64}`}
                alt={visibleFile.name}
                className="max-h-[calc(100vh-180px)] max-w-full rounded border border-border object-contain"
              />
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Image size={13} />
                {(visibleFile.image.sizeBytes / 1024).toFixed(1)} KB
              </div>
            </div>
          </div>
        )}
        {visibleFile && (visibleFile.previewKind === "text" || visibleFile.previewKind === "markdown") && (
          visibleFile.previewKind === "markdown" && previewMode === "preview" ? (
            <div className="ui-file-editor-markdown-preview h-full overflow-auto p-4">
              <MarkdownContent content={visibleFile.content} variant="terminal" linkBehavior="preview" />
            </div>
          ) : (
            <Editor
              path={visibleFile.path}
              value={visibleFile.content}
              language={language}
              theme={editorTheme}
              onMount={handleEditorMount}
              onChange={(value) => setActiveContent(value ?? "")}
              options={{
                automaticLayout: true,
                fontSize: 13,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                wordWrap: "on",
              }}
            />
          )
        )}
      </div>

      <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <DialogContent className="max-w-[420px]">
          <DialogTitle>{t("files.editor.unsavedTitle")}</DialogTitle>
          <DialogDescription className="mt-2">
            {pendingAction?.kind === "close-file"
              ? t("files.editor.unsavedOne")
              : t("files.editor.unsavedMany", { count: dirtyFiles.length })}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>{t("common.cancel")}</Button>
            <Button variant="outline" onClick={discardAndRun}>{t("files.editor.discard")}</Button>
            <Button onClick={() => void saveAndRun()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
