import { emptyUsage, isCanonicalTokenUsage, tryAddUsageInPlace, type TokenUsage } from "./usage.ts";
import type { ParsedSession, UsageEvent } from "./codex-parser.ts";
import { isCodexAuthProvider } from "./pi-parser.ts";

/**
 * Best-effort parser for other agents (e.g. Hermes) whose transcripts are JSON / JSONL records
 * carrying per-request usage objects. It looks for objects with a `usage` (or `token_usage`)
 * field using any of the common key spellings, plus a model name and a timestamp.
 * Cumulative-vs-delta is detected heuristically: if totals only ever grow monotonically AND a
 * `cumulative`/`total_token_usage` hint exists, deltas are taken; otherwise values are used as-is.
 */
export interface GenericParserOptions {
  agent: string;
  includeAllProviders?: boolean;
}

interface RecordContext {
  provider: string | null;
  api: string | null;
  model: string | null;
}

const INPUT_KEYS = ["input_tokens", "prompt_tokens", "input", "inputTokens", "promptTokens"];
const OUTPUT_KEYS = ["output_tokens", "completion_tokens", "output", "outputTokens", "completionTokens"];
const CACHED_KEYS = ["cached_input_tokens", "cache_read_input_tokens", "cached_tokens", "cacheRead", "cache_read", "cachedTokens"];
const CACHE_WRITE_KEYS = ["cache_write_input_tokens", "cache_creation_input_tokens", "cacheWrite", "cache_write"];
const REASONING_KEYS = ["reasoning_output_tokens", "reasoning_tokens", "reasoning", "reasoningTokens"];
const TOTAL_KEYS = ["total_tokens", "totalTokens", "total"];
const TS_KEYS = ["timestamp", "created_at", "createdAt", "ts", "time", "date"];
const MODEL_KEYS = ["model", "model_id", "modelId", "model_name"];
const PROVIDER_KEYS = ["provider", "provider_id", "providerId", "api"];

function num(o: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v && typeof v === "object") {
      // nested details e.g. input_tokens_details.cached_tokens
      const inner = num(v, keys);
      if (inner !== null) return inner;
    }
  }
  return null;
}

function hasInvalidCount(o: any, keys: string[], depth = 0): boolean {
  if (!o || typeof o !== "object" || depth > 6) return false;
  for (const key of keys) {
    if (!(key in o)) continue;
    const value = o[key];
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value < 0) return true;
    } else if (value && typeof value === "object") {
      if (hasInvalidCount(value, keys, depth + 1)) return true;
    } else {
      return true;
    }
  }
  return false;
}
function str(o: any, keys: string[]): string | null {
  for (const k of keys) if (typeof o?.[k] === "string" && o[k]) return o[k];
  return null;
}
function ts(o: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      const t = v < 1e12 ? v * 1000 : v;
      if (Number.isFinite(t)) return t;
    }
    if (typeof v === "string") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
  }
  return null;
}

function usageFrom(u: any): TokenUsage | null {
  if (!u || typeof u !== "object") return null;
  if (
    hasInvalidCount(u, INPUT_KEYS)
    || hasInvalidCount(u, OUTPUT_KEYS)
    || hasInvalidCount(u.input_tokens_details ?? u, CACHED_KEYS)
    || hasInvalidCount(u, CACHE_WRITE_KEYS)
    || hasInvalidCount(u.output_tokens_details ?? u, REASONING_KEYS)
    || hasInvalidCount(u, TOTAL_KEYS)
  ) return null;
  const input = num(u, INPUT_KEYS);
  const output = num(u, OUTPUT_KEYS);
  if (input === null && output === null) return null;
  const cached = num(u.input_tokens_details ?? u, CACHED_KEYS) ?? 0;
  const cacheWrite = num(u, CACHE_WRITE_KEYS) ?? 0;
  const reasoning = num(u.output_tokens_details ?? u, REASONING_KEYS) ?? 0;
  const inp = input ?? 0;
  const out = output ?? 0;
  const total = num(u, TOTAL_KEYS);
  // Normalized pi/OpenClaw-style usage stores cache buckets outside input.
  const separatedCache = cached > 0 || cacheWrite > 0;
  const components = inp + out + cached + cacheWrite;
  const minimumTotal = inp + out;
  if (!Number.isSafeInteger(components) || !Number.isSafeInteger(minimumTotal)) return null;
  if (total !== null && total < minimumTotal) return null;
  const inputInclusive = separatedCache && total !== null && Math.abs(total - components) <= 1 ? inp + cached + cacheWrite : inp;
  if (!Number.isSafeInteger(inputInclusive) || (total !== null && total < inputInclusive + out)) return null;
  const usage = {
    input: inputInclusive,
    cached,
    cacheWrite,
    output: out,
    reasoning,
    total: total ?? inputInclusive + out,
    requests: 1,
  };
  return isCanonicalTokenUsage(usage) ? usage : null;
}

/** Walk a parsed JSON value and yield candidate records (objects containing a usage block). */
function* records(value: any, depth = 0): Generator<any> {
  if (!value || typeof value !== "object" || depth > 6) return;
  if (Array.isArray(value)) {
    for (const v of value) yield* records(v, depth + 1);
    return;
  }
  if (value.usage || value.token_usage || value.tokenUsage) yield value;
  for (const k of ["messages", "items", "events", "turns", "history", "message", "data", "response"]) {
    if (value[k]) yield* records(value[k], depth + 1);
  }
}

export function createGenericSessionParser(fallbackSessionId: string, opts: GenericParserOptions): {
  push(line: string): void;
  pushJson(value: unknown): void;
  result(): ParsedSession | null;
} {
  let sessionId: string | null = null;
  let startedAt: number | null = null;
  let lastActivityAt = 0;
  let cwd: string | null = null;
  let model = "unknown";
  let provider: string | null = null;
  let lineCount = 0;
  const events: UsageEvent[] = [];
  const cumulative = emptyUsage();

  function noteTime(t: number | null) {
    if (t === null || !Number.isFinite(t)) return;
    if (startedAt === null || t < startedAt) startedAt = t;
    if (t > lastActivityAt) lastActivityAt = t;
  }
  function consume(rec: any, inheritedTs: number | null, context: RecordContext) {
    const u = usageFrom(rec.usage ?? rec.token_usage ?? rec.tokenUsage);
    const t = ts(rec, TS_KEYS) ?? ts(rec.message, TS_KEYS) ?? inheritedTs ?? lastActivityAt;
    noteTime(t);
    if (!u) return;
    // Usage attribution must be explicit on this record/message or its enclosing JSON document.
    // Never inherit it from a previous JSONL record: multi-provider sessions can switch routes.
    const m = str(rec, MODEL_KEYS) ?? str(rec.message, MODEL_KEYS) ?? context.model ?? "unknown";
    const p = str(rec, PROVIDER_KEYS) ?? str(rec.message, PROVIDER_KEYS) ?? context.provider;
    const api = str(rec, ["api"]) ?? str(rec.message, ["api"]) ?? context.api;
    const codexAuth = isCodexAuthProvider(p, api);
    if (!opts.includeAllProviders && !codexAuth) return;
    if (u.total <= 0 && u.input <= 0 && u.output <= 0) return;
    if (!tryAddUsageInPlace(cumulative, u)) return;
    model = m;
    if (p) provider = p;
    events.push({ ts: t, model: m, usage: u, agent: opts.agent, provider: codexAuth ? "openai-codex" : p });
  }

  const api = {
    pushJson(value: unknown) {
      lineCount++;
      const v: any = value;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (typeof v.id === "string" && !sessionId && (v.type === "session" || v.messages || v.session_id)) sessionId = v.id;
        if (typeof v.session_id === "string" && !sessionId) sessionId = v.session_id;
        if (typeof v.cwd === "string") cwd = v.cwd;
        if (typeof v.working_directory === "string") cwd = v.working_directory;
      }
      const top = ts(v, TS_KEYS);
      const context: RecordContext = {
        provider: str(v, PROVIDER_KEYS),
        api: str(v, ["api"]),
        model: str(v, MODEL_KEYS),
      };
      for (const rec of records(v)) consume(rec, top, context);
      if (top !== null) noteTime(top);
    },
    push(line: string) {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        api.pushJson(JSON.parse(trimmed));
      } catch {
        /* ignore non-JSON line */
      }
    },
    result(): ParsedSession | null {
      if (lineCount === 0) return null;
      return {
        sessionId: sessionId ?? fallbackSessionId,
        agent: opts.agent,
        provider,
        startedAt: startedAt ?? lastActivityAt,
        lastActivityAt,
        cwd,
        projectName: cwd ? cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null : null,
        originator: opts.agent,
        source: opts.agent,
        cliVersion: null,
        timezone: null,
        model,
        events,
        cumulative: { ...cumulative },
        contextWindow: null,
        rateLimits: null,
        lineCount,
      };
    },
  };
  return api;
}

/** Parse a whole file: JSONL first; if the file is a single JSON document, parse it as one value. */
export function parseGenericSessionText(text: string, fallbackSessionId: string, opts: GenericParserOptions): ParsedSession | null {
  const p = createGenericSessionParser(fallbackSessionId, opts);
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || (trimmed.startsWith("{") && !trimmed.includes("\n{"))) {
    try {
      p.pushJson(JSON.parse(trimmed));
      return p.result();
    } catch {
      /* fall through to JSONL */
    }
  }
  for (const line of text.split(/\r?\n/)) p.push(line);
  return p.result();
}
