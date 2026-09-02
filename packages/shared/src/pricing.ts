import type { TokenUsage } from "./usage.ts";

/** USD per 1,000,000 tokens. */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
  /** Optional cache-write rate; defaults to `input` when absent. */
  cacheWrite?: number;
  /**
   * Long-context tier. OpenAI bills some models at a higher rate once a single request's prompt
   * crosses `threshold` input tokens (272K for the GPT-5.4+ flagships). Absent = one flat rate.
   */
  long?: LongContextPrice;
}

/** Rates applied to a request whose input exceeds `threshold` tokens. */
export interface LongContextPrice {
  threshold: number;
  input: number;
  cachedInput: number;
  output: number;
}

export interface PriceMatch {
  model: string;
  price: ModelPrice;
  /** Which pricing-table key was used, or null for the global fallback. */
  matchedKey: string | null;
  /** True when the price was inferred (prefix / family / fallback), not an exact table hit. */
  estimated: boolean;
}

/** Input-token threshold above which the long-context tier applies. */
export const LONG_CONTEXT_THRESHOLD = 272_000;

const long = (threshold: number, input: number, cachedInput: number, output: number): LongContextPrice => ({
  threshold,
  input,
  cachedInput,
  output,
});

/**
 * Standard OpenAI API list prices (USD / 1M tokens), used to express subscription usage as
 * "API-equivalent" dollars. Mirrors https://developers.openai.com/api/docs/pricing (standard tier —
 * not batch/flex/priority). Models newer than this table are priced by family fallback and flagged
 * `estimated`; override anything via `pricing.json` (menubar) or `PRICING_OVERRIDES` (dashboard).
 *
 * `-codex` variants are billed at their base model's rate and are listed explicitly so Codex CLI
 * model ids resolve exactly instead of through the family fallback.
 */
export const DEFAULT_PRICING: Record<string, ModelPrice> = {
  // GPT-5.6 family
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20, long: long(LONG_CONTEXT_THRESHOLD, 8, 0.8, 30) },
  "gpt-5.6-sol-codex": { input: 4, cachedInput: 0.4, output: 20, long: long(LONG_CONTEXT_THRESHOLD, 8, 0.8, 30) },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12, long: long(LONG_CONTEXT_THRESHOLD, 4, 0.4, 18) },
  "gpt-5.6-terra-codex": { input: 2, cachedInput: 0.2, output: 12, long: long(LONG_CONTEXT_THRESHOLD, 4, 0.4, 18) },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2, long: long(LONG_CONTEXT_THRESHOLD, 0.4, 0.04, 1.8) },
  "gpt-5.6-cyber": { input: 12.5, cachedInput: 1.25, output: 75 },
  // GPT-5.5 family
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30, long: long(LONG_CONTEXT_THRESHOLD, 10, 1, 45) },
  "gpt-5.5-codex": { input: 5, cachedInput: 0.5, output: 30, long: long(LONG_CONTEXT_THRESHOLD, 10, 1, 45) },
  "gpt-5.5-pro": { input: 30, cachedInput: 30, output: 180, long: long(LONG_CONTEXT_THRESHOLD, 60, 60, 270) },
  "gpt-5.5-cyber": { input: 12.5, cachedInput: 1.25, output: 75 },
  // GPT-5.4 family
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15, long: long(LONG_CONTEXT_THRESHOLD, 5, 0.5, 22.5) },
  "gpt-5.4-codex": { input: 2.5, cachedInput: 0.25, output: 15, long: long(LONG_CONTEXT_THRESHOLD, 5, 0.5, 22.5) },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.4-pro": { input: 30, cachedInput: 30, output: 180, long: long(LONG_CONTEXT_THRESHOLD, 60, 60, 270) },
  // GPT-5.3 family (Codex-only release)
  "gpt-5.3": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.3-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
  // GPT-5.2 family
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.2-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.2-pro": { input: 21, cachedInput: 21, output: 168 },
  // GPT-5.1 family
  "gpt-5.1": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5.1-codex": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5.1-codex-max": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5.1-codex-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  // GPT-5 family
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-codex": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-5-pro": { input: 15, cachedInput: 15, output: 120 },
  "gpt-5-search-api": { input: 1.25, cachedInput: 0.125, output: 10 },
  // ChatGPT-tuned endpoint
  "chat-latest": { input: 5, cachedInput: 0.5, output: 30 },
  // GPT-4.1 / 4o family
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  // Reasoning models
  o1: { input: 15, cachedInput: 7.5, output: 60 },
  "o1-pro": { input: 150, cachedInput: 150, output: 600 },
  o3: { input: 2, cachedInput: 0.5, output: 8 },
  "o3-pro": { input: 20, cachedInput: 20, output: 80 },
  "o3-mini": { input: 1.1, cachedInput: 0.55, output: 4.4 },
  "o4-mini": { input: 1.1, cachedInput: 0.275, output: 4.4 },
  "codex-mini-latest": { input: 1.5, cachedInput: 0.375, output: 6 },
};

/** Used when nothing in the table matches at all — the current Codex flagship. */
export const FALLBACK_PRICE_KEY = "gpt-5.3-codex";

const TIERS = ["mini", "nano", "pro"] as const;
type Tier = (typeof TIERS)[number] | null;

export function normalizeModelName(model: string): string {
  let m = (model || "").trim().toLowerCase();
  if (!m) return "unknown";
  m = m.replace(/^openai\//, "");
  m = m.replace(/-\d{4}-\d{2}-\d{2}$/, ""); // dated snapshots
  m = m.replace(/-preview$/, "");
  return m;
}

/**
 * Is this an OpenAI (Codex-billable) model?
 *
 * The tracker also reads logs from agents that can talk to other providers (Cline/Roo/Kilo,
 * OpenCode, …). This dashboard only reports Codex consumption, so usage on Anthropic / Google /
 * open-weight models is dropped rather than priced against an OpenAI table it does not belong to.
 * `unknown` is kept: Codex rollouts that never logged a model name are still Codex usage.
 */
export function isOpenAIModel(model: string): boolean {
  const m = normalizeModelName(model);
  if (m === "unknown") return true;
  return /^(gpt[-.]|chatgpt|chat-latest|o[1-9](?:[-.]|$)|codex|text-|davinci|babbage|ada|curie)/.test(m);
}

function tierOf(name: string): Tier {
  for (const t of TIERS) if (name.split("-").includes(t)) return t;
  return null;
}

function versionOf(key: string): number | null {
  const m = key.match(/^gpt-(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2] ?? 0) / 100;
}

/**
 * Resolve the price for a model name.
 * 1. exact match (overrides win over defaults)
 * 2. progressively strip trailing `-segment`s (gpt-5.1-codex-max → gpt-5.1-codex)
 * 3. gpt-N.M family fallback: nearest known version at or below, same tier (mini/nano/pro/base)
 * 4. global fallback
 */
export function resolvePrice(model: string, overrides?: Record<string, ModelPrice>): PriceMatch {
  const table: Record<string, ModelPrice> = { ...DEFAULT_PRICING, ...(overrides ?? {}) };
  const norm = normalizeModelName(model);

  if (table[norm]) return { model, price: table[norm], matchedKey: norm, estimated: false };

  const parts = norm.split("-");
  while (parts.length > 1) {
    parts.pop();
    const key = parts.join("-");
    if (table[key]) return { model, price: table[key], matchedKey: key, estimated: true };
  }

  const v = versionOf(norm);
  if (v !== null) {
    const tier = tierOf(norm);
    const wantsCodex = norm.includes("codex");
    let best: { key: string; v: number; score: number } | null = null;
    for (const key of Object.keys(table)) {
      const kv = versionOf(key);
      if (kv === null) continue;
      if (Math.floor(kv) !== Math.floor(v)) continue; // same major
      if (tierOf(key) !== tier) continue;
      const kCodex = key.includes("codex");
      // prefer versions <= target (closest), then codex-ness match
      const score = (kv <= v ? 1000 - (v - kv) * 100 : 500 - (kv - v) * 100) + (kCodex === wantsCodex ? 10 : 0);
      if (!best || score > best.score) best = { key, v: kv, score };
    }
    if (best) return { model, price: table[best.key], matchedKey: best.key, estimated: true };
  }

  return { model, price: table[FALLBACK_PRICE_KEY], matchedKey: null, estimated: true };
}

/**
 * API-equivalent cost in USD for a *single request's* usage at a given price.
 *
 * `u.input` is the request's prompt size, so it also selects the long-context tier when the model
 * has one. Callers that pass an aggregate get the standard tier, which is what pre-aggregated rows
 * (already costed per request on the device) want.
 */
export function computeCost(u: Partial<TokenUsage>, p: ModelPrice): number {
  const input = u.input ?? 0;
  const rate = p.long && input > p.long.threshold ? p.long : p;
  const cached = Math.min(u.cached ?? 0, input);
  const cacheWrite = Math.min(u.cacheWrite ?? 0, Math.max(0, input - cached));
  const fresh = Math.max(0, input - cached - cacheWrite);
  const output = u.output ?? 0;
  const cost =
    fresh * rate.input + cached * rate.cachedInput + cacheWrite * (p.cacheWrite ?? rate.input) + output * rate.output;
  return cost / 1_000_000;
}

export function costForModel(model: string, u: Partial<TokenUsage>, overrides?: Record<string, ModelPrice>): number {
  return computeCost(u, resolvePrice(model, overrides).price);
}
