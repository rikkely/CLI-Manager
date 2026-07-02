import type { Project, TerminalSession } from "./types";

export function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function findProjectByPath(projects: Project[], path: string | null | undefined): Project | null {
  const normalizedPath = path?.trim() ? normalizeProjectPath(path) : "";
  if (!normalizedPath) return null;

  let bestMatch: Project | null = null;
  let bestMatchLength = -1;

  for (const project of projects) {
    const normalizedProjectPath = normalizeProjectPath(project.path);
    const matches = normalizedPath === normalizedProjectPath || normalizedPath.startsWith(`${normalizedProjectPath}/`);
    if (!matches || normalizedProjectPath.length <= bestMatchLength) continue;
    bestMatch = project;
    bestMatchLength = normalizedProjectPath.length;
  }

  return bestMatch;
}

export function resolveProjectForSession(
  session: TerminalSession | null,
  sessions: TerminalSession[],
  projects: Project[],
  projectById: Map<string, Project>,
  seenSessionIds: Set<string> = new Set()
): Project | null {
  if (!session || seenSessionIds.has(session.id)) return null;
  seenSessionIds.add(session.id);

  if (session.kind === "subagent-transcript" && session.subagent?.parentSessionId) {
    const parentSession = sessions.find((item) => item.id === session.subagent?.parentSessionId) ?? null;
    return resolveProjectForSession(parentSession, sessions, projects, projectById, seenSessionIds);
  }

  if (session.kind === "file-editor") {
    return session.fileEditor?.project
      ?? projectById.get(session.fileEditor?.projectId ?? "")
      ?? findProjectByPath(projects, session.fileEditor?.projectPath)
      ?? null;
  }

  if (session.projectId) {
    const project = projectById.get(session.projectId);
    if (project) return project;
  }

  return findProjectByPath(projects, session.cwd);
}
