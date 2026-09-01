import os from "node:os";
import path from "node:path";
import { isCodexAuthProvider, type ParsedSession, type UsageEvent } from "@codex-tracker/shared";
import type { SessionRoot, SourceContext, SourceDefinition, SourceFile, ParseOptions } from "./types";
import { genericSource } from "./generic";
import { isDir, isFile, makeRoot, recentSubdirs } from "./util";

/** Hermes agent home (`$HERMES_HOME`, default ~/.hermes). */
export function hermesHome(): string {
  return process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
}

/** `<home>/<rel…>`, honoring an env override only for the machine's own home directory. */
function underHome(h: { home: string }, envVar: string | undefined, ...rel: string[]): string {
  if (envVar && h.home === os.homedir()) return envVar;
  return path.join(h.home, ...rel);
}


const INPUT_COLS = ["input_tokens", "prompt_tokens", "tokens_in", "input"];
const OUTPUT_COLS = ["output_tokens", "completion_tokens", "tokens_out", "output"];
const CACHED_COLS = ["cache_read_tokens", "cached_tokens", "cache_read_input_tokens", "cached_input_tokens", "cache_read"];
const MODEL_COLS = ["model", "model_id", "model_name"];
const TS_COLS = ["created_at", "timestamp", "ts", "time", "updated_at"];
const SESSION_COLS = ["session_id", "conversation_id", "thread_id", "chat_id"];
const PROVIDER_COLS = ["provider", "provider_id", "api_provider"];

function pick(cols: string[], candidates: string[]): string | null {
  for (const c of candidates) if (cols.includes(c)) return c;
  return null;
}

function toMs(v: unknown): number | null {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && v.trim() !== "") return n < 1e12 ? n * 1000 : n;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function emptyCumulative() {
  return { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0, requests: 0 };
}

/**
 * Best-effort reader for a Hermes SQLite state DB (`~/.hermes/state.db`): introspects tables for token columns.
 * Uses the runtime's built-in `node:sqlite` when available; silently returns null otherwise.
 */
export function parseSqliteUsage(dbPath: string, agent: string, opts: ParseOptions): ParsedSession[] | null {
  let sqlite: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sqlite = require("node:sqlite");
  } catch {
    return null;
  }
  let db: any;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
  const sessions = new Map<string, ParsedSession>();
  try {
    const tables: Array<{ name: string }> = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    for (const { name } of tables) {
      if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
      const cols: string[] = db.prepare(`PRAGMA table_info(${name})`).all().map((c: any) => String(c.name).toLowerCase());
      const inCol = pick(cols, INPUT_COLS);
      const outCol = pick(cols, OUTPUT_COLS);
      if (!inCol || !outCol) continue;
      const modelCol = pick(cols, MODEL_COLS);
      const tsCol = pick(cols, TS_COLS);
      const sessCol = pick(cols, SESSION_COLS);
      const provCol = pick(cols, PROVIDER_COLS);
      const cachedCol = pick(cols, CACHED_COLS);
      const rows: any[] = db.prepare(`SELECT * FROM ${name} LIMIT 200000`).all();
      for (const r of rows) {
        const input = Number(r[inCol]) || 0;
        const output = Number(r[outCol]) || 0;
        if (input <= 0 && output <= 0) continue;
        const provider = provCol ? (r[provCol] == null ? null : String(r[provCol])) : null;
        if (!opts.includeAllProviders && !isCodexAuthProvider(provider)) continue;
        const cached = cachedCol ? Number(r[cachedCol]) || 0 : 0;
        const ts = (tsCol ? toMs(r[tsCol]) : null) ?? 0;
        const model = modelCol && r[modelCol] ? String(r[modelCol]) : "unknown";
        const sid = sessCol && r[sessCol] != null ? String(r[sessCol]) : `${agent}-db`;
        const ev: UsageEvent = {
          ts,
          model,
          agent,
          provider,
          usage: { input: input + cached, cached, cacheWrite: 0, output, reasoning: 0, total: input + cached + output, requests: 1 },
        };
        let s = sessions.get(sid);
        if (!s) {
          s = {
            sessionId: sid, agent, provider, startedAt: ts, lastActivityAt: ts, cwd: null, projectName: null, originator: agent, source: `${agent}-db`,
            cliVersion: null, timezone: null, model, events: [], cumulative: emptyCumulative(), contextWindow: null, rateLimits: null, lineCount: 0,
          };
          sessions.set(sid, s);
        }
        s.events.push(ev);
        s.lineCount++;
        s.model = model;
        if (ts && (s.startedAt === 0 || ts < s.startedAt)) s.startedAt = ts;
        if (ts > s.lastActivityAt) s.lastActivityAt = ts;
        const c = s.cumulative;
        c.input += ev.usage.input; c.cached += ev.usage.cached; c.output += ev.usage.output; c.total += ev.usage.total; c.requests += 1;
      }
    }
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  for (const s of sessions.values()) s.events.sort((a, b) => a.ts - b.ts);
  return [...sessions.values()];
}

/** Hermes agent (NousResearch/hermes-agent): ~/.hermes/sessions/**.json|jsonl (generic parser) + optional ~/.hermes/state.db. */
export const hermesSource: SourceDefinition = {
  id: "hermes",
  label: "Hermes agent",
  format: "generic",
  discover(ctx: SourceContext): SessionRoot[] {
    const roots: SessionRoot[] = [];
    for (const h of ctx.homes) {
      const home = underHome(h, process.env.HERMES_HOME, ".hermes");
      const sessions = path.join(home, "sessions");
      if (isDir(sessions)) roots.push(makeRoot(sessions, "hermes", "hermes", "generic", "flat", h.origin, [".jsonl", ".json"], 4));
      if (isFile(path.join(home, "state.db"))) roots.push(makeRoot(home, "hermes", "hermes", "generic", "flat", h.origin, ["state.db"], 0, false));
    }
    return roots;
  },
  hotDirs: (root) => [root.dir, ...(root.exts.includes("state.db") ? [] : recentSubdirs(root.dir))],
  watchRecursively: (root) => !root.exts.includes("state.db"),
  parse(file: SourceFile, opts: ParseOptions) {
    if (file.path.endsWith(".db")) {
      const list = parseSqliteUsage(file.path, file.root.agent, opts);
      if (!list || !list.length) return null;
      if (list.length === 1) return list[0];
      // several sessions in one DB file → one merged pseudo-session keyed by the DB path
      const events = list.flatMap((s) => s.events).sort((a, b) => a.ts - b.ts);
      const cumulative = emptyCumulative();
      for (const e of events) {
        cumulative.input += e.usage.input; cumulative.cached += e.usage.cached; cumulative.output += e.usage.output;
        cumulative.total += e.usage.total; cumulative.requests += 1;
      }
      return { ...list[0], sessionId: `${file.root.agent}-db`, events, cumulative, startedAt: Math.min(...list.map((s) => s.startedAt)), lastActivityAt: Math.max(...list.map((s) => s.lastActivityAt)) };
    }
    return genericSource.parse(file, opts);
  },
  extraRoot: (dir, agent) => genericSource.extraRoot(dir, agent),
};
