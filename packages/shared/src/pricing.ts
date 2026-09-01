import type { TokenUsage } from "./usage.ts";

/** USD per 1,000,000 tokens. */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
  /** Optional cache-write rate; defaults to `input` when absent. */
  cacheWrite?: number;
}

export interface PriceMatch {
  model: string;
  price: ModelPrice;
  /** Which pricing-table key was used, or null for the global fallback. */
  matchedKey: string | null;
  /** True when the price was inferred (prefix / family / fallback), not an exact table hit. */
  estimated: boolean;
}

/**
 * Standard OpenAI API list prices (USD / 1M tokens), used to express subscription usage as
 * "API-equivalent" dollars. Newer models than this table are priced by family fallback and
 * flagged `estimated`; override anything via a `pricing.json` (menubar) or `PRICING_OVERRIDES` (dashboard).
 */
export const DEFAULT_PRICING: Record<string, ModelPrice> = {
  // GPT-5.x family
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-codex": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-5-pro": { input: 15, cachedInput: 15, output: 120 },
  "gpt-5.1": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5.1-codex": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5.1-codex-max": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5.1-codex-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.2-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.2-pro": { input: 21, cachedInput: 21, output: 168 },
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

/** Used when nothing in the table matches at all. */
export const FALLBACK_PRICE_KEY = "gpt-5.2";

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

/** API-equivalent cost in USD for a usage record at a given price. */
export function computeCost(u: Partial<TokenUsage>, p: ModelPrice): number {
  const input = u.input ?? 0;
  const cached = Math.min(u.cached ?? 0, input);
  const cacheWrite = Math.min(u.cacheWrite ?? 0, Math.max(0, input - cached));
  const fresh = Math.max(0, input - cached - cacheWrite);
  const output = u.output ?? 0;
  const cost =
    fresh * p.input + cached * p.cachedInput + cacheWrite * (p.cacheWrite ?? p.input) + output * p.output;
  return cost / 1_000_000;
}

export function costForModel(model: string, u: Partial<TokenUsage>, overrides?: Record<string, ModelPrice>): number {
  return computeCost(u, resolvePrice(model, overrides).price);
}
