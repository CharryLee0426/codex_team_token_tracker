import fs from "node:fs";
import path from "node:path";
import { isCanonicalTokenUsage, isCodexAuthProvider, type ParsedSession, type TokenUsage, type UsageEvent } from "@codex-tracker/shared";
import type { SessionRoot, SourceContext, SourceDefinition, SourceFile, ParseOptions, UserHome } from "./types";
import { isDir, listDirs, makeRoot, projectNameOf, readJsonFile, readUtf8FileLimited, recentSubdirs } from "./util";

/** OpenCode data directories for a user home. */
export function opencodeDataDirs(h: UserHome, env: NodeJS.ProcessEnv): string[] {
  if (h.layout === "win32") {
    const local = h.origin === "local" && env.LOCALAPPDATA ? env.LOCALAPPDATA : path.join(h.home, "AppData", "Local");
    const roaming = h.origin === "local" && env.APPDATA ? env.APPDATA : path.join(h.home, "AppData", "Roaming");
    return [path.join(local, "opencode"), path.join(roaming, "opencode")];
  }
  const xdg = h.origin === "local" && env.XDG_DATA_HOME ? env.XDG_DATA_HOME : path.join(h.home, ".local", "share");
  return [path.join(xdg, "opencode")];
}

interface OcMessage {
  id?: string;
  sessionID?: string;
  role?: string;
  modelID?: string;
  providerID?: string;
  tokens?: { total?: number; input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
  time?: { created?: number; completed?: number };
}

function tokenCount(value: unknown): number | null {
  if (value === undefined) return 0;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function tokenUsage(tokens: OcMessage["tokens"]): TokenUsage | null {
  if (!tokens) return null;
  const freshInput = tokenCount(tokens.input);
  const visibleOutput = tokenCount(tokens.output);
  const cached = tokenCount(tokens.cache?.read);
  const cacheWrite = tokenCount(tokens.cache?.write);
  const reasoning = tokenCount(tokens.reasoning);
  const reportedTotal = tokenCount(tokens.total);
  if (
    freshInput === null
    || visibleOutput === null
    || cached === null
    || cacheWrite === null
    || reasoning === null
    || reportedTotal === null
  ) return null;
  const input = freshInput + cached + cacheWrite;
  // OpenCode stores visible output separately from reasoning; the tracker's canonical output
  // bucket includes reasoning, matching Codex TokenUsage and the provider-reported total.
  const output = visibleOutput + reasoning;
  const recombinedTotal = input + output;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || !Number.isSafeInteger(recombinedTotal)) return null;
  const total = tokens.total === undefined || reportedTotal < recombinedTotal ? recombinedTotal : reportedTotal;
  const usage = { input, cached, cacheWrite, output, reasoning, total, requests: 1 };
  return isCanonicalTokenUsage(usage) ? usage : null;
}

interface OcSession {
  id?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
}

const sessionCache = new Map<string, { at: number; info: OcSession | null }>();
const authCache = new Map<string, { version: string; oauth: boolean }>();

/** Find storage/session/<projectID>/<sessionID>.json (or the older storage/session/info/<sessionID>.json). */
function findSessionInfo(storage: string, sessionID: string): OcSession | null {
  const key = `${storage}|${sessionID}`;
  const cached = sessionCache.get(key);
  if (cached && (cached.info || Date.now() - cached.at < 60_000)) return cached.info;
  let info: OcSession | null = null;
  const sessionDir = path.join(storage, "session");
  const direct = path.join(sessionDir, "info", `${sessionID}.json`);
  if (fs.existsSync(direct)) info = projectSessionInfo(readJsonFile<Record<string, unknown>>(direct));
  if (!info) {
    for (const project of listDirs(sessionDir)) {
      const p = path.join(sessionDir, project, `${sessionID}.json`);
      if (fs.existsSync(p)) {
        info = projectSessionInfo(readJsonFile<Record<string, unknown>>(p));
        break;
      }
    }
  }
  sessionCache.set(key, { at: Date.now(), info });
  return info;
}

/** Retain only non-content metadata; OpenCode session titles can contain the first user prompt. */
function projectSessionInfo(value: Record<string, unknown> | null): OcSession | null {
  if (!value) return null;
  const rawTime = value.time;
  const time = rawTime && typeof rawTime === "object"
    ? rawTime as Record<string, unknown>
    : null;
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.directory === "string" ? { directory: value.directory } : {}),
    ...(time
      ? {
          time: {
            ...(typeof time.created === "number" && Number.isFinite(time.created) ? { created: time.created } : {}),
            ...(typeof time.updated === "number" && Number.isFinite(time.updated) ? { updated: time.updated } : {}),
          },
        }
      : {}),
  };
}

/** Whether OpenCode's "openai" provider is configured through ChatGPT OAuth (<data>/auth.json). */
function openaiIsOAuth(dataDir: string): boolean {
  const file = path.join(dataDir, "auth.json");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
  const version = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached = authCache.get(file);
  if (cached && cached.version === version) return cached.oauth;
  let json: Record<string, { type?: string }>;
  try {
    json = JSON.parse(readUtf8FileLimited(file)) as Record<string, { type?: string }>;
  } catch {
    // A concurrently rewritten auth sidecar is ambiguous. Let SessionStore retain and retry the
    // previous snapshot instead of temporarily reclassifying API-key traffic as OAuth (or vice versa).
    throw new Error("Invalid OpenCode auth metadata");
  }
  // OpenCode resolves credentials by the message's exact provider id. OAuth configured for a
  // different provider (for example `openai-codex`) must never authorize `providerID: openai` rows.
  const oauth = json.openai?.type === "oauth";
  authCache.set(file, { version, oauth });
  return oauth;
}

function storageOf(file: string): string | null {
  const parts = file.split(path.sep);
  const idx = parts.lastIndexOf("storage");
  return idx >= 0 ? parts.slice(0, idx + 1).join(path.sep) : null;
}

/** OpenCode (sst/opencode): <data>/storage/message/<sessionID>/<messageID>.json, one file per message. */
export const opencodeSource: SourceDefinition = {
  id: "opencode",
  label: "OpenCode",
  format: "opencode",
  multiFileSessions: true,
  discover(ctx: SourceContext): SessionRoot[] {
    const roots: SessionRoot[] = [];
    for (const h of ctx.homes) {
      for (const data of opencodeDataDirs(h, ctx.env)) {
        const storage = path.join(data, "storage");
        if (isDir(storage)) roots.push(makeRoot(storage, "opencode", "opencode", "opencode", "flat", h.origin, [".json"], 5));
      }
    }
    return roots;
  },
  hotDirs(root: SessionRoot): string[] {
    const out = [root.dir];
    for (const base of [path.join(root.dir, "message"), path.join(root.dir, "session", "message")]) out.push(...recentSubdirs(base));
    return out;
  },
  watchRecursively: () => true,
  parse(file: SourceFile, opts: ParseOptions): ParsedSession | null {
    let m: OcMessage;
    try {
      m = JSON.parse(file.text);
    } catch {
      throw new Error(`Invalid OpenCode JSON snapshot: ${path.basename(file.path)}`);
    }
    if (!m || m.role !== "assistant" || !m.tokens || typeof m.sessionID !== "string") return null;
    const provider = typeof m.providerID === "string" ? m.providerID : null;
    const storage = storageOf(file.path);
    const dataDir = storage ? path.dirname(storage) : null;
    const codexAuth = isCodexAuthProvider(provider) || (provider === "openai" && !!dataDir && openaiIsOAuth(dataDir));
    if (!opts.includeAllProviders && !codexAuth) return null;
    const usage = tokenUsage(m.tokens);
    if (!usage) return null;
    const ts = m.time?.completed ?? m.time?.created ?? 0;
    const model = m.modelID || "unknown";
    const eventProvider = codexAuth ? "openai-codex" : provider;
    const ev: UsageEvent = {
      ts,
      model,
      agent: file.root.agent,
      provider: eventProvider,
      usage,
    };
    const info = storage ? findSessionInfo(storage, m.sessionID) : null;
    const cwd = info?.directory ?? null;
    return {
      sessionId: m.sessionID,
      agent: file.root.agent,
      provider: eventProvider,
      startedAt: info?.time?.created ?? ts,
      lastActivityAt: ts,
      cwd,
      // OpenCode titles can be generated from the first user prompt; never expose them as project metadata.
      projectName: projectNameOf(cwd),
      originator: "opencode",
      source: "opencode",
      cliVersion: null,
      timezone: null,
      model,
      events: [ev],
      cumulative: { ...ev.usage },
      contextWindow: null,
      rateLimits: null,
      lineCount: 1,
    };
  },
  extraRoot: (dir, agent) => makeRoot(dir, "opencode", agent, "opencode", "extra", "extra", [".json"], 5),
};
