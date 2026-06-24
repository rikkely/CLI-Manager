import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { toast } from "sonner";
import type {
  GitFileChange,
  Project,
  ProjectFileEntry,
  ProjectFilePreviewKind,
  ProjectImageFilePayload,
  ProjectTextFilePayload,
} from "../lib/types";
import { logError } from "../lib/logger";

type ClipboardMode = "copy" | "move";
type FileEntryKind = "file" | "directory";

interface FileClipboard {
  mode: ClipboardMode;
  path: string;
  name: string;
}

interface ActiveProjectFile {
  path: string;
  name: string;
  previewKind: ProjectFilePreviewKind;
  content: string;
  savedContent: string;
  image: ProjectImageFilePayload | null;
  sizeBytes: number;
}

interface FileExplorerStore {
  project: Project | null;
  tree: ProjectFileEntry[];
  searchQuery: string;
  searchResults: ProjectFileEntry[];
  expandedPaths: Set<string>;
  loading: boolean;
  openFiles: ActiveProjectFile[];
  activeFilePath: string | null;
  activeFile: ActiveProjectFile | null;
  gitChanges: GitFileChange[];
  clipboard: FileClipboard | null;
  openProject: (project: Project) => Promise<void>;
  closeProject: () => void;
  refresh: () => Promise<void>;
  refreshGitChanges: () => Promise<void>;
  loadDir: (path: string) => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  collapseDir: (path: string) => void;
  setSearchQuery: (query: string) => Promise<void>;
  openFile: (entry: ProjectFileEntry) => Promise<void>;
  setActiveFilePath: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveContent: (content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveActiveFile: () => Promise<void>;
  createEntry: (parentPath: string, name: string, kind: FileEntryKind, overwrite: boolean) => Promise<void>;
  renameEntry: (path: string, newName: string, overwrite: boolean) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  setClipboard: (clipboard: FileClipboard | null) => void;
  pasteInto: (targetParentPath: string, overwrite: boolean) => Promise<void>;
}

export const DEFAULT_COLLAPSED_DIRECTORY_NAMES = [
  ".git",
  ".hg",
  ".svn",
  ".ace-tool",
  ".aider",
  ".augment",
  ".claude",
  ".cline",
  ".codex",
  ".continue",
  ".context",
  ".copilot",
  ".cody",
  ".cursor",
  ".devcontainer",
  ".devbox",
  ".devenv",
  ".direnv",
  ".eclipse",
  ".emacs.d",
  ".fleet",
  ".gemini",
  ".goose",
  ".helix",
  ".history",
  ".idea",
  ".idea_modules",
  ".ionide",
  ".jdtls",
  ".kiro",
  ".kdev4",
  ".lapce",
  ".lsp",
  ".metadata",
  ".netbeans",
  ".nvim",
  ".nova",
  ".openhands",
  ".opencode",
  ".omnisharp",
  ".projectile",
  ".qoder",
  ".ropeproject",
  ".roo",
  ".run",
  ".serena",
  ".settings",
  ".superpowers",
  ".tabnine",
  ".trae",
  ".trellis",
  ".vscode",
  ".vscode-insiders",
  ".vscode-test",
  ".vagrant",
  ".vim",
  ".windsurf",
  ".worktrees",
  ".zed",
  ".zed-server",
  "nbproject",
  "node_modules",
  "bower_components",
  ".yarn",
  ".pnpm-store",
  "vendor",
  "Pods",
  "Carthage",
  "deps",
  "dist",
  "build",
  "out",
  "output",
  ".output",
  "target",
  "bin",
  "obj",
  "Debug",
  "Release",
  "x64",
  "x86",
  "coverage",
  "htmlcov",
  "reports",
  "arthas-output",
  "BASE_HOME_IS_UNDEFINED",
  "nul",
  "artifacts",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".remix",
  ".vite",
  ".turbo",
  ".parcel-cache",
  ".webpack",
  ".angular",
  ".expo",
  ".vercel",
  ".netlify",
  ".docusaurus",
  "storybook-static",
  ".cache",
  "cache",
  ".gradle",
  ".intellijPlatform",
  ".bloop",
  ".bsp",
  ".ccls-cache",
  ".clangd",
  ".metals",
  ".scala-build",
  ".dart_tool",
  ".bundle",
  ".terraform",
  ".serverless",
  ".aws-sam",
  ".build",
  ".vs",
  "xcuserdata",
  "_ReSharper.Caches",
  "DerivedData",
  "CMakeFiles",
  "cmake-build-debug",
  "cmake-build-release",
  "cmake-build-relwithdebinfo",
  "cmake-build-minsizerel",
  "generated",
  "generated-sources",
  "generated-test-sources",
  "classes",
  "TestResults",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".nox",
  ".tox",
  ".pyre",
  ".pytype",
  ".hypothesis",
  ".ipynb_checkpoints",
  ".venv",
  "venv",
  "env",
  ".env",
  "logs",
  "log",
  "tmp",
  "temp",
] as const;

const DEFAULT_COLLAPSED_DIRECTORY_NAME_SET = new Set(
  DEFAULT_COLLAPSED_DIRECTORY_NAMES.map((name) => name.toLowerCase())
);

export function isDefaultCollapsedDirectoryName(name: string): boolean {
  return DEFAULT_COLLAPSED_DIRECTORY_NAME_SET.has(name.toLowerCase());
}

function isDefaultCollapsedPath(path: string): boolean {
  if (!path) return false;
  return path
    .split("/")
    .some(isDefaultCollapsedDirectoryName);
}

function pruneDefaultCollapsedPaths(paths: Set<string>): Set<string> {
  return new Set(Array.from(paths).filter((path) => path === "" || !isDefaultCollapsedPath(path)));
}

function collapsePath(paths: Set<string>, targetPath: string): Set<string> {
  if (!targetPath) return new Set([""]);
  return new Set(Array.from(paths).filter((path) => path !== targetPath && !path.startsWith(`${targetPath}/`)));
}

function normalizeEntry(entry: ProjectFileEntry): ProjectFileEntry {
  return {
    ...entry,
    kind: entry.kind === "directory" ? "directory" : "file",
    children: entry.children?.map(normalizeEntry),
  };
}

function replaceChildren(
  entries: ProjectFileEntry[],
  targetPath: string,
  children: ProjectFileEntry[]
): ProjectFileEntry[] {
  if (targetPath === "") return children;
  return entries.map((entry) => {
    if (entry.path === targetPath) return { ...entry, children };
    if (entry.children) return { ...entry, children: replaceChildren(entry.children, targetPath, children) };
    return entry;
  });
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function extension(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1).toLowerCase();
}

function isMarkdown(path: string): boolean {
  return ["md", "markdown", "mdown", "mkd"].includes(extension(path));
}

function isImage(path: string): boolean {
  return ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(extension(path));
}

async function listDir(rootPath: string, path: string): Promise<ProjectFileEntry[]> {
  const entries = await invoke<ProjectFileEntry[]>("file_list_dir", {
    rootPath,
    relativePath: path,
  });
  return entries.map(normalizeEntry);
}

async function fetchGitChanges(projectPath: string): Promise<GitFileChange[]> {
  try {
    return await invoke<GitFileChange[]>("git_get_changes", { projectPath });
  } catch {
    return [];
  }
}

function isSameOrChildPath(path: string, targetPath: string): boolean {
  return path === targetPath || path.startsWith(`${targetPath}/`);
}

function selectFallbackFile(files: ActiveProjectFile[], closedPath: string): ActiveProjectFile | null {
  if (files.length === 0) return null;
  const closedIndex = files.findIndex((file) => file.path === closedPath);
  if (closedIndex <= 0) return files[0];
  return files[Math.min(closedIndex - 1, files.length - 1)];
}

export const useFileExplorerStore = create<FileExplorerStore>((set, get) => ({
  project: null,
  tree: [],
  searchQuery: "",
  searchResults: [],
  expandedPaths: new Set([""]),
  loading: false,
  openFiles: [],
  activeFilePath: null,
  activeFile: null,
  gitChanges: [],
  clipboard: null,

  openProject: async (project) => {
    const current = get().project;
    const keepCurrentProject = current?.id === project.id;
    set({
      project,
      loading: true,
      searchQuery: "",
      searchResults: [],
      expandedPaths: keepCurrentProject ? pruneDefaultCollapsedPaths(get().expandedPaths) : new Set([""]),
      openFiles: keepCurrentProject ? get().openFiles : [],
      activeFilePath: keepCurrentProject ? get().activeFilePath : null,
      activeFile: keepCurrentProject ? get().activeFile : null,
      gitChanges: keepCurrentProject ? get().gitChanges : [],
      clipboard: keepCurrentProject ? get().clipboard : null,
    });
    try {
      const [tree, gitChanges] = await Promise.all([
        listDir(project.path, ""),
        fetchGitChanges(project.path),
      ]);
      set({ tree, gitChanges, loading: false });
    } catch (err) {
      logError("Failed to open project files", err);
      toast.error("文件列表加载失败", { description: String(err) });
      set({ tree: [], gitChanges: [], loading: false });
    }
  },

  closeProject: () => {
    set({
      project: null,
      tree: [],
      searchQuery: "",
      searchResults: [],
      expandedPaths: new Set([""]),
      openFiles: [],
      activeFilePath: null,
      activeFile: null,
      gitChanges: [],
      clipboard: null,
    });
  },

  refresh: async () => {
    const project = get().project;
    if (!project) return;
    await get().openProject(project);
    if (get().searchQuery.trim()) await get().setSearchQuery(get().searchQuery);
  },

  refreshGitChanges: async () => {
    const project = get().project;
    if (!project) return;
    const gitChanges = await fetchGitChanges(project.path);
    set({ gitChanges });
  },

  loadDir: async (path) => {
    const project = get().project;
    if (!project) return;
    const children = await listDir(project.path, path);
    set((state) => ({ tree: replaceChildren(state.tree, path, children) }));
  },

  toggleDir: async (path) => {
    const expanded = new Set(get().expandedPaths);
    if (expanded.has(path)) {
      expanded.delete(path);
      set({ expandedPaths: expanded });
      return;
    }
    expanded.add(path);
    set({ expandedPaths: expanded });
    await get().loadDir(path);
  },

  collapseDir: (path) => {
    set((state) => ({ expandedPaths: collapsePath(state.expandedPaths, path) }));
  },

  setSearchQuery: async (query) => {
    const project = get().project;
    set({ searchQuery: query });
    if (!project || !query.trim()) {
      set({ searchResults: [] });
      return;
    }
    try {
      const results = await invoke<ProjectFileEntry[]>("file_search", {
        rootPath: project.path,
        query,
      });
      set({ searchResults: results.map(normalizeEntry) });
    } catch (err) {
      logError("File search failed", err);
      toast.error("文件搜索失败", { description: String(err) });
    }
  },

  openFile: async (entry) => {
    const project = get().project;
    if (!project || entry.kind !== "file") return;
    const existing = get().openFiles.find((file) => file.path === entry.path);
    if (existing) {
      set({ activeFilePath: existing.path, activeFile: existing });
      return;
    }

    set({ loading: true });
    try {
      if (isImage(entry.path)) {
        const image = await invoke<ProjectImageFilePayload>("file_read_image", {
          rootPath: project.path,
          relativePath: entry.path,
        });
        const file = {
          path: entry.path,
          name: entry.name,
          previewKind: "image" as const,
          content: "",
          savedContent: "",
          image,
          sizeBytes: image.sizeBytes,
        };
        set({
          loading: false,
          openFiles: [...get().openFiles, file],
          activeFilePath: file.path,
          activeFile: file,
        });
        return;
      }

      const text = await invoke<ProjectTextFilePayload>("file_read_text", {
        rootPath: project.path,
        relativePath: entry.path,
      });
      const file = {
        path: entry.path,
        name: entry.name,
        previewKind: isMarkdown(entry.path) ? "markdown" as const : "text" as const,
        content: text.content,
        savedContent: text.content,
        image: null,
        sizeBytes: text.sizeBytes,
      };
      set({
        loading: false,
        openFiles: [...get().openFiles, file],
        activeFilePath: file.path,
        activeFile: file,
      });
    } catch (err) {
      const message = String(err);
      const file = {
        path: entry.path,
        name: entry.name,
        previewKind: "unsupported" as const,
        content: "",
        savedContent: "",
        image: null,
        sizeBytes: entry.sizeBytes,
      };
      set({
        loading: false,
        openFiles: [...get().openFiles, file],
        activeFilePath: file.path,
        activeFile: file,
      });
      toast.warning("无法预览此文件", { description: message });
    }
  },

  setActiveFilePath: (path) => {
    const file = get().openFiles.find((item) => item.path === path) ?? null;
    if (!file) return;
    set({ activeFilePath: file.path, activeFile: file });
  },

  closeFile: (path) => {
    const files = get().openFiles;
    const remaining = files.filter((file) => file.path !== path);
    const fallback = get().activeFilePath === path ? selectFallbackFile(remaining, path) : get().activeFile;
    set({
      openFiles: remaining,
      activeFilePath: fallback?.path ?? null,
      activeFile: fallback,
    });
  },

  setActiveContent: (content) => {
    const activePath = get().activeFilePath;
    if (!activePath) return;
    const files = get().openFiles.map((file) => (
      file.path === activePath ? { ...file, content } : file
    ));
    const activeFile = files.find((file) => file.path === activePath) ?? null;
    set({ openFiles: files, activeFile });
  },

  saveFile: async (path) => {
    const project = get().project;
    const file = get().openFiles.find((item) => item.path === path);
    if (!project || !file || file.previewKind === "image") return;
    await invoke("file_write_text", {
      rootPath: project.path,
      relativePath: file.path,
      content: file.content,
    });
    const saved = { ...file, savedContent: file.content };
    set({
      openFiles: get().openFiles.map((file) => file.path === saved.path ? saved : file),
      activeFile: get().activeFilePath === saved.path ? saved : get().activeFile,
    });
    await get().refreshGitChanges();
    toast.success("文件已保存");
  },

  saveActiveFile: async () => {
    const activeFile = get().activeFile;
    if (!activeFile) return;
    await get().saveFile(activeFile.path);
  },

  createEntry: async (parent, name, kind, overwrite) => {
    const project = get().project;
    if (!project) return;
    const command = kind === "directory" ? "file_create_dir" : "file_create_file";
    await invoke(command, { rootPath: project.path, parentPath: parent, name, overwrite });
    await get().loadDir(parent);
    await get().refreshGitChanges();
    if (get().searchQuery.trim()) await get().setSearchQuery(get().searchQuery);
  },

  renameEntry: async (path, newName, overwrite) => {
    const project = get().project;
    if (!project) return;
    await invoke("file_rename", {
      rootPath: project.path,
      relativePath: path,
      newName,
      overwrite,
    });
    await get().loadDir(parentPath(path));
    await get().refreshGitChanges();
    const openFiles = get().openFiles.filter((file) => !isSameOrChildPath(file.path, path));
    const activeFile = openFiles.find((file) => file.path === get().activeFilePath) ?? null;
    set({ openFiles, activeFilePath: activeFile?.path ?? null, activeFile });
    if (get().searchQuery.trim()) await get().setSearchQuery(get().searchQuery);
  },

  deleteEntry: async (path) => {
    const project = get().project;
    if (!project) return;
    await invoke("file_delete", { rootPath: project.path, relativePath: path });
    await get().loadDir(parentPath(path));
    await get().refreshGitChanges();
    const openFiles = get().openFiles.filter((file) => !isSameOrChildPath(file.path, path));
    const activeFile = openFiles.find((file) => file.path === get().activeFilePath) ?? openFiles[0] ?? null;
    set({ openFiles, activeFilePath: activeFile?.path ?? null, activeFile });
    if (get().searchQuery.trim()) await get().setSearchQuery(get().searchQuery);
  },

  setClipboard: (clipboard) => set({ clipboard }),

  pasteInto: async (targetParentPath, overwrite) => {
    const project = get().project;
    const clipboard = get().clipboard;
    if (!project || !clipboard) return;
    const command = clipboard.mode === "copy" ? "file_copy" : "file_move";
    await invoke(command, {
      rootPath: project.path,
      sourcePath: clipboard.path,
      targetParentPath,
      name: clipboard.name,
      overwrite,
    });
    await get().loadDir(targetParentPath);
    await get().refreshGitChanges();
    if (clipboard.mode === "move") {
      await get().loadDir(parentPath(clipboard.path));
      const openFiles = get().openFiles.filter((file) => !isSameOrChildPath(file.path, clipboard.path));
      const activeFile = openFiles.find((file) => file.path === get().activeFilePath) ?? openFiles[0] ?? null;
      set({ openFiles, activeFilePath: activeFile?.path ?? null, activeFile });
      set({ clipboard: null });
    }
    if (get().searchQuery.trim()) await get().setSearchQuery(get().searchQuery);
  },
}));

export function isProjectFileDirty(): boolean {
  return useFileExplorerStore.getState().openFiles.some((file) => file.content !== file.savedContent);
}
