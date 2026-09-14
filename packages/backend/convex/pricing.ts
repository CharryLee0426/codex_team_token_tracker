import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  DEFAULT_PRICING,
  FALLBACK_PRICE_KEY,
  computeCost,
  resolvePrice,
  type ModelPrice,
} from "@codex-tracker/shared/pricing";

// ---------------------------------------------------------------------------------------------------
// Admin backfill: re-price usage that devices already uploaded, after a correction to the pricing
// table. Costs are computed on each device and stored verbatim, so a table fix only reaches history
// once every machine re-syncs; this repairs the stored rows instead of waiting for machines that may
// never re-scan (or whose transcripts have since been pruned).
//
// Run from the CLI against the target deployment:
//
//   npx convex run pricing:reprice '{"model":"gpt-6-astra","apply":false}' --prod   # dry run
//   npx convex run pricing:reprice '{"model":"gpt-6-astra","apply":true}'  --prod   # write
//
// Take a snapshot first (`npx convex export --prod`): this rewrites stored costs in place.
// ---------------------------------------------------------------------------------------------------

/**
 * An aggregate row covers many requests, so the long-context tier — selected per request from that
 * request's own prompt size — cannot be recovered from it. Re-pricing an aggregate therefore uses the
 * standard tier, matching `computeCost`'s documented contract for pre-aggregated rows. Requests that
 * crossed the threshold stay under-priced, so a re-priced row is a lower bound on the true cost.
 */
function standardTier(price: ModelPrice): ModelPrice {
  const { long: _long, ...flat } = price;
  return flat;
}

/**
 * Costs are float sums of per-request costs, so a row re-priced from its aggregate lands a few ULPs
 * away from what the device computed. The generations being told apart differ by multiples, never by
 * parts per million, so this tolerance cannot confuse them.
 */
function near(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9 + Math.abs(expected) * 1e-6;
}

const staleValidator = v.object({
  input: v.number(),
  cachedInput: v.number(),
  output: v.number(),
  cacheWrite: v.optional(v.number()),
});

/**
 * Re-price every stored entry for one model, in a single transaction (all of it lands, or none does).
 *
 * Only entries whose stored cost still matches `stale` are rewritten. Anything else — a device that
 * already re-synced at the corrected rate, or a session that mixed this model with another and so was
 * never costed at a single rate — is left untouched and reported. That guard also makes the migration
 * idempotent: a second run finds no entry at the stale rate and writes nothing.
 *
 * `stale` defaults to the global fallback price, which is what a model was costed at before it was
 * given its own row in the table.
 */
export const reprice = internalMutation({
  args: { model: v.string(), apply: v.boolean(), stale: v.optional(staleValidator) },
  handler: async (ctx, { model, apply, stale }) => {
    const match = resolvePrice(model);
    if (match.estimated || match.matchedKey !== model) {
      throw new Error(
        `${model} has no exact entry in the pricing table (resolved to ${match.matchedKey ?? "the global fallback"}); ` +
          `re-pricing onto an inferred rate is not supported`,
      );
    }
    const target = standardTier(match.price);
    const before: ModelPrice = stale ?? standardTier(DEFAULT_PRICING[FALLBACK_PRICE_KEY]);
    if (computeCost({ input: 1e6, output: 1e6 }, before) === computeCost({ input: 1e6, output: 1e6 }, target)) {
      throw new Error(`stale and target prices for ${model} are identical; nothing to re-price`);
    }

    const now = Date.now();
    const skipped: Array<Record<string, string | number>> = [];
    let hourlyRows = 0;
    let hourlyEntries = 0;
    let hourlyDelta = 0;
    let sessions = 0;
    let sessionDelta = 0;
    let scanned = 0;

    for await (const row of ctx.db.query("hourlyUsage")) {
      scanned++;
      if (!row.models.some((m) => m.model === model)) continue;
      let touched = false;
      const models = row.models.map((m) => {
        if (m.model !== model) return m;
        const expected = computeCost(m, before);
        if (!near(m.cost, expected)) {
          if (skipped.length < 25) {
            skipped.push({ table: "hourlyUsage", id: row._id, agent: m.agent ?? "codex", stored: m.cost, atStale: expected, atTarget: computeCost(m, target) });
          }
          return m;
        }
        const cost = computeCost(m, target);
        if (cost === m.cost) return m;
        touched = true;
        hourlyEntries++;
        hourlyDelta += cost - m.cost;
        return { ...m, cost };
      });
      if (!touched) continue;
      hourlyRows++;
      // `cost` is the sum of the model entries for every row in this table; keep that exact.
      if (apply) await ctx.db.patch(row._id, { models, cost: models.reduce((s, m) => s + m.cost, 0), updatedAt: now });
    }

    for await (const s of ctx.db.query("sessions")) {
      scanned++;
      if (s.model !== model) continue;
      const expected = computeCost(s, before);
      if (!near(s.cost, expected)) {
        if (skipped.length < 25) {
          skipped.push({ table: "sessions", id: s._id, agent: s.agent ?? "codex", stored: s.cost, atStale: expected, atTarget: computeCost(s, target) });
        }
        continue;
      }
      const cost = computeCost(s, target);
      if (cost === s.cost) continue;
      sessions++;
      sessionDelta += cost - s.cost;
      if (apply) await ctx.db.patch(s._id, { cost, updatedAt: now });
    }

    return {
      apply,
      model,
      stalePrice: before,
      targetPrice: target,
      scanned,
      hourlyUsage: { rows: hourlyRows, entries: hourlyEntries, delta: hourlyDelta },
      sessions: { rows: sessions, delta: sessionDelta },
      skipped,
    };
  },
});
