import type { SyncedHistoryGroup } from "./externalSessionGrouping";

function normalizeCommand(value?: string | null): string {
  return value?.trim() ?? "";
}

function hasExactCliCommand(command: string, cliTool: string): boolean {
  return command.localeCompare(cliTool, undefined, { sensitivity: "accent" }) === 0;
}

function findLatestResumeCommand(group: SyncedHistoryGroup | null | undefined): string {
  if (!group?.sessions.length) return "";
  for (const session of group.sessions) {
    const command = normalizeCommand(session.startupCmd);
    if (command) return command;
  }
  return "";
}

export async function appendSyncedHistoryContextArg(
  cliTool: string | undefined,
  startupCmd: string | undefined,
  group: SyncedHistoryGroup | null | undefined,
  _shell?: string | undefined
): Promise<string> {
  const command = normalizeCommand(startupCmd);
  const normalizedCliTool = normalizeCommand(cliTool);
  const latestResumeCommand = findLatestResumeCommand(group);

  if (!latestResumeCommand) return command;
  if (!command) return latestResumeCommand;

  // 仅在启动命令还是裸 CLI 时替换成最近一次同步历史的 resume 命令。
  // 带有自定义参数的命令保持原样，避免覆盖用户显式配置。
  if (normalizedCliTool && hasExactCliCommand(command, normalizedCliTool)) {
    return latestResumeCommand;
  }

  return command;
}
