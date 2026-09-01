import path from "node:path";
import { isCodexAuthProvider, type ParsedSession, type UsageEvent } from "@codex-tracker/shared";
import type { SessionRoot, SourceContext, SourceDefinition, SourceFile, ParseOptions, UserHome } from "./types";
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

interface UiMessage {
  ts?: number;
  type?: string;
  say?: string;
  text?: string;
}
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

const CODEX_MODEL_RE = /^(gpt-5|codex|o3|o4-mini)/i;

function modelFor(usage: ModelUsage[], ts: number): ModelUsage | null {
  if (!usage.length) return null;
  let best: ModelUsage | null = null;
  for (const u of usage) {
    if (typeof u.ts === "number" && u.ts <= ts && (!best || (u.ts ?? 0) >= (best.ts ?? 0))) best = u;
  }
  return best ?? usage[usage.length - 1];
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
        for (const gs of globalStorageDirs(h, ctx.env)) {
          const tasks = path.join(gs, extensionId, "tasks");
          if (isDir(tasks)) roots.push(makeRoot(tasks, id, id, "cline", "flat", h.origin, ["ui_messages.json"], 2));
        }
      }
      return roots;
    },
    hotDirs: (root) => [root.dir, ...recentSubdirs(root.dir)],
    watchRecursively: () => true,
    parse(file: SourceFile, opts: ParseOptions): ParsedSession | null {
      let messages: UiMessage[];
      try {
        messages = JSON.parse(file.text);
      } catch {
        return null;
      }
      if (!Array.isArray(messages)) return null;
      const taskDir = path.dirname(file.path);
      const meta = readJsonFile<TaskMetadata>(path.join(taskDir, "task_metadata.json")) ?? {};
      const usageList = Array.isArray(meta.model_usage) ? meta.model_usage : [];
      const agent = file.root.agent;
      const events: UsageEvent[] = [];
      let startedAt: number | null = null;
      let lastActivityAt = 0;
      let model = "unknown";
      let provider: string | null = null;
      for (const msg of messages) {
        const ts = typeof msg.ts === "number" ? msg.ts : null;
        if (ts !== null) {
          if (startedAt === null || ts < startedAt) startedAt = ts;
          if (ts > lastActivityAt) lastActivityAt = ts;
        }
        if (msg.type !== "say" || msg.say !== "api_req_started" || typeof msg.text !== "string") continue;
        let req: ApiReq;
        try {
          req = JSON.parse(msg.text);
        } catch {
          continue;
        }
        if (typeof req.tokensIn !== "number" && typeof req.tokensOut !== "number") continue; // request still in flight
        const mu = modelFor(usageList, ts ?? Number.MAX_SAFE_INTEGER);
        const mProvider = mu?.model_provider_id ?? null;
        const mModel = mu?.model_id ?? model;
        if (mu?.model_id) model = mu.model_id;
        if (mProvider) provider = mProvider;
        const codexAuth = mProvider ? isCodexAuthProvider(mProvider) || /codex|chatgpt/i.test(mProvider) : CODEX_MODEL_RE.test(mModel);
        if (!opts.includeAllProviders && !codexAuth) continue;
        const cached = req.cacheReads ?? 0;
        const cacheWrite = req.cacheWrites ?? 0;
        const input = (req.tokensIn ?? 0) + cached + cacheWrite;
        const output = req.tokensOut ?? 0;
        events.push({
          ts: ts ?? lastActivityAt,
          model: mModel,
          agent,
          provider: mProvider ?? "unknown",
          usage: { input, cached, cacheWrite, output, reasoning: 0, total: input + output, requests: 1 },
        });
      }
      const cumulative = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0, requests: 0 };
      for (const e of events) {
        cumulative.input += e.usage.input; cumulative.cached += e.usage.cached; cumulative.cacheWrite += e.usage.cacheWrite;
        cumulative.output += e.usage.output; cumulative.total += e.usage.total; cumulative.requests += 1;
      }
      const cwd = meta.cwd ?? meta.cwd_on_task_initialization ?? meta.workspace ?? null;
      return {
        sessionId: path.basename(taskDir),
        agent,
        provider,
        startedAt: startedAt ?? lastActivityAt,
        lastActivityAt,
        cwd,
        projectName: cwd ? cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null : null,
        originator: id,
        source: id,
        cliVersion: null,
        timezone: null,
        model,
        events,
        cumulative,
        contextWindow: null,
        rateLimits: null,
        lineCount: messages.length,
      };
    },
    extraRoot: (dir, agent) => makeRoot(dir, id, agent, "cline", "extra", "extra", ["ui_messages.json"], 2),
  };
  return source;
}

export const clineSource = clineFamily("cline", "Cline", "saoudrizwan.claude-dev");
export const rooSource = clineFamily("roo", "Roo Code", "rooveterinaryinc.roo-cline");
export const kiloSource = clineFamily("kilo", "Kilo Code", "kilocode.kilo-code");
