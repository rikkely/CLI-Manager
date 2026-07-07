import { invoke } from "@tauri-apps/api/core";
import { info } from "@tauri-apps/plugin-log";
import type { CommandHistoryEntry, CommandTemplate } from "./types";
import { BUILTIN_AI_COMMANDS, type BuiltinAiCommand } from "./builtinAiCommands";

export const TERMINAL_INPUT_SUGGESTION_AI_MODEL = "gpt-5.3-codex-spark";
export const TERMINAL_INPUT_SUGGESTION_BUILTIN_PROMPT = [
  "You complete shell commands for a desktop terminal.",
  "Return strict JSON only: {\"command\":\"...\"}.",
  "The command must be one line and must start with the user's current input exactly.",
  "Do not explain. Do not wrap in markdown. Do not invent destructive flags unless clearly implied.",
  "Prefer commands from recent history, templates, and common developer CLI usage.",
].join(" ");

export type TerminalInputSuggestionProvider = "local" | "ai";
export type TerminalInputSuggestionSource = "history" | "template" | "builtin" | "ai";
export type TerminalInputSuggestionModelStatus = "operational" | "degraded" | "failed";

export interface TerminalInputSuggestion {
  id: string;
  command: string;
  suffix: string;
  source: TerminalInputSuggestionSource;
  score: number;
}

export interface TerminalInputSuggestionContext {
  input: string;
  projectId: string | null;
  cwd?: string | null;
  sessionId?: string | null;
  previousCommand?: string | null;
  history: CommandHistoryEntry[];
  templates: CommandTemplate[];
  provider: TerminalInputSuggestionProvider;
  model?: string;
  aiConfig?: TerminalInputSuggestionAiConfig;
  debugLogging?: boolean;
}

export interface TerminalInputSuggestionOptions {
  limit?: number;
}

export interface TerminalInputSuggestionAiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
}

export interface TerminalInputSuggestionModelTestResult {
  status: TerminalInputSuggestionModelStatus;
  success: boolean;
  message: string;
  responseTimeMs?: number;
  httpStatus?: number;
  testedAt: number;
}

export interface TerminalInputSuggestionUsageStats {
  requestCount: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  acceptedCount: number;
  totalResponseTimeMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  lastStatus: TerminalInputSuggestionModelStatus | "fallback" | null;
  lastMessage: string | null;
  lastResponseTimeMs: number | null;
  lastUsedAt: number | null;
  lastAcceptedAt: number | null;
}

export interface TerminalInputSuggestionAiAttempt {
  attempted: boolean;
  success: boolean;
  fallback: boolean;
  status: TerminalInputSuggestionModelStatus | "fallback";
  message: string;
  responseTimeMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface TerminalInputSuggestionResult {
  suggestions: TerminalInputSuggestion[];
  aiAttempt?: TerminalInputSuggestionAiAttempt;
}

interface BackendCommandSuggestionResponse {
  command: string | null;
  responseTimeMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}

interface Candidate {
  id: string;
  command: string;
  source: TerminalInputSuggestionSource;
  score: number;
}

const DEFAULT_LIMIT = 1;
const MAX_COMMAND_LENGTH = 500;
const AI_CONTEXT_LIMIT = 12;
const AI_CONTEXT_COMMAND_MAX_LENGTH = 240;
const SECRET_VALUE_PATTERN =
  /(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9_]{16,}|xox[baprs]-[a-z0-9-]{16,}|akia[0-9a-z]{16}|(?:api[_-]?key|token|password|passwd|secret)\s*[:=]\s*["']?[^"'\s]+|authorization\s*:\s*bearer\s+[^"'\s]+|bearer\s+[a-z0-9._-]{20,})/giu;
const SECRET_FILE_PATTERN = /(?:^|[\s"'=])(?:\.env(?:\.\w+)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519)(?:$|[\s"'])/iu;
const DANGEROUS_AI_SUFFIX_PATTERNS: readonly RegExp[] = [
  /(?:^|[;&|]\s*)(?:rm|del|rmdir|remove-item)\b/iu,
  /\bcurl\b[\s\S]*\|\s*(?:sh|bash|zsh|fish|powershell|pwsh)\b/iu,
  /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod)\b[\s\S]*\|\s*(?:iex|invoke-expression)\b/iu,
  /\|\s*(?:sh|bash|zsh|fish|powershell|pwsh|cmd)\b/iu,
  /(?:^|\s)--(?:force|yes|assume-yes|no-preserve-root)(?:\s|$)/iu,
  /(?:^|\s)-[a-z]*[fy][a-z]*(?:\s|$)/iu,
];

export const DEFAULT_TERMINAL_INPUT_SUGGESTION_USAGE: TerminalInputSuggestionUsageStats = {
  requestCount: 0,
  successCount: 0,
  failureCount: 0,
  fallbackCount: 0,
  acceptedCount: 0,
  totalResponseTimeMs: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  lastStatus: null,
  lastMessage: null,
  lastResponseTimeMs: null,
  lastUsedAt: null,
  lastAcceptedAt: null,
};

const normalizeCommand = (value: string) => value.replace(/\r?\n$/u, "").trim();

export function getSafeSuggestionSuffix(
  input: string,
  command: string,
  options: { source?: TerminalInputSuggestionSource } = {}
): string | null {
  if (!input || input.includes("\n") || input.includes("\r")) return null;
  if (!command || command.includes("\n") || command.includes("\r")) return null;
  if (command.length > MAX_COMMAND_LENGTH) return null;

  const inputLower = input.toLocaleLowerCase();
  const commandLower = command.toLocaleLowerCase();
  if (!commandLower.startsWith(inputLower) || command.length <= input.length) return null;
  const suffix = command.slice(input.length);
  if (options.source === "ai" && isDangerousAiSuggestionSuffix(suffix)) return null;
  return suffix;
}

function isDangerousAiSuggestionSuffix(suffix: string): boolean {
  return DANGEROUS_AI_SUFFIX_PATTERNS.some((pattern) => pattern.test(suffix));
}

function scoreHistoryEntry(
  entry: CommandHistoryEntry,
  input: string,
  projectId: string | null,
  index: number
): Candidate | null {
  const command = normalizeCommand(entry.command);
  const suffix = getSafeSuggestionSuffix(input, command);
  if (!suffix) return null;

  const executedAt = Number(entry.executed_at);
  const agePenalty = Number.isFinite(executedAt)
    ? Math.min(20, Math.max(0, (Date.now() - executedAt) / 86_400_000))
    : 10;
  const projectBoost = projectId && entry.project_id === projectId ? 16 : entry.project_id === null ? 4 : 0;

  return {
    id: `history:${entry.id}`,
    command,
    source: "history",
    score: 100 + projectBoost - agePenalty - index * 0.2,
  };
}

function scoreTemplate(template: CommandTemplate, input: string, index: number): Candidate | null {
  const command = normalizeCommand(template.command);
  const suffix = getSafeSuggestionSuffix(input, command);
  if (!suffix) return null;

  const scopeBoost = template.session_id ? 14 : template.project_id ? 10 : 4;
  return {
    id: `template:${template.id}`,
    command,
    source: "template",
    score: 70 + scopeBoost - index * 0.1,
  };
}

function scoreBuiltinCommand(item: BuiltinAiCommand, input: string, index: number): Candidate | null {
  const command = normalizeCommand(item.command);
  const suffix = getSafeSuggestionSuffix(input, command);
  if (!suffix) return null;

  const isSlashCommand = command.startsWith("/");
  const launchBoost = item.category === "launch" ? 3 : 0;
  const toolRootBoost = command === item.tool || command.startsWith(`${item.tool} `) ? 2 : 0;
  const compactCommandBoost = Math.max(0, 4 - command.length / 80);

  return {
    id: `builtin:${item.id}`,
    command,
    source: "builtin",
    score: (isSlashCommand ? 68 : 76) + launchBoost + toolRootBoost + compactCommandBoost - index * 0.03,
  };
}

export function getLocalTerminalInputSuggestions(
  context: TerminalInputSuggestionContext,
  options: TerminalInputSuggestionOptions = {}
): TerminalInputSuggestion[] {
  const input = context.input;
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const candidatesByCommand = new Map<string, Candidate>();

  const push = (candidate: Candidate | null) => {
    if (!candidate) return;
    const existing = candidatesByCommand.get(candidate.command);
    if (!existing || candidate.score > existing.score) {
      candidatesByCommand.set(candidate.command, candidate);
    }
  };

  context.history.forEach((entry, index) => push(scoreHistoryEntry(entry, input, context.projectId, index)));
  context.templates.forEach((template, index) => push(scoreTemplate(template, input, index)));
  BUILTIN_AI_COMMANDS.forEach((item, index) => push(scoreBuiltinCommand(item, input, index)));

  return Array.from(candidatesByCommand.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((candidate) => ({
      ...candidate,
      suffix: candidate.command.slice(input.length),
    }));
}

function isUsableAiConfig(config: TerminalInputSuggestionAiConfig | undefined): config is TerminalInputSuggestionAiConfig {
  return Boolean(
    config?.enabled &&
      config.baseUrl.trim() &&
      config.apiKey.trim() &&
      config.model.trim() &&
      config.prompt.trim()
  );
}

function commandRoot(command: string): string {
  return command.trim().split(/\s+/u)[0]?.toLocaleLowerCase() ?? "";
}

function rootsAreCompatible(inputRoot: string, command: string): boolean {
  if (!inputRoot) return true;
  const root = commandRoot(command);
  return Boolean(root && (root.startsWith(inputRoot) || inputRoot.startsWith(root)));
}

function sanitizeAiContextCommand(value: string): string | null {
  const command = normalizeCommand(value);
  if (!command || command.length > AI_CONTEXT_COMMAND_MAX_LENGTH) return null;
  if (SECRET_FILE_PATTERN.test(command)) return null;
  SECRET_VALUE_PATTERN.lastIndex = 0;
  const redacted = command.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
  return redacted.includes("[REDACTED]") ? redacted : command;
}

function hasSecretValue(value: string): boolean {
  SECRET_VALUE_PATTERN.lastIndex = 0;
  return SECRET_VALUE_PATTERN.test(value);
}

function compactCwdForAiContext(value: string | null | undefined): string | null {
  const cwd = value?.trim();
  if (!cwd || SECRET_FILE_PATTERN.test(cwd) || hasSecretValue(cwd)) return null;
  const parts = cwd.split(/[\\/]+/u).filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : cwd;
}

function logAiSuggestionDebug(
  context: TerminalInputSuggestionContext,
  event: string,
  data: Record<string, unknown> = {}
): void {
  if (!context.debugLogging) return;
  void info(`[command-suggestion:debug] ${JSON.stringify({
    event,
    model: context.aiConfig?.model || context.model || null,
    inputChars: context.input.length,
    ...data,
  })}`).catch(() => {});
}

function compactHistory(history: CommandHistoryEntry[], input: string): string[] {
  const inputRoot = commandRoot(input);
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of history) {
    const command = sanitizeAiContextCommand(entry.command);
    if (!command || seen.has(command) || !rootsAreCompatible(inputRoot, command)) continue;
    seen.add(command);
    items.push(command);
    if (items.length >= AI_CONTEXT_LIMIT) break;
  }
  return items;
}

function compactTemplates(templates: CommandTemplate[], input: string): string[] {
  const inputRoot = commandRoot(input);
  const seen = new Set<string>();
  const items: string[] = [];
  for (const template of templates) {
    const command = sanitizeAiContextCommand(template.command);
    if (!command || seen.has(command) || !rootsAreCompatible(inputRoot, command)) continue;
    seen.add(command);
    items.push(command);
    if (items.length >= AI_CONTEXT_LIMIT) break;
  }
  return items;
}

export async function getTerminalInputSuggestionAiResult(
  context: TerminalInputSuggestionContext
): Promise<TerminalInputSuggestionResult> {
  const config = isUsableAiConfig(context.aiConfig) ? context.aiConfig : undefined;
  if (!config) {
    logAiSuggestionDebug(context, "missing_ai_config");
    return {
      suggestions: [],
      aiAttempt: {
        attempted: true,
        success: false,
        fallback: true,
        status: "fallback",
        message: "missing_ai_config",
      },
    };
  }

  try {
    const cwd = compactCwdForAiContext(context.cwd);
    const history = compactHistory(context.history, context.input);
    const templates = compactTemplates(context.templates, context.input);
    logAiSuggestionDebug(context, "request_start", {
      cwdPresent: Boolean(cwd),
      previousPresent: Boolean(context.previousCommand?.trim()),
      historyCount: history.length,
      templateCount: templates.length,
    });
    const response = await invoke<BackendCommandSuggestionResponse>("command_suggestion_generate", {
      request: {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        prompt: config.prompt,
        input: context.input,
        cwd,
        previousCommand: context.previousCommand ?? null,
        history,
        templates,
      },
    });
    logAiSuggestionDebug(context, "response_received", {
      responseTimeMs: response.responseTimeMs,
      hasCommand: Boolean(response.command),
      commandChars: response.command?.length ?? 0,
      inputTokens: response.inputTokens ?? null,
      outputTokens: response.outputTokens ?? null,
      totalTokens: response.totalTokens ?? null,
    });
    const command = normalizeCommand(response.command ?? "");
    const suffix = getSafeSuggestionSuffix(context.input, command, { source: "ai" });
    if (!suffix) {
      logAiSuggestionDebug(context, "frontend_reject", {
        reason: "unsafe_or_empty_ai_command",
        responseTimeMs: response.responseTimeMs,
      });
      return {
        suggestions: [],
        aiAttempt: {
          attempted: true,
          success: false,
          fallback: true,
          status: "fallback",
          message: "unsafe_or_empty_ai_command",
          responseTimeMs: response.responseTimeMs,
          inputTokens: response.inputTokens ?? undefined,
          outputTokens: response.outputTokens ?? undefined,
          totalTokens: response.totalTokens ?? undefined,
        },
      };
    }
    logAiSuggestionDebug(context, "frontend_accept", {
      responseTimeMs: response.responseTimeMs,
      suffixChars: suffix.length,
    });
    return {
      suggestions: [{
        id: `ai:${Date.now()}`,
        command,
        suffix,
        source: "ai",
        score: 120,
      }],
      aiAttempt: {
        attempted: true,
        success: true,
        fallback: false,
        status: "operational",
        message: "ok",
        responseTimeMs: response.responseTimeMs,
        inputTokens: response.inputTokens ?? undefined,
        outputTokens: response.outputTokens ?? undefined,
        totalTokens: response.totalTokens ?? undefined,
      },
    };
  } catch (error) {
    logAiSuggestionDebug(context, "request_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      suggestions: [],
      aiAttempt: {
        attempted: true,
        success: false,
        fallback: true,
        status: "fallback",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function mergeTerminalInputSuggestionUsage(
  current: TerminalInputSuggestionUsageStats | undefined,
  event: TerminalInputSuggestionAiAttempt | { accepted: true }
): TerminalInputSuggestionUsageStats {
  const stats = { ...DEFAULT_TERMINAL_INPUT_SUGGESTION_USAGE, ...(current ?? {}) };
  const now = Date.now();
  if ("accepted" in event) {
    return {
      ...stats,
      acceptedCount: stats.acceptedCount + 1,
      lastAcceptedAt: now,
    };
  }

  if (!event.attempted) return stats;
  const responseTimeMs = event.responseTimeMs ?? 0;
  return {
    ...stats,
    requestCount: stats.requestCount + 1,
    successCount: stats.successCount + (event.success ? 1 : 0),
    failureCount: stats.failureCount + (event.success ? 0 : 1),
    fallbackCount: stats.fallbackCount + (event.fallback ? 1 : 0),
    totalResponseTimeMs: stats.totalResponseTimeMs + Math.max(0, responseTimeMs),
    totalInputTokens: stats.totalInputTokens + Math.max(0, event.inputTokens ?? 0),
    totalOutputTokens: stats.totalOutputTokens + Math.max(0, event.outputTokens ?? 0),
    totalTokens: stats.totalTokens + Math.max(0, event.totalTokens ?? 0),
    lastStatus: event.status,
    lastMessage: event.message,
    lastResponseTimeMs: event.responseTimeMs ?? null,
    lastUsedAt: now,
  };
}

export async function getTerminalInputSuggestionResult(
  context: TerminalInputSuggestionContext,
  options: TerminalInputSuggestionOptions = {}
): Promise<TerminalInputSuggestionResult> {
  const localSuggestions = () => getLocalTerminalInputSuggestions(context, options);
  if (isUsableAiConfig(context.aiConfig) || context.provider === "ai") {
    const aiResult = await getTerminalInputSuggestionAiResult(context);
    if (aiResult.suggestions.length > 0) return aiResult;
    return {
      suggestions: localSuggestions(),
      aiAttempt: aiResult.aiAttempt,
    };
  }
  return { suggestions: localSuggestions() };
}

export async function getTerminalInputSuggestions(
  context: TerminalInputSuggestionContext,
  options: TerminalInputSuggestionOptions = {}
): Promise<TerminalInputSuggestion[]> {
  const result = await getTerminalInputSuggestionResult(context, options);
  return result.suggestions;
}
