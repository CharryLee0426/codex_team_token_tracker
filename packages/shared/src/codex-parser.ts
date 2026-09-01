import { emptyUsage, type TokenUsage } from "./usage.ts";

/** One API request worth of token usage (a delta between consecutive `token_count` events). */
/** Identifier of the tool that produced the usage: "codex" (Codex CLI/Desktop), "pi", "hermes", or a custom name. */
export type AgentName = string;
export const AGENT_CODEX = "codex";

export interface UsageEvent {
  ts: number; // UTC ms
  model: string;
  usage: TokenUsage; // requests === 1
  agent: AgentName;
  /** Upstream provider id as reported by the agent (e.g. "openai-codex"); null when implicit (Codex CLI). */
  provider?: string | null;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null; // UTC ms
}

export interface RateLimits {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  planType: string | null;
  limitId: string | null;
  observedAt: number;
}

export interface ParsedSession {
  sessionId: string;
  agent: AgentName;
  provider: string | null;
  startedAt: number;
  lastActivityAt: number;
  cwd: string | null;
  projectName: string | null;
  originator: string | null;
  source: string | null;
  cliVersion: string | null;
  timezone: string | null;
  model: string; // most recent model seen
  events: UsageEvent[];
  cumulative: TokenUsage; // last reported total_token_usage (+ requests count)
  contextWindow: number | null;
  rateLimits: RateLimits | null;
  /** Number of raw JSONL lines consumed. */
  lineCount: number;
}

export const UNKNOWN_MODEL = "unknown";

interface RawUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

function toUsage(r: RawUsage | null | undefined): TokenUsage | null {
  if (!r || typeof r !== "object") return null;
  if (typeof r.input_tokens !== "number" && typeof r.output_tokens !== "number") return null;
  const input = r.input_tokens ?? 0;
  const output = r.output_tokens ?? 0;
  return {
    input,
    cached: r.cached_input_tokens ?? 0,
    cacheWrite: r.cache_write_input_tokens ?? 0,
    output,
    reasoning: r.reasoning_output_tokens ?? 0,
    total: r.total_tokens ?? input + output,
    requests: 0,
  };
}

function parseTs(v: unknown): number | null {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function parseRateWindow(w: any): RateLimitWindow | null {
  if (!w || typeof w !== "object") return null;
  const resetsAt =
    typeof w.resets_at === "number"
      ? w.resets_at * 1000
      : typeof w.resets_in_seconds === "number"
        ? Date.now() + w.resets_in_seconds * 1000
        : null;
  return {
    usedPercent: typeof w.used_percent === "number" ? w.used_percent : 0,
    windowMinutes: typeof w.window_minutes === "number" ? w.window_minutes : null,
    resetsAt,
  };
}

/**
 * Incremental parser for a single Codex CLI rollout `.jsonl` file.
 * Feed lines in order (across multiple reads of a growing file); call `result()` any time.
 *
 * Handles the current format (`{timestamp,type,payload}` lines with `session_meta`, `turn_context`,
 * `event_msg/token_count`) and the legacy 2025 format (top-level meta line + flat `token_count` payloads).
 */
export function createSessionParser(fallbackSessionId: string): {
  push(line: string): void;
  result(): ParsedSession | null;
} {
  let sessionId: string | null = null;
  let startedAt: number | null = null;
  let lastActivityAt = 0;
  let cwd: string | null = null;
  let originator: string | null = null;
  let source: string | null = null;
  let cliVersion: string | null = null;
  let timezone: string | null = null;
  let model = UNKNOWN_MODEL;
  let contextWindow: number | null = null;
  let rateLimits: RateLimits | null = null;
  let lastCumulative: TokenUsage | null = null;
  let requests = 0;
  let lineCount = 0;
  const events: UsageEvent[] = [];

  function noteTime(ts: number | null) {
    if (ts === null) return;
    if (startedAt === null || ts < startedAt) startedAt = ts;
    if (ts > lastActivityAt) lastActivityAt = ts;
  }

  function onTokenCount(ts: number, payload: any) {
    const info = payload.info;
    let cumulative: TokenUsage | null = null;
    let last: TokenUsage | null = null;
    if (info && typeof info === "object") {
      cumulative = toUsage(info.total_token_usage);
      last = toUsage(info.last_token_usage);
      if (typeof info.model_context_window === "number") contextWindow = info.model_context_window;
    } else if (info === undefined) {
      // legacy flat payload: cumulative totals at the top level
      cumulative = toUsage(payload);
    }
    const rl = payload.rate_limits;
    if (rl && typeof rl === "object") {
      // merge: rate-limit-only events may omit fields present in earlier events
      rateLimits = {
        primary: parseRateWindow(rl.primary) ?? rateLimits?.primary ?? null,
        secondary: parseRateWindow(rl.secondary) ?? rateLimits?.secondary ?? null,
        planType: typeof rl.plan_type === "string" ? rl.plan_type : (rateLimits?.planType ?? null),
        limitId: typeof rl.limit_id === "string" ? rl.limit_id : (rateLimits?.limitId ?? null),
        observedAt: ts,
      };
    }
    if (!cumulative && !last) return;

    let delta: TokenUsage | null = null;
    if (cumulative) {
      if (!lastCumulative) {
        delta = { ...cumulative };
      } else if (cumulative.total < lastCumulative.total || cumulative.input < lastCumulative.input) {
        // counter reset (new thread / compaction quirk): treat as fresh
        delta = { ...cumulative };
      } else {
        delta = {
          input: cumulative.input - lastCumulative.input,
          cached: Math.max(0, cumulative.cached - lastCumulative.cached),
          cacheWrite: Math.max(0, cumulative.cacheWrite - lastCumulative.cacheWrite),
          output: Math.max(0, cumulative.output - lastCumulative.output),
          reasoning: Math.max(0, cumulative.reasoning - lastCumulative.reasoning),
          total: cumulative.total - lastCumulative.total,
          requests: 0,
        };
      }
      lastCumulative = cumulative;
    } else if (last) {
      delta = { ...last };
    }
    if (!delta) return;
    if (delta.total <= 0 && delta.input <= 0 && delta.output <= 0) return; // duplicate / rate-limit-only event
    delta.requests = 1;
    requests += 1;
    events.push({ ts, model, usage: delta, agent: AGENT_CODEX, provider: null });
  }

  return {
    push(line: string) {
      const trimmed = line.trim();
      if (!trimmed) return;
      lineCount++;
      let obj: any;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (!obj || typeof obj !== "object") return;
      const ts = parseTs(obj.timestamp);
      const type = obj.type;
      const payload = obj.payload;

      if (type === "session_meta" && payload && typeof payload === "object") {
        sessionId = payload.id ?? payload.session_id ?? sessionId;
        noteTime(parseTs(payload.timestamp) ?? ts);
        cwd = typeof payload.cwd === "string" ? payload.cwd : cwd;
        originator = typeof payload.originator === "string" ? payload.originator : originator;
        source = typeof payload.source === "string" ? payload.source : source;
        cliVersion = typeof payload.cli_version === "string" ? payload.cli_version : cliVersion;
        if (typeof payload.model === "string") model = payload.model;
        return;
      }
      // legacy meta line: {"id":..., "timestamp":..., "instructions":...}
      if (!type && typeof obj.id === "string" && obj.timestamp && "instructions" in obj) {
        sessionId = obj.id;
        noteTime(ts);
        if (typeof obj.cwd === "string") cwd = obj.cwd;
        return;
      }
      if (type === "turn_context" && payload && typeof payload === "object") {
        if (typeof payload.model === "string") model = payload.model;
        if (typeof payload.cwd === "string") cwd = payload.cwd;
        if (typeof payload.timezone === "string") timezone = payload.timezone;
        noteTime(ts);
        return;
      }
      if (type === "event_msg" && payload && typeof payload === "object") {
        const pt = payload.type;
        if (pt === "thread_settings_applied") {
          const m = payload.thread_settings?.model;
          if (typeof m === "string") model = m;
          noteTime(ts);
          return;
        }
        if (pt === "token_count") {
          const t = ts ?? (lastActivityAt || Date.now());
          noteTime(t);
          onTokenCount(t, payload);
          return;
        }
        if (pt === "task_started" || pt === "user_message" || pt === "agent_message" || pt === "task_complete") {
          noteTime(ts);
        }
        return;
      }
      if (type === "response_item") {
        noteTime(ts);
      }
    },
    result(): ParsedSession | null {
      if (lineCount === 0) return null;
      const id = sessionId ?? fallbackSessionId;
      const cumulative = lastCumulative ? { ...lastCumulative, requests } : { ...emptyUsage(), requests };
      return {
        sessionId: id,
        agent: AGENT_CODEX,
        provider: null,
        startedAt: startedAt ?? lastActivityAt,
        lastActivityAt,
        cwd,
        projectName: cwd ? basename(cwd) : null,
        originator,
        source,
        cliVersion,
        timezone,
        model,
        events,
        cumulative,
        contextWindow,
        rateLimits,
        lineCount,
      };
    },
  };
}

/** Convenience: parse a whole file's text. */
export function parseSessionText(text: string, fallbackSessionId = "unknown"): ParsedSession | null {
  const p = createSessionParser(fallbackSessionId);
  for (const line of text.split(/\r?\n/)) p.push(line);
  return p.result();
}

/** Derive a session id from a rollout filename like rollout-2026-08-31T10-27-38-<uuid>.jsonl */
export function sessionIdFromFilename(filename: string): string {
  const base = basename(filename).replace(/\.jsonl$/i, "");
  const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1] : base;
}
