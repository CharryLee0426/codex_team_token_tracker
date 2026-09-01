import fs from "node:fs";
import path from "node:path";
import { isCodexAuthProvider, type ParsedSession, type UsageEvent } from "@codex-tracker/shared";
import type { SessionRoot, SourceContext, SourceDefinition, SourceFile, ParseOptions, UserHome } from "./types";
import { isDir, listDirs, makeRoot, projectNameOf, readJsonFile, recentSubdirs } from "./util";

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
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
  time?: { created?: number; completed?: number };
}

interface OcSession {
  id?: string;
  projectID?: string;
  directory?: string;
  title?: string;
  time?: { created?: number; updated?: number };
}

const sessionCache = new Map<string, { at: number; info: OcSession | null }>();
const authCache = new Map<string, { mtime: number; oauth: boolean }>();

/** Find storage/session/<projectID>/<sessionID>.json (or the older storage/session/info/<sessionID>.json). */
function findSessionInfo(storage: string, sessionID: string): OcSession | null {
  const key = `${storage}|${sessionID}`;
  const cached = sessionCache.get(key);
  if (cached && (cached.info || Date.now() - cached.at < 60_000)) return cached.info;
  let info: OcSession | null = null;
  const sessionDir = path.join(storage, "session");
  const direct = path.join(sessionDir, "info", `${sessionID}.json`);
  if (fs.existsSync(direct)) info = readJsonFile<OcSession>(direct);
  if (!info) {
    for (const project of listDirs(sessionDir)) {
      const p = path.join(sessionDir, project, `${sessionID}.json`);
      if (fs.existsSync(p)) {
        info = readJsonFile<OcSession>(p);
        break;
      }
    }
  }
  sessionCache.set(key, { at: Date.now(), info });
  return info;
}

/** Whether OpenCode's "openai" provider is configured through ChatGPT OAuth (<data>/auth.json). */
function openaiIsOAuth(dataDir: string): boolean {
  const file = path.join(dataDir, "auth.json");
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return false;
  }
  const cached = authCache.get(file);
  if (cached && cached.mtime === mtime) return cached.oauth;
  const json = readJsonFile<Record<string, { type?: string }>>(file);
  const oauth = !!json && Object.entries(json).some(([k, v]) => /openai|codex|chatgpt/i.test(k) && v?.type === "oauth");
  authCache.set(file, { mtime, oauth });
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
      return null;
    }
    if (!m || m.role !== "assistant" || !m.tokens || typeof m.sessionID !== "string") return null;
    const provider = typeof m.providerID === "string" ? m.providerID : null;
    const storage = storageOf(file.path);
    const dataDir = storage ? path.dirname(storage) : null;
    const codexAuth = isCodexAuthProvider(provider) || (provider === "openai" && !!dataDir && openaiIsOAuth(dataDir));
    if (!opts.includeAllProviders && !codexAuth) return null;
    const t = m.tokens;
    const cached = t.cache?.read ?? 0;
    const cacheWrite = t.cache?.write ?? 0;
    const input = (t.input ?? 0) + cached + cacheWrite;
    const output = t.output ?? 0;
    const ts = m.time?.completed ?? m.time?.created ?? 0;
    const model = m.modelID || "unknown";
    const ev: UsageEvent = {
      ts,
      model,
      agent: file.root.agent,
      provider,
      usage: { input, cached, cacheWrite, output, reasoning: t.reasoning ?? 0, total: input + output, requests: 1 },
    };
    const info = storage ? findSessionInfo(storage, m.sessionID) : null;
    const cwd = info?.directory ?? null;
    return {
      sessionId: m.sessionID,
      agent: file.root.agent,
      provider,
      startedAt: info?.time?.created ?? ts,
      lastActivityAt: ts,
      cwd,
      projectName: projectNameOf(cwd) ?? info?.title ?? null,
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
