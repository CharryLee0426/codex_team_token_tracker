import path from "node:path";
import { isCanonicalTokenUsage, tryAddUsageInPlace, type ParsedSession, type TokenUsage, type UsageEvent } from "@codex-tracker/shared";
import type { SessionRoot, SourceContext, SourceDefinition, SourceFile, ParseOptions, UserHome } from "./types";
import {
  readClineJson,
  type StreamedCurrentMessage,
  type StreamedLegacyMessage,
} from "./cline-json-stream";
import { isDir, makeRoot, readJsonFile, recentSubdirs } from "./util";

/** VS Code-family apps whose globalStorage may hold Cline-style extensions. */
const APPS = ["Code", "Code - Insiders", "Cursor", "Windsurf", "VSCodium", "Trae"];

/** globalStorage roots for a user home (desktop apps + VS Code Remote server data on Linux/WSL). */
export function globalStorageDirs(h: UserHome, env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  if (h.layout === "darwin") for (const app of APPS) out.push(path.join(h.home, "Library", "Application Support", app, "User", "globalStorage"));
  else if (h.layout === "win32") {
    const roaming = h.origin === "local" && env.APPDATA ? env.APPDATA : path.join(h.home, "AppData", "Roaming");
    for (const app of APPS) out.push(path.join(roaming, app, "User", "globalStorage"));
  } else {
    const cfg = h.origin === "local" && env.XDG_CONFIG_HOME ? env.XDG_CONFIG_HOME : path.join(h.home, ".config");
    for (const app of APPS) out.push(path.join(cfg, app, "User", "globalStorage"));
  }
  if (h.layout !== "win32") {
    for (const server of [".vscode-server", ".vscode-server-insiders", ".cursor-server", ".windsurf-server"]) {
      out.push(path.join(h.home, server, "data", "User", "globalStorage"));
    }
  }
  return out;
}

type UiMessage = StreamedLegacyMessage;
interface ApiReq {
  tokensIn?: number;
  tokensOut?: number;
  cacheWrites?: number;
  cacheReads?: number;
  cost?: number;
}
interface ModelUsage {
  ts?: number;
  model_id?: string;
  model_provider_id?: string;
  mode?: string;
}
interface TaskMetadata {
  model_usage?: ModelUsage[];
  cwd?: string;
  workspace?: string;
  cwd_on_task_initialization?: string;
}

interface CurrentEnvelope {
  version?: number;
  updated_at?: string;
  sessionId?: string;
  messages?: StreamedCurrentMessage[];
}

interface ClineAccumulator {
  events: UsageEvent[];
  cumulative: TokenUsage;
  startedAt: number | null;
  lastActivityAt: number;
  model: string;
  provider: string | null;
}

const CODEX_OAUTH_PROVIDER = "openai-codex";
const CODEX_CLI_PROVIDER = "openai-codex-cli";
const MAX_ACCOUNTING_METADATA_CHARS = 4 * 1024;

function configuredPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function clineDataDir(h: UserHome, env: NodeJS.ProcessEnv): string {
  if (h.origin === "local") {
    const dataDir = configuredPath(env.CLINE_DATA_DIR);
    if (dataDir) return dataDir;
    const clineDir = configuredPath(env.CLINE_DIR);
    if (clineDir) return path.join(clineDir, "data");
  }
  return path.join(h.home, ".cline", "data");
}

function clineSessionsDir(h: UserHome, env: NodeJS.ProcessEnv): string {
  if (h.origin === "local") {
    const sessionDir = configuredPath(env.CLINE_SESSION_DATA_DIR);
    if (sessionDir) return sessionDir;
  }
  return path.join(clineDataDir(h, env), "sessions");
}

function shouldIncludeProvider(provider: string | null, includeAllProviders: boolean): boolean {
  if (provider === CODEX_CLI_PROVIDER) return false;
  return includeAllProviders || provider === CODEX_OAUTH_PROVIDER;
}

function tokenCount(value: number | undefined): number | null {
  if (value === undefined) return 0;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function currentTokenUsage(metrics: NonNullable<StreamedCurrentMessage["metrics"]>): TokenUsage | null {
  const input = tokenCount(metrics.inputTokens);
  const output = tokenCount(metrics.outputTokens);
  const cached = tokenCount(metrics.cacheReadTokens);
  const cacheWrite = tokenCount(metrics.cacheWriteTokens);
  if (input === null || output === null || cached === null || cacheWrite === null) return null;
  const total = input + output;
  if (!Number.isSafeInteger(total)) return null;
  const usage = { input, cached, cacheWrite, output, reasoning: 0, total, requests: 1 };
  return isCanonicalTokenUsage(usage) ? usage : null;
}

function legacyTokenUsage(request: ApiReq): TokenUsage | null {
  const freshInput = tokenCount(request.tokensIn);
  const output = tokenCount(request.tokensOut);
  const cached = tokenCount(request.cacheReads);
  const cacheWrite = tokenCount(request.cacheWrites);
  if (freshInput === null || output === null || cached === null || cacheWrite === null) return null;
  const input = freshInput + cached + cacheWrite;
  const total = input + output;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(total)) return null;
  const usage = { input, cached, cacheWrite, output, reasoning: 0, total, requests: 1 };
  return isCanonicalTokenUsage(usage) ? usage : null;
}

function emptyUsage(): TokenUsage {
  return { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0, requests: 0 };
}

function accountingString(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_ACCOUNTING_METADATA_CHARS
    ? value
    : null;
}

function currentSessionId(filePath: string, sessionId: string | undefined): string {
  const bounded = accountingString(sessionId);
  if (bounded?.trim()) return bounded;
  return path.basename(filePath).replace(/\.messages\.json$/, "");
}

function parseUpdatedAt(value: string | undefined): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function createAccumulator(): ClineAccumulator {
  return {
    events: [],
    cumulative: emptyUsage(),
    startedAt: null,
    lastActivityAt: 0,
    model: "unknown",
    provider: null,
  };
}

function trackTimestamp(state: ClineAccumulator, value: unknown): number | null {
  const ts = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (ts !== null) {
    if (state.startedAt === null || ts < state.startedAt) state.startedAt = ts;
    if (ts > state.lastActivityAt) state.lastActivityAt = ts;
  }
  return ts;
}

function accumulateCurrentMessage(
  state: ClineAccumulator,
  message: StreamedCurrentMessage,
  file: SourceFile,
  opts: ParseOptions,
): void {
  const rawTs = typeof message.ts === "number" && Number.isFinite(message.ts) ? message.ts : null;
  if (message.role !== "assistant" || !message.metrics || typeof message.metrics !== "object") {
    trackTimestamp(state, rawTs);
    return;
  }
  if (typeof message.metrics.inputTokens !== "number" && typeof message.metrics.outputTokens !== "number") return;

  const messageProvider = accountingString(message.modelInfo?.provider);
  if (!shouldIncludeProvider(messageProvider, opts.includeAllProviders)) return;
  const messageModel = accountingString(message.modelInfo?.id) || "unknown";
  const usage = currentTokenUsage(message.metrics);
  if (!usage) return;
  if (!tryAddUsageInPlace(state.cumulative, usage)) return;
  const ts = trackTimestamp(state, rawTs);
  state.model = messageModel;
  state.provider = messageProvider;
  state.events.push({
    ts: ts ?? state.lastActivityAt,
    model: messageModel,
    agent: file.root.agent,
    provider: messageProvider ?? "unknown",
    usage,
  });
}

function finishCurrentSession(
  state: ClineAccumulator,
  envelope: Pick<CurrentEnvelope, "updated_at" | "sessionId">,
  lineCount: number,
  file: SourceFile,
  id: string,
): ParsedSession {
  const updatedAt = parseUpdatedAt(envelope.updated_at);
  if (!state.lastActivityAt) state.lastActivityAt = updatedAt;
  if (state.startedAt === null) state.startedAt = state.lastActivityAt;

  return {
    sessionId: currentSessionId(file.path, envelope.sessionId),
    agent: file.root.agent,
    provider: state.provider,
    startedAt: state.startedAt,
    lastActivityAt: state.lastActivityAt,
    cwd: null,
    projectName: null,
    originator: id,
    source: id,
    cliVersion: null,
    timezone: null,
    model: state.model,
    events: state.events,
    cumulative: { ...state.cumulative },
    contextWindow: null,
    rateLimits: null,
    lineCount,
  };
}

function parseCurrentEnvelope(
  envelope: CurrentEnvelope,
  file: SourceFile,
  opts: ParseOptions,
  id: string,
): ParsedSession | null {
  if (envelope.version !== 1 || !Array.isArray(envelope.messages)) return null;
  const state = createAccumulator();
  for (const message of envelope.messages) {
    if (message && typeof message === "object") accumulateCurrentMessage(state, message, file, opts);
  }
  return finishCurrentSession(state, envelope, envelope.messages.length, file, id);
}

function modelFor(usage: ModelUsage[], ts: number): ModelUsage | null {
  if (!usage.length) return null;
  let best: ModelUsage | null = null;
  for (const u of usage) {
    if (typeof u.ts === "number" && u.ts <= ts && (!best || (u.ts ?? 0) >= (best.ts ?? 0))) best = u;
  }
  return best ?? usage[usage.length - 1];
}

function accumulateLegacyMessage(
  state: ClineAccumulator,
  msg: UiMessage,
  usageList: ModelUsage[],
  file: SourceFile,
  opts: ParseOptions,
): void {
  const rawTs = typeof msg.ts === "number" && Number.isFinite(msg.ts) ? msg.ts : null;
  if (msg.type !== "say" || msg.say !== "api_req_started" || typeof msg.text !== "string") {
    trackTimestamp(state, rawTs);
    return;
  }
  let req: ApiReq;
  try {
    req = JSON.parse(msg.text);
  } catch {
    return;
  }
  if (typeof req.tokensIn !== "number" && typeof req.tokensOut !== "number") return;
  const mu = modelFor(usageList, rawTs ?? Number.MAX_SAFE_INTEGER);
  const mProvider = accountingString(mu?.model_provider_id);
  const modelId = accountingString(mu?.model_id);
  const mModel = modelId ?? state.model;
  if (!shouldIncludeProvider(mProvider, opts.includeAllProviders)) return;
  const usage = legacyTokenUsage(req);
  if (!usage) return;
  if (!tryAddUsageInPlace(state.cumulative, usage)) return;
  const ts = trackTimestamp(state, rawTs);
  if (modelId) state.model = modelId;
  if (mProvider) state.provider = mProvider;
  state.events.push({
    ts: ts ?? state.lastActivityAt,
    model: mModel,
    agent: file.root.agent,
    provider: mProvider ?? "unknown",
    usage,
  });
}

function finishLegacySession(
  state: ClineAccumulator,
  meta: TaskMetadata,
  lineCount: number,
  file: SourceFile,
  id: string,
): ParsedSession {
  const taskDir = path.dirname(file.path);
  const cwd = meta.cwd ?? meta.cwd_on_task_initialization ?? meta.workspace ?? null;
  return {
    sessionId: path.basename(taskDir),
    agent: file.root.agent,
    provider: state.provider,
    startedAt: state.startedAt ?? state.lastActivityAt,
    lastActivityAt: state.lastActivityAt,
    cwd,
    projectName: cwd ? cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null : null,
    originator: id,
    source: id,
    cliVersion: null,
    timezone: null,
    model: state.model,
    events: state.events,
    cumulative: { ...state.cumulative },
    contextWindow: null,
    rateLimits: null,
    lineCount,
  };
}

function parseClineJson(
  parsed: unknown,
  file: SourceFile,
  opts: ParseOptions,
  id: string,
): ParsedSession | null {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parseCurrentEnvelope(parsed as CurrentEnvelope, file, opts, id);
  }
  const messages = parsed as UiMessage[];
  if (!Array.isArray(messages)) return null;
  const taskDir = path.dirname(file.path);
  const meta = readJsonFile<TaskMetadata>(path.join(taskDir, "task_metadata.json")) ?? {};
  const usageList = Array.isArray(meta.model_usage) ? meta.model_usage : [];
  const state = createAccumulator();
  for (const msg of messages) {
    if (msg && typeof msg === "object") accumulateLegacyMessage(state, msg, usageList, file, opts);
  }
  return finishLegacySession(state, meta, messages.length, file, id);
}

async function parseClinePath(
  file: Omit<SourceFile, "text">,
  opts: ParseOptions,
  id: string,
): Promise<ParsedSession | null> {
  const sourceFile: SourceFile = { ...file, text: "" };
  let currentState = createAccumulator();
  const legacyState = createAccumulator();
  let legacyMeta: TaskMetadata = {};
  let legacyUsage: ModelUsage[] = [];

  try {
    const streamed = await readClineJson(file.path, {
      beginCurrentMessages() {
        currentState = createAccumulator();
      },
      currentMessage(message) {
        accumulateCurrentMessage(currentState, message, sourceFile, opts);
      },
      beginLegacyMessages() {
        const taskDir = path.dirname(file.path);
        legacyMeta = readJsonFile<TaskMetadata>(path.join(taskDir, "task_metadata.json")) ?? {};
        legacyUsage = Array.isArray(legacyMeta.model_usage) ? legacyMeta.model_usage : [];
      },
      legacyMessage(message) {
        accumulateLegacyMessage(legacyState, message, legacyUsage, sourceFile, opts);
      },
    });

    if (streamed.kind === "current") {
      if (streamed.version !== 1 || !streamed.hasMessages) return null;
      return finishCurrentSession(
        currentState,
        { updated_at: streamed.updatedAt, sessionId: streamed.sessionId },
        streamed.lineCount,
        sourceFile,
        id,
      );
    }
    if (streamed.kind === "legacy") {
      return finishLegacySession(legacyState, legacyMeta, streamed.lineCount, sourceFile, id);
    }
    return null;
  } catch {
    throw new Error(`Invalid Cline JSON snapshot: ${path.basename(file.path)}`);
  }
}

/** Factory: the same layout is used by Cline, Roo Code and Kilo Code under different extension ids. */
export function clineFamily(id: string, label: string, extensionId: string): SourceDefinition {
  const source: SourceDefinition = {
    id,
    label,
    format: "cline",
    discover(ctx: SourceContext): SessionRoot[] {
      const roots: SessionRoot[] = [];
      for (const h of ctx.homes) {
        if (id === "cline") {
          const sessions = clineSessionsDir(h, ctx.env);
          if (isDir(sessions)) roots.push(makeRoot(sessions, id, id, "cline", "flat", h.origin, [".messages.json"], 2));
          const tasks = path.join(clineDataDir(h, ctx.env), "tasks");
          if (isDir(tasks)) roots.push(makeRoot(tasks, id, id, "cline", "flat", h.origin, ["ui_messages.json"], 2));
        }
        for (const gs of globalStorageDirs(h, ctx.env)) {
          const tasks = path.join(gs, extensionId, "tasks");
          if (isDir(tasks)) roots.push(makeRoot(tasks, id, id, "cline", "flat", h.origin, ["ui_messages.json"], 2));
        }
      }
      return roots;
    },
    hotDirs: (root) => [root.dir, ...recentSubdirs(root.dir)],
    watchRecursively: () => true,
    async parsePath(file, opts): Promise<ParsedSession | null> {
      return parseClinePath(file, opts, id);
    },
    parse(file: SourceFile, opts: ParseOptions): ParsedSession | null {
      let parsed: unknown;
      try {
        parsed = JSON.parse(file.text);
      } catch {
        throw new Error(`Invalid Cline JSON snapshot: ${path.basename(file.path)}`);
      }
      return parseClineJson(parsed, file, opts, id);
    },
    extraRoot: (dir, agent) => makeRoot(dir, id, agent, "cline", "extra", "extra", ["ui_messages.json"], 2),
  };
  return source;
}

export const clineSource = clineFamily("cline", "Cline", "saoudrizwan.claude-dev");
export const rooSource = clineFamily("roo", "Roo Code", "rooveterinaryinc.roo-cline");
export const kiloSource = clineFamily("kilo", "Kilo Code", "kilocode.kilo-code");
