/**
 * Canonical token usage record.
 *
 * Mirrors the Codex CLI `TokenUsage` struct:
 * - `input` includes `cached` (and `cacheWrite`) tokens.
 * - `output` includes `reasoning` tokens.
 * - `total` is at least input + output; some providers report additional unclassified tokens.
 * - `requests` counts API round-trips (one per `token_count` delta).
 */
export interface TokenUsage {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
  requests: number;
}

export function emptyUsage(): TokenUsage {
  return { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0, requests: 0 };
}

/** Validate the integer and subset invariants shared by every uploadable usage record. */
export function isCanonicalTokenUsage(value: TokenUsage): boolean {
  const fields = [
    value.input,
    value.cached,
    value.cacheWrite,
    value.output,
    value.reasoning,
    value.total,
    value.requests,
  ];
  if (fields.some((field) => !Number.isSafeInteger(field) || field < 0)) return false;
  const cacheTotal = value.cached + value.cacheWrite;
  const recombined = value.input + value.output;
  return Number.isSafeInteger(cacheTotal)
    && cacheTotal <= value.input
    && value.reasoning <= value.output
    && Number.isSafeInteger(recombined)
    && value.total >= recombined;
}

/** Add a complete usage record only when the resulting aggregate remains canonical and safe. */
export function tryAddUsageInPlace(target: TokenUsage, addition: TokenUsage): boolean {
  const next: TokenUsage = {
    input: target.input + addition.input,
    cached: target.cached + addition.cached,
    cacheWrite: target.cacheWrite + addition.cacheWrite,
    output: target.output + addition.output,
    reasoning: target.reasoning + addition.reasoning,
    total: target.total + addition.total,
    requests: target.requests + addition.requests,
  };
  if (!isCanonicalTokenUsage(addition) || !isCanonicalTokenUsage(next)) return false;
  Object.assign(target, next);
  return true;
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return {
    input: a.input + (b.input ?? 0),
    cached: a.cached + (b.cached ?? 0),
    cacheWrite: a.cacheWrite + (b.cacheWrite ?? 0),
    output: a.output + (b.output ?? 0),
    reasoning: a.reasoning + (b.reasoning ?? 0),
    total: a.total + (b.total ?? 0),
    requests: a.requests + (b.requests ?? 0),
  };
}

export function addUsageInPlace(target: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  target.input += b.input ?? 0;
  target.cached += b.cached ?? 0;
  target.cacheWrite += b.cacheWrite ?? 0;
  target.output += b.output ?? 0;
  target.reasoning += b.reasoning ?? 0;
  target.total += b.total ?? 0;
  target.requests += b.requests ?? 0;
  return target;
}

export function sumUsage(items: Iterable<Partial<TokenUsage>>): TokenUsage {
  const acc = emptyUsage();
  for (const u of items) addUsageInPlace(acc, u);
  return acc;
}

/** Cache hit rate in [0,1]: cached input tokens over all input tokens. */
export function cacheHitRate(u: Pick<TokenUsage, "input" | "cached">): number {
  if (!u.input) return 0;
  return Math.min(1, Math.max(0, u.cached / u.input));
}

export function isEmptyUsage(u: TokenUsage): boolean {
  return u.total === 0 && u.input === 0 && u.output === 0 && u.requests === 0;
}
