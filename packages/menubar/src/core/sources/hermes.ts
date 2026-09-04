import os from "node:os";
import path from "node:path";
import { isCanonicalTokenUsage, isCodexAuthProvider, tryAddUsageInPlace, type ParsedSession, type TokenUsage, type UsageEvent } from "@codex-tracker/shared";
import type { SessionRoot, SourceContext, SourceDefinition, SourceFile, ParseOptions } from "./types";
import { genericSource } from "./generic";
import {
  openSqliteReadOnlyOrThrow,
  sqliteSessionId,
  sqliteRows,
  sqliteTableNamesOrThrow,
  type SqliteDatabase,
} from "./sqlite";
import { isDir, isFile, listDirs, makeRoot, recentSubdirs } from "./util";

/** Hermes agent home (`$HERMES_HOME`, default ~/.hermes). */
export function hermesHome(): string {
  return process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
}

const INPUT_COLS = ["input_tokens", "prompt_tokens", "tokens_in", "input"];
const OUTPUT_COLS = ["output_tokens", "completion_tokens", "tokens_out", "output"];
const CACHED_COLS = ["cache_read_tokens", "cached_tokens", "cache_read_input_tokens", "cached_input_tokens", "cache_read"];
const CACHE_WRITE_COLS = ["cache_write_tokens", "cache_write_input_tokens", "cache_creation_input_tokens", "cache_write"];
const REASONING_COLS = ["reasoning_tokens", "reasoning_output_tokens", "reasoning"];
const REQUEST_COLS = ["api_call_count", "request_count", "requests"];
const MODEL_COLS = ["model", "model_id", "model_name"];
const TS_COLS = ["created_at", "timestamp", "ts", "time", "updated_at"];
const SESSION_COLS = ["session_id", "conversation_id", "thread_id", "chat_id"];
const PROVIDER_COLS = ["billing_provider", "provider", "provider_id", "api_provider"];
const CANONICAL_USAGE_REQUIRED = ["session_id", "model", "billing_provider", "input_tokens", "output_tokens"];
const SESSION_AGGREGATE_COLS = [
  "id", "model", "billing_provider", "billing_mode", "api_call_count", "input_tokens", "output_tokens",
  "cache_read_tokens", "cache_write_tokens", "reasoning_tokens", "started_at", "ended_at", "last_activity_at", "cwd",
];

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

function tokenCount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function tableColumns(db: SqliteDatabase, table: string): string[] {
  if (!/^[A-Za-z0-9_]+$/.test(table)) return [];
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => String(column.name ?? "").toLowerCase());
}

function hasCanonicalUsageColumns(columns: string[]): boolean {
  return CANONICAL_USAGE_REQUIRED.every((column) => columns.includes(column));
}

function readSessionAggregates(
  db: SqliteDatabase,
  tableNames: Set<string>,
): Map<string, Record<string, unknown>> {
  if (!tableNames.has("sessions")) return new Map();
  const available = new Set(tableColumns(db, "sessions"));
  if (!available.has("id")) return new Map();
  const selected = SESSION_AGGREGATE_COLS.filter((column) => available.has(column));
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of sqliteRows(db, `SELECT ${selected.map((column) => `"${column}"`).join(", ")} FROM sessions`)) {
    if (row.id != null) byId.set(String(row.id), row);
  }
  return byId;
}

interface UsageTotals {
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
  reasoning: number;
  requests: number;
}

function usageTotals(row: Record<string, unknown>, columns: {
  input: string;
  output: string;
  cached?: string | null;
  cacheWrite?: string | null;
  reasoning?: string | null;
  requests?: string | null;
}): UsageTotals | null {
  const input = tokenCount(row[columns.input]);
  const output = tokenCount(row[columns.output]);
  const cached = columns.cached ? tokenCount(row[columns.cached]) : 0;
  const cacheWrite = columns.cacheWrite ? tokenCount(row[columns.cacheWrite]) : 0;
  const reasoning = columns.reasoning ? tokenCount(row[columns.reasoning]) : 0;
  const requests = columns.requests ? tokenCount(row[columns.requests]) : 0;
  if (input === null || output === null || cached === null || cacheWrite === null || reasoning === null || requests === null) return null;
  return { input, output, cached, cacheWrite, reasoning, requests };
}

function addTotals(target: UsageTotals, addition: UsageTotals): void {
  const next = {
    input: target.input + addition.input,
    output: target.output + addition.output,
    cached: target.cached + addition.cached,
    cacheWrite: target.cacheWrite + addition.cacheWrite,
    reasoning: target.reasoning + addition.reasoning,
    requests: target.requests + addition.requests,
  };
  if (Object.values(next).some((value) => !Number.isSafeInteger(value))) {
    throw new Error("Hermes usage aggregate exceeds the safe integer range");
  }
  Object.assign(target, next);
}

function canonicalUsage(values: UsageTotals, requests: number): TokenUsage | null {
  const input = values.input + values.cached + values.cacheWrite;
  const total = input + values.output;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(total) || !Number.isSafeInteger(requests) || requests < 0) return null;
  const usage = {
    input,
    cached: values.cached,
    cacheWrite: values.cacheWrite,
    output: values.output,
    reasoning: values.reasoning,
    total,
    requests,
  };
  return isCanonicalTokenUsage(usage) ? usage : null;
}

function addRow(
  sessions: Map<string, ParsedSession>,
  row: Record<string, unknown>,
  columns: {
    input: string;
    output: string;
    cached?: string | null;
    cacheWrite?: string | null;
    reasoning?: string | null;
    requests?: string | null;
    model?: string | null;
    provider?: string | null;
    session?: string | null;
    timestamp?: string | null;
    startedAt?: string | null;
    cwd?: string | null;
    defaultRequests?: number;
  },
  agent: string,
  opts: ParseOptions,
  fallbackSessionId = `${agent}-db`,
  aggregate?: Record<string, unknown>,
): void {
  const values = usageTotals(row, columns);
  if (!values) return;
  const requests = columns.requests ? values.requests : (columns.defaultRequests ?? 1);
  if (values.input <= 0 && values.output <= 0 && values.cached <= 0 && values.cacheWrite <= 0 && values.reasoning <= 0 && requests <= 0) return;
  const provider = columns.provider && row[columns.provider] != null ? String(row[columns.provider]) : null;
  // `billing_mode` is useful corroborating metadata, but never sufficient OAuth proof on its own.
  if (!opts.includeAllProviders && !isCodexAuthProvider(provider)) return;
  const ts = (columns.timestamp ? toMs(row[columns.timestamp]) : null)
    ?? toMs(aggregate?.last_activity_at)
    ?? toMs(aggregate?.ended_at)
    ?? toMs(aggregate?.started_at)
    ?? 0;
  const startedAt = (columns.startedAt ? toMs(row[columns.startedAt]) : null) ?? toMs(aggregate?.started_at) ?? ts;
  const model = columns.model && row[columns.model] ? String(row[columns.model]) : "unknown";
  const sid = columns.session && row[columns.session] != null ? String(row[columns.session]) : fallbackSessionId;
  const usage = canonicalUsage(values, requests);
  if (!usage) return;
  const ev: UsageEvent = {
    ts,
    model,
    agent,
    provider,
    usage,
  };
  let session = sessions.get(sid);
  if (!session) {
    const rowCwd = columns.cwd ? row[columns.cwd] : null;
    const aggregateCwd = aggregate?.cwd;
    const cwd = typeof rowCwd === "string" ? rowCwd : typeof aggregateCwd === "string" ? aggregateCwd : null;
    session = {
      sessionId: sid, agent, provider, startedAt, lastActivityAt: ts, cwd,
      projectName: cwd ? cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null : null,
      originator: agent, source: `${agent}-db`, cliVersion: null, timezone: null, model,
      events: [], cumulative: emptyCumulative(), contextWindow: null, rateLimits: null, lineCount: 0,
    };
    sessions.set(sid, session);
  } else if (!session.cwd && typeof aggregate?.cwd === "string") {
    const cwd = aggregate.cwd;
    session.cwd = cwd;
    session.projectName = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null;
  }
  const cumulative = session.cumulative;
  const nextCumulative = {
    input: cumulative.input + usage.input,
    cached: cumulative.cached + values.cached,
    cacheWrite: cumulative.cacheWrite + values.cacheWrite,
    output: cumulative.output + values.output,
    reasoning: cumulative.reasoning + values.reasoning,
    total: cumulative.total + usage.total,
    requests: cumulative.requests + requests,
  };
  if (Object.values(nextCumulative).some((value) => !Number.isSafeInteger(value))) {
    throw new Error("Hermes session usage exceeds the safe integer range");
  }
  session.events.push(ev);
  session.lineCount++;
  session.model = model;
  session.provider = provider;
  if (startedAt && (session.startedAt === 0 || startedAt < session.startedAt)) session.startedAt = startedAt;
  if (ts > session.lastActivityAt) session.lastActivityAt = ts;
  Object.assign(cumulative, nextCumulative);
}

/**
 * Best-effort reader for a Hermes SQLite state DB (`~/.hermes/state.db`): introspects tables for token columns.
 * Uses the runtime's built-in `node:sqlite` when available. Missing runtime support returns null;
 * operational database errors propagate so SessionStore can retain its last-good snapshot.
 */
export function parseSqliteUsage(dbPath: string, agent: string, opts: ParseOptions): ParsedSession[] | null {
  const db = openSqliteReadOnlyOrThrow(dbPath);
  if (!db) return null;
  const sessions = new Map<string, ParsedSession>();
  const fallbackSessionId = sqliteSessionId(agent, dbPath);
  try {
    const tableNames = sqliteTableNamesOrThrow(db);
    if (tableNames.has("session_model_usage")) {
      const columns = tableColumns(db, "session_model_usage");
      if (hasCanonicalUsageColumns(columns)) {
        const cached = columns.includes("cache_read_tokens") ? "cache_read_tokens" : null;
        const cacheWrite = columns.includes("cache_write_tokens") ? "cache_write_tokens" : null;
        const reasoning = columns.includes("reasoning_tokens") ? "reasoning_tokens" : null;
        const requests = columns.includes("api_call_count") ? "api_call_count" : null;
        const timestamp = columns.includes("last_seen") ? "last_seen" : null;
        const startedAt = columns.includes("first_seen") ? "first_seen" : null;
        const modelColumns = {
          input: "input_tokens", output: "output_tokens", cached, cacheWrite, reasoning, requests,
          model: "model", provider: "billing_provider", session: "session_id", timestamp, startedAt,
        };
        const aggregateRows = readSessionAggregates(db, tableNames);
        const totalsBySession = new Map<string, UsageTotals>();
        for (const row of sqliteRows(db, "SELECT * FROM session_model_usage")) {
          const sessionId = row.session_id == null ? fallbackSessionId : String(row.session_id);
          let total = totalsBySession.get(sessionId);
          if (!total) {
            total = { input: 0, output: 0, cached: 0, cacheWrite: 0, reasoning: 0, requests: 0 };
            totalsBySession.set(sessionId, total);
          }
          const rowTotals = usageTotals(row, modelColumns);
          if (!rowTotals || !canonicalUsage(rowTotals, requests ? rowTotals.requests : 1)) continue;
          addTotals(total, rowTotals);
          addRow(sessions, row, modelColumns, agent, opts, fallbackSessionId, aggregateRows.get(sessionId));
        }

        // Hermes writes route-specific increments above, while absolute/legacy totals remain on
        // `sessions`. Match its own Insights reconciliation: only the positive remainder of each
        // independently tracked field is added, so already-attributed model rows are never doubled.
        for (const [sessionId, row] of aggregateRows) {
          const attributed = totalsBySession.get(sessionId)
            ?? { input: 0, output: 0, cached: 0, cacheWrite: 0, reasoning: 0, requests: 0 };
          // Hermes does not reconcile `reasoning_tokens` separately here: it is informational and
          // already represented in the provider's output-token bucket used for totals and billing.
          const aggregateInput = tokenCount(row.input_tokens);
          const aggregateOutput = tokenCount(row.output_tokens);
          const aggregateCached = tokenCount(row.cache_read_tokens);
          const aggregateCacheWrite = tokenCount(row.cache_write_tokens);
          const aggregateRequests = tokenCount(row.api_call_count);
          if (
            aggregateInput === null
            || aggregateOutput === null
            || aggregateCached === null
            || aggregateCacheWrite === null
            || aggregateRequests === null
          ) continue;
          const residual = {
            session_id: sessionId,
            model: row.model,
            billing_provider: row.billing_provider,
            input_tokens: Math.max(0, aggregateInput - attributed.input),
            output_tokens: Math.max(0, aggregateOutput - attributed.output),
            cache_read_tokens: Math.max(0, aggregateCached - attributed.cached),
            cache_write_tokens: Math.max(0, aggregateCacheWrite - attributed.cacheWrite),
            requests: Math.max(0, aggregateRequests - attributed.requests),
          };
          addRow(sessions, residual, {
            input: "input_tokens", output: "output_tokens", cached: "cache_read_tokens", cacheWrite: "cache_write_tokens",
            reasoning: null, requests: "requests", model: "model", provider: "billing_provider", session: "session_id",
            timestamp: null, startedAt: null, defaultRequests: 0,
          }, agent, opts, fallbackSessionId, row);
        }
        for (const session of sessions.values()) session.events.sort((a, b) => a.ts - b.ts);
        return [...sessions.values()];
      }
    }
    for (const name of tableNames) {
      if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
      if (name === "session_model_usage") continue;
      const cols = tableColumns(db, name);
      const inCol = pick(cols, INPUT_COLS);
      const outCol = pick(cols, OUTPUT_COLS);
      if (!inCol || !outCol) continue;
      const modelCol = pick(cols, MODEL_COLS);
      const tsCol = pick(cols, TS_COLS);
      const sessCol = pick(cols, SESSION_COLS);
      const provCol = pick(cols, PROVIDER_COLS);
      const cachedCol = pick(cols, CACHED_COLS);
      const cacheWriteCol = pick(cols, CACHE_WRITE_COLS);
      const reasoningCol = pick(cols, REASONING_COLS);
      const requestsCol = pick(cols, REQUEST_COLS);
      for (const r of sqliteRows(db, `SELECT * FROM ${name}`)) {
        addRow(sessions, r, {
          input: inCol, output: outCol, cached: cachedCol, cacheWrite: cacheWriteCol, reasoning: reasoningCol,
          requests: requestsCol, model: modelCol, provider: provCol, session: sessCol, timestamp: tsCol, startedAt: tsCol,
        }, agent, opts, fallbackSessionId);
      }
    }
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

type HermesDatabaseProbe = "supported" | "unsupported" | "unreadable";

function probeHermesUsageDatabase(file: string): HermesDatabaseProbe {
  let db: SqliteDatabase | null;
  try {
    db = openSqliteReadOnlyOrThrow(file);
  } catch {
    return "unreadable";
  }
  // The compatibility runtime cannot inspect SQLite. Prefer its legacy text fallback.
  if (!db) return "unsupported";
  try {
    const tables = sqliteTableNamesOrThrow(db);
    if (tables.has("session_model_usage") && hasCanonicalUsageColumns(tableColumns(db, "session_model_usage"))) return "supported";
    for (const table of tables) {
      if (!/^[A-Za-z0-9_]+$/.test(table)) continue;
      if (table === "session_model_usage") continue;
      const columns = tableColumns(db, table);
      if (pick(columns, INPUT_COLS) && pick(columns, OUTPUT_COLS) && pick(columns, PROVIDER_COLS)) return "supported";
    }
    return "unsupported";
  } catch {
    // Keep the DB root on operational failures. Its strict parser will throw, allowing SessionStore
    // to retain the last-good snapshot and retry instead of deleting it during deep discovery.
    return "unreadable";
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

/** Hermes agent (NousResearch/hermes-agent): ~/.hermes/sessions/**.json|jsonl (generic parser) + optional ~/.hermes/state.db. */
export const hermesSource: SourceDefinition = {
  id: "hermes",
  label: "Hermes agent",
  format: "generic",
  discover(ctx: SourceContext): SessionRoot[] {
    const roots: SessionRoot[] = [];
    for (const h of ctx.homes) {
      const home = h.origin === "local" && ctx.env.HERMES_HOME
        ? ctx.env.HERMES_HOME
        : path.join(h.home, ".hermes");
      for (const data of [home, ...listDirs(path.join(home, "profiles")).map((profile) => path.join(home, "profiles", profile))]) {
        const sessions = path.join(data, "sessions");
        const database = path.join(data, "state.db");
        const databaseProbe = isFile(database) ? probeHermesUsageDatabase(database) : "unsupported";
        if (databaseProbe === "supported" || databaseProbe === "unreadable") {
          roots.push(makeRoot(data, "hermes", "hermes", "generic", "flat", h.origin, ["state.db"], 0, false));
        } else if (isDir(sessions)) {
          roots.push(makeRoot(sessions, "hermes", "hermes", "generic", "flat", h.origin, [".jsonl", ".json"], 4));
        }
      }
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
        if (!tryAddUsageInPlace(cumulative, e.usage)) {
          throw new Error("Hermes merged usage exceeds the safe integer range");
        }
      }
      return { ...list[0], sessionId: sqliteSessionId(file.root.agent, file.path), events, cumulative, startedAt: Math.min(...list.map((s) => s.startedAt)), lastActivityAt: Math.max(...list.map((s) => s.lastActivityAt)) };
    }
    return genericSource.parse(file, opts);
  },
  extraRoot: (dir, agent) => genericSource.extraRoot(dir, agent),
};
