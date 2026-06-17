import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { GitFileChange, GitTreeNode } from "../lib/types";

type GitStatusFilter = "all" | "M" | "A" | "D" | "U";

// 判断文件是否匹配当前筛选。
// 「新增」(A) 视为一组：已暂存新增(A)、未跟踪(U/??) 都算新增，与面板的 addedCount 定义保持一致。
function matchFilter(status: string, filter: GitStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "A") return status === "A" || status === "U" || status === "??";
  return status === filter;
}

interface GitStore {
  changes: GitFileChange[];
  tree: GitTreeNode[];
  collapsedDirs: Set<string>;
  loading: boolean;
  discarding: boolean;
  error: string | null;
  currentProjectPath: string | null;
  statusFilter: GitStatusFilter;

  fetchChanges: (projectPath: string, silent?: boolean) => Promise<void>;
  discardFile: (filePath: string, status: string) => Promise<void>;
  discardAll: () => Promise<void>;
  revertHunk: (diffText: string, hunkIndex: number) => Promise<void>;
  revertLines: (diffText: string, selectedLines: { side: "old" | "new"; lineNumber: number }[]) => Promise<void>;
  toggleDir: (path: string) => void;
  collapseAllDirs: () => void;
  expandAllDirs: () => void;
  setStatusFilter: (filter: GitStatusFilter) => void;
  reset: () => void;
}

function buildTree(changes: GitFileChange[]): GitTreeNode[] {
  const root: GitTreeNode[] = [];
  const dirMap = new Map<string, GitTreeNode>();

  // 按路径排序
  const sorted = [...changes].sort((a, b) => a.path.localeCompare(b.path));

  for (const change of sorted) {
    const parts = change.path.split(/[/\\]/);
    let currentLevel = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (i === parts.length - 1) {
        // 文件节点
        currentLevel.push({
          type: "file",
          name: part,
          path: currentPath,
          change,
        });
      } else {
        // 目录节点
        let dir = dirMap.get(currentPath);
        if (!dir) {
          dir = {
            type: "directory",
            name: part,
            path: currentPath,
            children: [],
          };
          dirMap.set(currentPath, dir);
          currentLevel.push(dir);
        }
        currentLevel = dir.children!;
      }
    }
  }

  return root;
}

function collectDirectoryPaths(nodes: GitTreeNode[]): string[] {
  const paths: string[] = [];

  const visit = (items: GitTreeNode[]) => {
    for (const node of items) {
      if (node.type !== "directory") continue;
      paths.push(node.path);
      visit(node.children ?? []);
    }
  };

  visit(nodes);
  return paths;
}

export const useGitStore = create<GitStore>((set, get) => ({
  changes: [],
  tree: [],
  collapsedDirs: new Set(),
  loading: false,
  discarding: false,
  error: null,
  currentProjectPath: null,
  statusFilter: "all",

  fetchChanges: async (projectPath: string, silent = false) => {
    // silent 模式用于聚焦轮询：不 set loading，避免每次刷新闪烁 spinner。
    if (silent) {
      set({ currentProjectPath: projectPath });
    } else {
      console.log(`[GitStore] 开始获取 Git 变更, projectPath: "${projectPath}"`);
      set({ loading: true, error: null, currentProjectPath: projectPath });
    }

    try {
      const changes = await invoke<GitFileChange[]>("git_get_changes", { projectPath });

      // 应用筛选
      const { statusFilter } = get();
      const filtered = changes.filter(c => matchFilter(c.status, statusFilter));
      const tree = buildTree(filtered);
      set({ changes, tree, loading: false });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[GitStore] 获取 Git 变更失败:`, err);
      // silent 失败（轮询）不清空已有数据、不弹错，避免打扰；仅非静默时显式报错。
      if (silent) {
        set({ loading: false });
      } else {
        set({ error: errorMsg, loading: false, changes: [], tree: [] });
      }
    }
  },

  discardFile: async (filePath: string, status: string) => {
    const { currentProjectPath } = get();
    if (!currentProjectPath) return;
    set({ discarding: true, error: null });
    try {
      await invoke("git_discard_file", { projectPath: currentProjectPath, filePath, status });
      await get().fetchChanges(currentProjectPath, true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[GitStore] 回滚文件失败:`, err);
      set({ error: errorMsg });
      throw err;
    } finally {
      set({ discarding: false });
    }
  },

  discardAll: async () => {
    const { currentProjectPath, changes } = get();
    if (!currentProjectPath) return;
    // 仅回滚已跟踪改动，排除未跟踪文件（U/??）。
    const trackable = changes.filter((c) => c.status !== "U" && c.status !== "??");
    if (trackable.length === 0) return;
    set({ discarding: true, error: null });
    try {
      for (const c of trackable) {
        await invoke("git_discard_file", {
          projectPath: currentProjectPath,
          filePath: c.path,
          status: c.status,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[GitStore] 批量回滚失败:`, err);
      set({ error: errorMsg });
    } finally {
      // 无论成功或部分失败都刷新，反映真实状态。
      await get().fetchChanges(currentProjectPath, true);
      set({ discarding: false });
    }
  },

  revertHunk: async (diffText: string, hunkIndex: number) => {
    const { currentProjectPath } = get();
    if (!currentProjectPath) return;
    set({ discarding: true, error: null });
    try {
      await invoke("git_revert_hunk", { projectPath: currentProjectPath, diffText, hunkIndex });
      await get().fetchChanges(currentProjectPath, true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[GitStore] 回滚 hunk 失败:`, err);
      set({ error: errorMsg });
      throw err;
    } finally {
      set({ discarding: false });
    }
  },

  revertLines: async (diffText, selectedLines) => {
    const { currentProjectPath } = get();
    if (!currentProjectPath) return;
    set({ discarding: true, error: null });
    try {
      await invoke("git_revert_lines", { projectPath: currentProjectPath, diffText, selectedLines });
      await get().fetchChanges(currentProjectPath, true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[GitStore] 回滚选中行失败:`, err);
      set({ error: errorMsg });
      throw err;
    } finally {
      set({ discarding: false });
    }
  },

  toggleDir: (path: string) => {
    set((state) => {
      const newCollapsed = new Set(state.collapsedDirs);
      if (newCollapsed.has(path)) {
        newCollapsed.delete(path);
      } else {
        newCollapsed.add(path);
      }
      return { collapsedDirs: newCollapsed };
    });
  },

  collapseAllDirs: () => {
    set((state) => ({ collapsedDirs: new Set(collectDirectoryPaths(state.tree)) }));
  },

  expandAllDirs: () => {
    set({ collapsedDirs: new Set() });
  },

  setStatusFilter: (filter: GitStatusFilter) => {
    set((state) => {
      const filtered = state.changes.filter(c => matchFilter(c.status, filter));
      const tree = buildTree(filtered);
      return { statusFilter: filter, tree };
    });
  },

  reset: () => {
    set({
      changes: [],
      tree: [],
      collapsedDirs: new Set(),
      loading: false,
      discarding: false,
      error: null,
      currentProjectPath: null,
      statusFilter: "all",
    });
  },
}));
