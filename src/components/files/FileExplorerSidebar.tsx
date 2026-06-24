import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { getMaterialFileIcon, getMaterialFolderIcon } from "@baybreezy/file-extension-icon";
import { copyAiText } from "../../lib/aiClipboard";
import { formatAiPathBlock, formatAiRootTree, formatAiTree, formatTerminalDragPath, TERMINAL_FILE_PATH_MIME } from "../../lib/aiPathFormatter";
import { beginTerminalFileDrag, endTerminalFileDrag } from "../../lib/terminalFileDrag";
import type { GitFileChange, ProjectFileEntry } from "../../lib/types";
import { isDefaultCollapsedDirectoryName, useFileExplorerStore } from "../../stores/fileExplorerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { STATUS_CONFIG } from "../git/GitStatusIcon";
import { ConfirmDialog } from "../ConfirmDialog";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../ui/context-menu";
import { ChevronRight, Copy, File, Folder, FolderPlus, RefreshCw, Search, Trash2, X } from "../icons";

type InputAction =
  | { kind: "create-file"; parentPath: string }
  | { kind: "create-dir"; parentPath: string }
  | { kind: "rename"; path: string; currentName: string };

type RenameAction = Extract<InputAction, { kind: "rename" }>;

type ConfirmAction =
  | { kind: "delete"; path: string; name: string }
  | { kind: "overwrite-create"; action: InputAction; value: string }
  | { kind: "overwrite-paste"; targetParentPath: string };

type FileDisplayStatus =
  | { kind: "editing"; label: string; color: string }
  | { kind: "git"; label: string; color: string };

interface AutoCollapseGroupState {
  expandedGroupPaths: Set<string>;
  ignoredPaths: Set<string>;
  toggleGroup: (parentPath: string) => void;
  ignorePath: (path: string) => void;
  unignorePath: (path: string) => void;
}

const EDITING_STATUS: FileDisplayStatus = {
  kind: "editing",
  label: "编辑",
  color: "#7dcfff",
};

const GIT_STATUS_LABELS: Record<GitFileChange["status"], string> = {
  M: "修改",
  A: "新增",
  D: "删除",
  R: "重命名",
  C: "冲突",
  U: "未提交",
  "??": "未提交",
};

function makeGitDisplayStatus(change: GitFileChange): FileDisplayStatus {
  const config = STATUS_CONFIG[change.status] ?? STATUS_CONFIG.M;
  return {
    kind: "git",
    label: GIT_STATUS_LABELS[change.status],
    color: config.color,
  };
}

function collectCompactDirectoryChain(entry: ProjectFileEntry): {
  suffixParts: string[];
  leaf: ProjectFileEntry;
  chainPaths: string[];
} {
  const suffixParts: string[] = [];
  let leaf = entry;
  const chainPaths = [entry.path];

  while (
    leaf.kind === "directory"
    && leaf.children?.length === 1
    && leaf.children[0].kind === "directory"
    && !isDefaultCollapsedDirectoryName(leaf.children[0].name)
  ) {
    const next = leaf.children[0];
    suffixParts.push(next.name);
    chainPaths.push(next.path);
    leaf = next;
  }

  return { suffixParts, leaf, chainPaths };
}

function splitAutoCollapsedEntries(entries: ProjectFileEntry[], ignoredPaths: Set<string>): {
  normalEntries: ProjectFileEntry[];
  collapsedEntries: ProjectFileEntry[];
} {
  const normalEntries: ProjectFileEntry[] = [];
  const collapsedEntries: ProjectFileEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === "directory" && (isDefaultCollapsedDirectoryName(entry.name) || ignoredPaths.has(entry.path))) {
      collapsedEntries.push(entry);
    } else {
      normalEntries.push(entry);
    }
  }

  return { normalEntries, collapsedEntries };
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function InlineRenameInput({
  initialName,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  const submit = () => {
    if (finishedRef.current) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialName) {
      cancel();
      return;
    }
    finishedRef.current = true;
    onSubmit(trimmed);
  };

  return (
    <input
      ref={inputRef}
      value={value}
      className="ui-focus-ring h-6 min-w-0 flex-1 rounded border border-primary/60 bg-surface-container-lowest px-2 text-[12px] text-on-surface outline-none"
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={submit}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
}

function AutoCollapsedGroupRow({
  depth,
  count,
  isOpen,
  onToggle,
}: {
  depth: number;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="ui-file-tree-row flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[12px] text-text-muted"
      style={{ paddingLeft: 8 + depth * 14 }}
      title={isOpen ? "收起自动折叠文件" : "展开自动折叠文件"}
      onClick={onToggle}
    >
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <ChevronRight size={12} style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }} />
      </span>
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <Folder size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate">已折叠文件: {count}</span>
    </button>
  );
}

function FileNode({
  entry,
  depth,
  getDisplayStatus,
  onOpenFile,
  onInput,
  onConfirm,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  onFileKeyDown,
  onFileDragStart,
  onFileDragEnd,
  autoCollapseGroups,
}: {
  entry: ProjectFileEntry;
  depth: number;
  getDisplayStatus: (entry: ProjectFileEntry) => FileDisplayStatus | null;
  onOpenFile: (entry: ProjectFileEntry) => void;
  onInput: (action: InputAction) => void;
  onConfirm: (action: ConfirmAction) => void;
  renamingPath: string | null;
  onRenameSubmit: (action: RenameAction, value: string) => void;
  onRenameCancel: () => void;
  onFileKeyDown: (event: ReactKeyboardEvent<HTMLElement>, entry: ProjectFileEntry) => void;
  onFileDragStart: (event: ReactDragEvent<HTMLElement>, entry: ProjectFileEntry) => void;
  onFileDragEnd: () => void;
  autoCollapseGroups: AutoCollapseGroupState;
}) {
  const project = useFileExplorerStore((s) => s.project);
  const expandedPaths = useFileExplorerStore((s) => s.expandedPaths);
  const toggleDir = useFileExplorerStore((s) => s.toggleDir);
  const collapseDir = useFileExplorerStore((s) => s.collapseDir);
  const setClipboard = useFileExplorerStore((s) => s.setClipboard);
  const pasteInto = useFileExplorerStore((s) => s.pasteInto);
  const clipboard = useFileExplorerStore((s) => s.clipboard);
  const activePath = useFileExplorerStore((s) => s.activeFile?.path ?? null);
  const isDir = entry.kind === "directory";
  const { suffixParts, leaf: displayEntry, chainPaths } = isDir
    ? collectCompactDirectoryChain(entry)
    : { suffixParts: [], leaf: entry, chainPaths: [entry.path] };
  const isOpen = isDir && expandedPaths.has(displayEntry.path);
  const isChainExpanded = isDir && chainPaths.some((path) => expandedPaths.has(path));
  const isManuallyIgnored = isDir && autoCollapseGroups.ignoredPaths.has(entry.path);
  const icon = isDir ? getMaterialFolderIcon(entry.name, isOpen) : getMaterialFileIcon(entry.name);
  const paddingLeft = 8 + depth * 14;
  const displayStatus = getDisplayStatus(displayEntry);
  const isRenaming = renamingPath === displayEntry.path;

  const paste = async () => {
    try {
      await pasteInto(displayEntry.path, false);
    } catch (err) {
      if (String(err).includes("target_exists")) {
        onConfirm({ kind: "overwrite-paste", targetParentPath: displayEntry.path });
        return;
      }
      throw err;
    }
  };

  const childRows = isDir && isOpen && displayEntry.children ? (
    <FileTreeRows
      entries={displayEntry.children}
      parentPath={displayEntry.path}
      depth={depth + 1}
      getDisplayStatus={getDisplayStatus}
      onOpenFile={onOpenFile}
      onInput={onInput}
      onConfirm={onConfirm}
      renamingPath={renamingPath}
      onRenameSubmit={onRenameSubmit}
      onRenameCancel={onRenameCancel}
      onFileKeyDown={onFileKeyDown}
      onFileDragStart={onFileDragStart}
      onFileDragEnd={onFileDragEnd}
      autoCollapseGroups={autoCollapseGroups}
    />
  ) : null;

  if (isRenaming) {
    return (
      <div>
        <div
          className="ui-file-tree-row flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[12px]"
          data-selected={activePath === displayEntry.path ? "true" : "false"}
          style={{ paddingLeft }}
          title={displayEntry.path}
        >
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">
            {isDir ? (
              <ChevronRight size={12} style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }} />
            ) : null}
          </span>
          <img src={icon} alt="" width={16} height={16} className="shrink-0" />
          <InlineRenameInput
            initialName={displayEntry.name}
            onSubmit={(value) => onRenameSubmit({ kind: "rename", path: displayEntry.path, currentName: displayEntry.name }, value)}
            onCancel={onRenameCancel}
          />
        </div>
        {childRows}
      </div>
    );
  }

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            className="ui-file-tree-row flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[12px]"
            data-selected={activePath === displayEntry.path ? "true" : "false"}
            draggable
            style={{ paddingLeft }}
            title={displayStatus ? `${displayEntry.path} · ${displayStatus.label}` : displayEntry.path}
            onContextMenu={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              onFileKeyDown(event, displayEntry);
              if (event.defaultPrevented) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (isDir) void toggleDir(displayEntry.path);
              else onOpenFile(displayEntry);
            }}
            onDragStart={(event) => onFileDragStart(event, displayEntry)}
            onDragEnd={onFileDragEnd}
            onClick={() => {
              if (isDir) void toggleDir(displayEntry.path);
              else onOpenFile(displayEntry);
            }}
          >
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">
              {isDir ? (
                <ChevronRight size={12} style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }} />
              ) : null}
            </span>
            <img src={icon} alt="" width={16} height={16} className="shrink-0" draggable={false} />
            <span
              className="flex min-w-0 flex-1 items-baseline gap-0.5 truncate"
              style={displayStatus ? { color: displayStatus.color } : undefined}
            >
              <span className="truncate">{entry.name}</span>
              {suffixParts.length > 0 && (
                <span className="truncate text-[11px] font-normal text-text-muted">
                  /{suffixParts.join("/")}
                </span>
              )}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {isDir && (
            <>
              <ContextMenuItem onSelect={() => onInput({ kind: "create-file", parentPath: displayEntry.path })}>
                <File size={13} /> 新建文件
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onInput({ kind: "create-dir", parentPath: displayEntry.path })}>
                <FolderPlus size={13} /> 新建文件夹
              </ContextMenuItem>
              <ContextMenuItem disabled={!clipboard} onSelect={() => void paste()}>
                <Copy size={13} /> 粘贴
              </ContextMenuItem>
              {isManuallyIgnored ? (
                <ContextMenuItem onSelect={() => autoCollapseGroups.unignorePath(entry.path)}>
                  <X size={13} /> 取消忽略
                </ContextMenuItem>
              ) : (
                <ContextMenuItem onSelect={() => {
                  autoCollapseGroups.ignorePath(entry.path);
                  if (isChainExpanded) collapseDir(entry.path);
                }}>
                  <ChevronRight size={13} /> 忽略
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onSelect={() => onInput({ kind: "rename", path: displayEntry.path, currentName: displayEntry.name })}>
            重命名
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setClipboard({ mode: "copy", path: displayEntry.path, name: displayEntry.name })}>
            复制
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setClipboard({ mode: "move", path: displayEntry.path, name: displayEntry.name })}>
            移动
          </ContextMenuItem>
          {project && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => void copyAiText(formatAiPathBlock(project, displayEntry.path, displayEntry.kind), "AI 路径已复制")}>
                <Copy size={13} /> 复制 AI 路径
              </ContextMenuItem>
              {isDir && (
                <ContextMenuItem onSelect={() => void copyAiText(formatAiTree(project, displayEntry), "AI 目录树已复制")}>
                  <Folder size={13} /> 复制 AI 树
                </ContextMenuItem>
              )}
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem danger onSelect={() => onConfirm({ kind: "delete", path: displayEntry.path, name: displayEntry.name })}>
            <Trash2 size={13} /> 删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {childRows}
    </div>
  );
}

function FileTreeRows({
  entries,
  parentPath,
  depth,
  getDisplayStatus,
  onOpenFile,
  onInput,
  onConfirm,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  onFileKeyDown,
  onFileDragStart,
  onFileDragEnd,
  autoCollapseGroups,
}: {
  entries: ProjectFileEntry[];
  parentPath: string;
  depth: number;
  getDisplayStatus: (entry: ProjectFileEntry) => FileDisplayStatus | null;
  onOpenFile: (entry: ProjectFileEntry) => void;
  onInput: (action: InputAction) => void;
  onConfirm: (action: ConfirmAction) => void;
  renamingPath: string | null;
  onRenameSubmit: (action: RenameAction, value: string) => void;
  onRenameCancel: () => void;
  onFileKeyDown: (event: ReactKeyboardEvent<HTMLElement>, entry: ProjectFileEntry) => void;
  onFileDragStart: (event: ReactDragEvent<HTMLElement>, entry: ProjectFileEntry) => void;
  onFileDragEnd: () => void;
  autoCollapseGroups: AutoCollapseGroupState;
}) {
  const { normalEntries, collapsedEntries } = splitAutoCollapsedEntries(entries, autoCollapseGroups.ignoredPaths);
  const groupOpen = autoCollapseGroups.expandedGroupPaths.has(parentPath);

  return (
    <div>
      {normalEntries.map((entry) => (
        <FileNode
          key={entry.path}
          entry={entry}
          depth={depth}
          getDisplayStatus={getDisplayStatus}
          onOpenFile={onOpenFile}
          onInput={onInput}
          onConfirm={onConfirm}
          renamingPath={renamingPath}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
          onFileKeyDown={onFileKeyDown}
          onFileDragStart={onFileDragStart}
          onFileDragEnd={onFileDragEnd}
          autoCollapseGroups={autoCollapseGroups}
        />
      ))}
      {collapsedEntries.length > 0 && (
        <>
          <AutoCollapsedGroupRow
            depth={depth}
            count={collapsedEntries.length}
            isOpen={groupOpen}
            onToggle={() => autoCollapseGroups.toggleGroup(parentPath)}
          />
          {groupOpen && collapsedEntries.map((entry) => (
            <FileNode
              key={entry.path}
              entry={entry}
              depth={depth + 1}
              getDisplayStatus={getDisplayStatus}
              onOpenFile={onOpenFile}
              onInput={onInput}
              onConfirm={onConfirm}
              renamingPath={renamingPath}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onFileKeyDown={onFileKeyDown}
              onFileDragStart={onFileDragStart}
              onFileDragEnd={onFileDragEnd}
              autoCollapseGroups={autoCollapseGroups}
            />
          ))}
        </>
      )}
    </div>
  );
}

export function FileExplorerSidebar() {
  const project = useFileExplorerStore((s) => s.project);
  const tree = useFileExplorerStore((s) => s.tree);
  const searchQuery = useFileExplorerStore((s) => s.searchQuery);
  const searchResults = useFileExplorerStore((s) => s.searchResults);
  const activeFile = useFileExplorerStore((s) => s.activeFile);
  const openFiles = useFileExplorerStore((s) => s.openFiles);
  const gitChanges = useFileExplorerStore((s) => s.gitChanges);
  const clipboard = useFileExplorerStore((s) => s.clipboard);
  const closeProject = useFileExplorerStore((s) => s.closeProject);
  const refresh = useFileExplorerStore((s) => s.refresh);
  const setSearchQuery = useFileExplorerStore((s) => s.setSearchQuery);
  const openFile = useFileExplorerStore((s) => s.openFile);
  const openFileEditorPane = useTerminalStore((s) => s.openFileEditorPane);
  const createEntry = useFileExplorerStore((s) => s.createEntry);
  const renameEntry = useFileExplorerStore((s) => s.renameEntry);
  const deleteEntry = useFileExplorerStore((s) => s.deleteEntry);
  const pasteInto = useFileExplorerStore((s) => s.pasteInto);
  const setClipboard = useFileExplorerStore((s) => s.setClipboard);
  const fileExplorerIgnoredPaths = useSettingsStore((s) => s.fileExplorerIgnoredPaths);
  const updateSetting = useSettingsStore((s) => s.update);
  const [inputAction, setInputAction] = useState<InputAction | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [renamingAction, setRenamingAction] = useState<RenameAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [expandedAutoCollapseGroups, setExpandedAutoCollapseGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedAutoCollapseGroups(new Set());
  }, [project?.id]);

  const visibleRows = searchQuery.trim() ? searchResults : tree;
  const gitChangeByPath = useMemo(() => new Map(gitChanges.map((change) => [change.path, change])), [gitChanges]);
  const dirtyFilePaths = useMemo(
    () => new Set(openFiles.filter((file) => file.content !== file.savedContent).map((file) => file.path)),
    [openFiles]
  );
  const ignoredPaths = useMemo(
    () => new Set(project ? fileExplorerIgnoredPaths[project.id] ?? [] : []),
    [fileExplorerIgnoredPaths, project]
  );

  const toggleAutoCollapseGroup = useCallback((parentPath: string) => {
    setExpandedAutoCollapseGroups((current) => {
      const next = new Set(current);
      if (next.has(parentPath)) {
        next.delete(parentPath);
      } else {
        next.add(parentPath);
      }
      return next;
    });
  }, []);

  const ignorePath = useCallback((path: string) => {
    if (!project) return;
    const current = useSettingsStore.getState().fileExplorerIgnoredPaths;
    const projectPaths = current[project.id] ?? [];
    if (projectPaths.includes(path)) return;
    void updateSetting("fileExplorerIgnoredPaths", {
      ...current,
      [project.id]: [...projectPaths, path],
    });
  }, [project, updateSetting]);

  const unignorePath = useCallback((path: string) => {
    if (!project) return;
    const current = useSettingsStore.getState().fileExplorerIgnoredPaths;
    const projectPaths = current[project.id] ?? [];
    if (!projectPaths.includes(path)) return;
    const nextPaths = projectPaths.filter((item) => item !== path);
    const next = { ...current };
    if (nextPaths.length > 0) {
      next[project.id] = nextPaths;
    } else {
      delete next[project.id];
    }
    void updateSetting("fileExplorerIgnoredPaths", next);
  }, [project, updateSetting]);

  const autoCollapseGroups = useMemo<AutoCollapseGroupState>(() => ({
    expandedGroupPaths: expandedAutoCollapseGroups,
    ignoredPaths,
    toggleGroup: toggleAutoCollapseGroup,
    ignorePath,
    unignorePath,
  }), [expandedAutoCollapseGroups, ignoredPaths, toggleAutoCollapseGroup, ignorePath, unignorePath]);

  const getDisplayStatus = useCallback((entry: ProjectFileEntry): FileDisplayStatus | null => {
    if (entry.kind !== "file") return null;
    if (dirtyFilePaths.has(entry.path)) return EDITING_STATUS;
    const change = gitChangeByPath.get(entry.path);
    return change ? makeGitDisplayStatus(change) : null;
  }, [dirtyFilePaths, gitChangeByPath]);

  const openInput = (action: InputAction) => {
    if (action.kind === "rename") {
      setInputAction(null);
      setRenamingAction(action);
      return;
    }
    setInputAction(action);
    setInputValue("");
  };

  const cancelRename = useCallback(() => {
    setRenamingAction(null);
  }, []);

  const submitRename = useCallback(async (action: RenameAction, rawValue: string, overwrite = false) => {
    const value = rawValue.trim();
    if (!value || value === action.currentName) {
      setRenamingAction(null);
      return;
    }
    try {
      await renameEntry(action.path, value, overwrite);
      setRenamingAction(null);
    } catch (err) {
      if (String(err).includes("target_exists")) {
        setRenamingAction(null);
        setConfirmAction({ kind: "overwrite-create", action, value });
        return;
      }
      throw err;
    }
  }, [renameEntry]);

  const performInputAction = useCallback(async (action: InputAction, rawValue: string, overwrite = false) => {
    const value = rawValue.trim();
    if (!value) return;
    try {
      if (action.kind === "create-file") {
        await createEntry(action.parentPath, value, "file", overwrite);
      } else if (action.kind === "create-dir") {
        await createEntry(action.parentPath, value, "directory", overwrite);
      } else {
        await renameEntry(action.path, value, overwrite);
      }
      setInputAction(null);
      setInputValue("");
    } catch (err) {
      if (String(err).includes("target_exists")) {
        setConfirmAction({ kind: "overwrite-create", action, value });
        return;
      }
      throw err;
    }
  }, [createEntry, renameEntry]);

  const submitInput = useCallback(async (overwrite = false) => {
    if (!inputAction) return;
    await performInputAction(inputAction, inputValue, overwrite);
  }, [inputAction, inputValue, performInputAction]);

  const pasteIntoTarget = useCallback(async (targetParentPath: string) => {
    try {
      await pasteInto(targetParentPath, false);
    } catch (err) {
      if (String(err).includes("target_exists")) {
        setConfirmAction({ kind: "overwrite-paste", targetParentPath });
        return;
      }
      throw err;
    }
  }, [pasteInto]);

  const getPasteTargetPath = useCallback((entry: ProjectFileEntry) => (
    entry.kind === "directory" ? entry.path : parentPath(entry.path)
  ), []);

  const handleFileKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>, entry: ProjectFileEntry) => {
    if (event.key === "F2" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      openInput({ kind: "rename", path: entry.path, currentName: entry.name });
      return;
    }

    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "x" && key !== "v") return;

    event.preventDefault();
    event.stopPropagation();
    if (key === "v") {
      void pasteIntoTarget(getPasteTargetPath(entry));
      return;
    }
    setClipboard({ mode: key === "c" ? "copy" : "move", path: entry.path, name: entry.name });
  }, [getPasteTargetPath, pasteIntoTarget, setClipboard]);

  const handleRootKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "v") return;
    event.preventDefault();
    event.stopPropagation();
    void pasteIntoTarget("");
  }, [pasteIntoTarget]);

  const handleFileDragStart = useCallback((event: ReactDragEvent<HTMLElement>, entry: ProjectFileEntry) => {
    if (!project) return;
    const text = formatTerminalDragPath(project, entry.path, entry.kind);
    beginTerminalFileDrag(text);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(TERMINAL_FILE_PATH_MIME, text);
    event.dataTransfer.setData("text/plain", text);
  }, [project]);

  const handleFileDragEnd = useCallback(() => {
    endTerminalFileDrag();
  }, []);

  const requestOpenFile = (entry: ProjectFileEntry) => {
    void openFile(entry);
    if (project) openFileEditorPane(project);
  };

  const renderSearchRow = useCallback((entry: ProjectFileEntry) => {
    if (!project) return null;
    const displayStatus = getDisplayStatus(entry);
    if (renamingAction?.path === entry.path) {
      return (
        <div
          key={entry.path}
          className="ui-file-tree-row flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px]"
          data-selected={activeFile?.path === entry.path ? "true" : "false"}
          title={entry.path}
        >
          <img src={entry.kind === "directory" ? getMaterialFolderIcon(entry.name, false) : getMaterialFileIcon(entry.name)} alt="" width={16} height={16} />
          <InlineRenameInput
            initialName={entry.name}
            onSubmit={(value) => void submitRename({ kind: "rename", path: entry.path, currentName: entry.name }, value)}
            onCancel={cancelRename}
          />
        </div>
      );
    }
    return (
      <ContextMenu key={entry.path}>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            className="ui-file-tree-row flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px]"
            data-selected={activeFile?.path === entry.path ? "true" : "false"}
            draggable
            onClick={() => entry.kind === "file" ? requestOpenFile(entry) : undefined}
            onContextMenu={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              handleFileKeyDown(event, entry);
              if (event.defaultPrevented) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (entry.kind === "file") requestOpenFile(entry);
            }}
            onDragStart={(event) => handleFileDragStart(event, entry)}
            onDragEnd={handleFileDragEnd}
            title={displayStatus ? `${entry.path} · ${displayStatus.label}` : entry.path}
          >
            <img src={entry.kind === "directory" ? getMaterialFolderIcon(entry.name, false) : getMaterialFileIcon(entry.name)} alt="" width={16} height={16} draggable={false} />
            <span
              className="min-w-0 flex-1 truncate"
              style={displayStatus ? { color: displayStatus.color } : undefined}
            >
              {entry.path}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => void copyAiText(formatAiPathBlock(project, entry.path, entry.kind), "AI 路径已复制")}>
            <Copy size={13} /> 复制 AI 路径
          </ContextMenuItem>
          {entry.kind === "directory" && (
            <ContextMenuItem onSelect={() => void copyAiText(formatAiTree(project, entry), "AI 目录树已复制")}>
              <Folder size={13} /> 复制 AI 树
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.path, cancelRename, getDisplayStatus, handleFileDragEnd, handleFileDragStart, handleFileKeyDown, openFile, project, renamingAction?.path, submitRename]);

  const copyRootAiPath = useCallback(() => {
    if (!project) return;
    void copyAiText(formatAiPathBlock(project, "", "directory"), "AI 路径已复制");
  }, [project]);

  const copyRootAiTree = useCallback(() => {
    if (!project) return;
    void copyAiText(formatAiRootTree(project, tree), "AI 目录树已复制");
  }, [project, tree]);

  const renderRows = useMemo(() => (
    visibleRows.length > 0 ? (
      searchQuery.trim() ? (
        visibleRows.map((entry) => renderSearchRow(entry))
      ) : (
        <FileTreeRows
          entries={visibleRows}
          parentPath=""
          depth={0}
          getDisplayStatus={getDisplayStatus}
          onOpenFile={requestOpenFile}
          onInput={openInput}
          onConfirm={setConfirmAction}
          renamingPath={renamingAction?.path ?? null}
          onRenameSubmit={(action, value) => void submitRename(action, value)}
          onRenameCancel={cancelRename}
          onFileKeyDown={handleFileKeyDown}
          onFileDragStart={handleFileDragStart}
          onFileDragEnd={handleFileDragEnd}
          autoCollapseGroups={autoCollapseGroups}
        />
      )
    ) : (
      <div className="px-3 py-8 text-center text-xs text-text-muted">没有文件</div>
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [searchQuery, visibleRows, renderSearchRow, getDisplayStatus, autoCollapseGroups, handleFileKeyDown, handleFileDragStart, handleFileDragEnd, renamingAction?.path, submitRename, cancelRename]);

  if (!project) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-2 py-2">
        <div className="mb-2 flex items-center gap-2">
          <Folder size={15} className="text-on-surface-variant" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-on-surface">{project.name}</div>
            <div className="truncate text-[10px] text-text-muted">{project.path}</div>
          </div>
          <button className="ui-icon-action" title="刷新" aria-label="刷新文件列表" onClick={() => void refresh()}>
            <RefreshCw size={13} />
          </button>
          <button className="ui-icon-action" title="返回项目树" aria-label="返回项目树" onClick={closeProject}>
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-surface-container-lowest px-2">
          <Search size={13} className="text-text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-on-surface outline-none"
            value={searchQuery}
            placeholder="搜索文件"
            onChange={(event) => void setSearchQuery(event.currentTarget.value)}
          />
        </div>
        {clipboard && <div className="mt-1 truncate text-[10px] text-text-muted">{clipboard.mode === "copy" ? "复制" : "移动"}：{clipboard.name}</div>}
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="min-h-0 flex-1 overflow-y-auto px-1 py-1 outline-none"
            tabIndex={0}
            onKeyDown={handleRootKeyDown}
          >
            {renderRows}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => openInput({ kind: "create-file", parentPath: "" })}>
            <File size={13} /> 新建文件
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openInput({ kind: "create-dir", parentPath: "" })}>
            <FolderPlus size={13} /> 新建文件夹
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={copyRootAiPath}>
            <Copy size={13} /> 复制 AI 路径
          </ContextMenuItem>
          <ContextMenuItem onSelect={copyRootAiTree}>
            <Folder size={13} /> 复制 AI 树
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={inputAction !== null} onOpenChange={(open) => { if (!open) setInputAction(null); }}>
        <DialogContent className="max-w-[360px]">
          <DialogTitle>{inputAction?.kind === "create-dir" ? "新建文件夹" : "新建文件"}</DialogTitle>
          <input
            className="ui-focus-ring mt-3 rounded-md border border-border bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none"
            value={inputValue}
            autoFocus
            onChange={(event) => setInputValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitInput(false);
              if (event.key === "Escape") setInputAction(null);
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setInputAction(null)}>取消</Button>
            <Button onClick={() => void submitInput(false)}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmAction?.kind === "delete"}
        title="确认删除？"
        message={confirmAction?.kind === "delete" ? `将删除 "${confirmAction.name}"。此操作不可撤销。` : undefined}
        confirmText="删除"
        danger
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (action?.kind === "delete") void deleteEntry(action.path);
        }}
      />
      <ConfirmDialog
        open={confirmAction?.kind === "overwrite-create" || confirmAction?.kind === "overwrite-paste"}
        title="目标已存在"
        message="是否覆盖目标文件或目录？"
        confirmText="覆盖"
        danger
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (action?.kind === "overwrite-create") {
            void performInputAction(action.action, action.value, true);
          }
          if (action?.kind === "overwrite-paste") {
            void pasteInto(action.targetParentPath, true);
          }
        }}
      />
    </div>
  );
}
