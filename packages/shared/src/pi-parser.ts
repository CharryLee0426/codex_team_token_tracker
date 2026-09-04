import { emptyUsage, isCanonicalTokenUsage, tryAddUsageInPlace, type TokenUsage } from "./usage.ts";
import type { ParsedSession, UsageEvent } from "./codex-parser.ts";

export const AGENT_PI = "pi";

/** Provider ids that route through a Codex (ChatGPT) subscription login rather than an API key. */
export const CODEX_AUTH_PROVIDERS = new Set(["openai-codex"]);
const CODEX_AUTH_APIS = new Set(["openai-codex-responses", "openai-chatgpt-responses"]);

export function isCodexAuthProvider(provider: string | null | undefined, api?: string | null): boolean {
  const p = (provider ?? "").toLowerCase();
  if (CODEX_AUTH_PROVIDERS.has(p)) return true;
  const a = (api ?? "").toLowerCase();
  return p === "openai" && CODEX_AUTH_APIS.has(a);
}

export interface PiParserOptions {
  /** Include usage from every provider (API keys etc.), not only Codex-subscription providers. Default false. */
  includeAllProviders?: boolean;
}

interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

const PI_USAGE_KEYS: Array<keyof PiUsage> = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "reasoning",
  "reasoningTokens",
  "totalTokens",
];

function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function usageFrom(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const u = raw as PiUsage;
  if (PI_USAGE_KEYS.some((key) => u[key] !== undefined && !safeCount(u[key]))) return null;
  const cached = u.cacheRead ?? 0;
  const cacheWrite = u.cacheWrite ?? 0;
  const fresh = u.input ?? 0;
  const output = u.output ?? 0;
  const reasoning = u.reasoning ?? u.reasoningTokens ?? 0;
  const input = fresh + cached + cacheWrite;
  const componentTotal = input + output;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(componentTotal)) return null;
  if (u.totalTokens !== undefined && u.totalTokens < componentTotal) return null;
  const usage = {
    input,
    cached,
    cacheWrite,
    output,
    reasoning,
    total: u.totalTokens ?? componentTotal,
    requests: 1,
  };
  return isCanonicalTokenUsage(usage) ? usage : null;
}

/**
 * pi coding agent (`~/.pi/agent/sessions/<cwd>/<ts>_<uuid>.jsonl`); oh-my-pi writes the same format under
 * `~/.omp/agent/sessions` and is tagged `omp` by its own source.
 * Line 1: {type:"session", version, id, timestamp, cwd}; assistant messages and OMP
 * `model_usage` records carry per-request usage where `input` excludes cache tokens and `output`
 * already includes reasoning.
 */
export function createPiSessionParser(fallbackSessionId: string, opts: PiParserOptions = {}): {
  push(line: string): void;
  result(): ParsedSession | null;
} {
  let sessionId: string | null = null;
  let startedAt: number | null = null;
  let lastActivityAt = 0;
  let cwd: string | null = null;
  let model = "unknown";
  let provider: string | null = null;
  let routeModel = "unknown";
  let routeProvider: string | null = null;
  let lineCount = 0;
  const events: UsageEvent[] = [];
  const cumulative = emptyUsage();

  function noteTime(ts: number | null) {
    if (ts === null || !Number.isFinite(ts)) return;
    if (startedAt === null || ts < startedAt) startedAt = ts;
    if (ts > lastActivityAt) lastActivityAt = ts;
  }
  function parseTs(v: unknown): number | null {
    if (typeof v === "number" && Number.isFinite(v)) {
      const t = v < 1e12 ? v * 1000 : v;
      return Number.isFinite(t) ? t : null;
    }
    if (typeof v === "string") {
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : t;
    }
    return null;
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
      if (obj.type === "session") {
        if (typeof obj.id === "string") sessionId = obj.id;
        if (typeof obj.cwd === "string") cwd = obj.cwd;
        noteTime(ts);
        return;
      }
      if (obj.type === "model_change") {
        if (Object.prototype.hasOwnProperty.call(obj, "modelId")) {
          routeModel = typeof obj.modelId === "string" && obj.modelId ? obj.modelId : "unknown";
        }
        if (Object.prototype.hasOwnProperty.call(obj, "provider")) {
          routeProvider = typeof obj.provider === "string" && obj.provider ? obj.provider : null;
        }
        noteTime(ts);
        return;
      }
      let usageRecord: any;
      if (obj.type === "model_usage") {
        usageRecord = obj;
      } else if (obj.type === "message" && obj.message && typeof obj.message === "object") {
        usageRecord = obj.message;
        if (usageRecord.role !== "assistant") {
          noteTime(ts ?? parseTs(usageRecord.timestamp));
          return;
        }
      } else {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(usageRecord, "model")) {
        routeModel = typeof usageRecord.model === "string" && usageRecord.model ? usageRecord.model : "unknown";
      }
      if (Object.prototype.hasOwnProperty.call(usageRecord, "provider")) {
        // A malformed or deliberately unretained explicit provider must clear the inherited route;
        // otherwise an oversized non-Codex provider could inherit an earlier OAuth route.
        routeProvider = typeof usageRecord.provider === "string" && usageRecord.provider ? usageRecord.provider : null;
      }
      const msgProvider = routeProvider;
      const usage = usageFrom(usageRecord.usage);
      if (!usage) return;
      const codexAuth = isCodexAuthProvider(msgProvider, typeof usageRecord.api === "string" ? usageRecord.api : null);
      if (!opts.includeAllProviders && !codexAuth) return;
      if (usage.total <= 0 && usage.input <= 0 && usage.output <= 0) return;
      const eventModel = routeModel;
      const eventProvider = codexAuth ? "openai-codex" : msgProvider;
      if (!tryAddUsageInPlace(cumulative, usage)) return;
      model = eventModel;
      provider = eventProvider;
      noteTime(ts ?? parseTs(usageRecord.timestamp));
      const eventTs = ts ?? parseTs(usageRecord.timestamp) ?? lastActivityAt;
      events.push({
        ts: eventTs,
        model: eventModel,
        usage,
        agent: AGENT_PI,
        provider: eventProvider,
      });
    },
    result(): ParsedSession | null {
      if (lineCount === 0) return null;
      return {
        sessionId: sessionId ?? fallbackSessionId,
        agent: AGENT_PI,
        provider: events.length ? provider : routeProvider,
        startedAt: startedAt ?? lastActivityAt,
        lastActivityAt,
        cwd,
        projectName: cwd ? cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null : null,
        originator: "pi",
        source: "pi",
        cliVersion: null,
        timezone: null,
        model: events.length ? model : routeModel,
        events,
        cumulative: { ...cumulative },
        contextWindow: null,
        rateLimits: null,
        lineCount,
      };
    },
  };
}

export function parsePiSessionText(text: string, fallbackSessionId = "unknown", opts: PiParserOptions = {}): ParsedSession | null {
  const p = createPiSessionParser(fallbackSessionId, opts);
  for (const line of text.split(/\r?\n/)) p.push(line);
  return p.result();
}

/** pi file names look like 2026-09-01T07-50-24-299Z_<uuid>.jsonl */
export function piSessionIdFromFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "").replace(/\.jsonl$/i, "");
  const m = base.match(/_([0-9a-f-]{36})$/i);
  return m ? m[1] : base;
}
