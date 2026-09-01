import { emptyUsage, addUsageInPlace, type TokenUsage } from "./usage.ts";
import type { ParsedSession, UsageEvent } from "./codex-parser.ts";

export const AGENT_PI = "pi";

/** Provider ids that route through a Codex (ChatGPT) subscription login rather than an API key. */
export const CODEX_AUTH_PROVIDERS = new Set(["openai-codex", "codex", "chatgpt", "openai-chatgpt"]);

export function isCodexAuthProvider(provider: string | null | undefined, api?: string | null): boolean {
  const p = (provider ?? "").toLowerCase();
  if (CODEX_AUTH_PROVIDERS.has(p)) return true;
  const a = (api ?? "").toLowerCase();
  return a.startsWith("openai-codex") || p.includes("codex");
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
  totalTokens?: number;
}

/**
 * pi coding agent (`~/.pi/agent/sessions/<cwd>/<ts>_<uuid>.jsonl`).
 * Line 1: {type:"session", version, id, timestamp, cwd}; assistant messages carry per-request
 * `message.usage` = {input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost} where
 * `input` EXCLUDES cached tokens (totalTokens = input + output + cacheRead) and `output` includes reasoning.
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
  let lineCount = 0;
  const events: UsageEvent[] = [];
  const cumulative = emptyUsage();

  function noteTime(ts: number | null) {
    if (ts === null || Number.isNaN(ts)) return;
    if (startedAt === null || ts < startedAt) startedAt = ts;
    if (ts > lastActivityAt) lastActivityAt = ts;
  }
  function parseTs(v: unknown): number | null {
    if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
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
        if (typeof obj.modelId === "string") model = obj.modelId;
        if (typeof obj.provider === "string") provider = obj.provider;
        noteTime(ts);
        return;
      }
      if (obj.type !== "message" || !obj.message || typeof obj.message !== "object") return;
      const m = obj.message;
      noteTime(ts ?? parseTs(m.timestamp));
      if (m.role !== "assistant") return;
      if (typeof m.model === "string") model = m.model;
      const msgProvider: string | null = typeof m.provider === "string" ? m.provider : provider;
      if (msgProvider) provider = msgProvider;
      const u: PiUsage | undefined = m.usage;
      if (!u || typeof u !== "object") return;
      if (!opts.includeAllProviders && !isCodexAuthProvider(msgProvider, typeof m.api === "string" ? m.api : null)) return;
      const cached = u.cacheRead ?? 0;
      const cacheWrite = u.cacheWrite ?? 0;
      const fresh = u.input ?? 0;
      const output = u.output ?? 0;
      const usage: TokenUsage = {
        input: fresh + cached + cacheWrite,
        cached,
        cacheWrite,
        output,
        reasoning: u.reasoning ?? 0,
        total: u.totalTokens ?? fresh + cached + cacheWrite + output,
        requests: 1,
      };
      if (usage.total <= 0 && usage.input <= 0 && usage.output <= 0) return;
      addUsageInPlace(cumulative, usage);
      const eventTs = ts ?? parseTs(m.timestamp) ?? lastActivityAt;
      events.push({ ts: eventTs, model: m.model ?? model, usage, agent: AGENT_PI, provider: msgProvider });
    },
    result(): ParsedSession | null {
      if (lineCount === 0) return null;
      return {
        sessionId: sessionId ?? fallbackSessionId,
        agent: AGENT_PI,
        provider,
        startedAt: startedAt ?? lastActivityAt,
        lastActivityAt,
        cwd,
        projectName: cwd ? cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null : null,
        originator: "pi",
        source: "pi",
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
