import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { priceFields } from "./schema";
import { DEFAULT_PRICING, computeAggregateCost, resolvePrice, type ModelPrice } from "@codex-tracker/shared/pricing";
import type { TokenUsage } from "@codex-tracker/shared/usage";
import {
  OPENAI_PRICING_URL,
  buildPricingEntries,
  entriesToTable,
  openAIModelPageUrl,
  parseLongContextRule,
  parseOpenAIPricingPage,
  pricingEntriesKey,
  validatePricingEntries,
  type LongContextRule,
  type PricingEntry,
} from "@codex-tracker/shared/openai-pricing-page";
import type { PricingTableResponse } from "@codex-tracker/shared/wire";

// ---------------------------------------------------------------------------------------------------
// Pricing lives here, not on the devices.
//
// Devices upload token counts; every stored `cost` is computed by this backend from those counts and
// the price table in force. The table is read from OpenAI's public pricing page on a schedule
// (`refresh`, see `crons.ts`) and kept as `pricingSnapshots` rows — a new one only when a rate moved.
// Whenever the table changes (a fetched change, or an admin override), `repriceAll` walks the stored
// rows so history is always priced at the current list prices. Before the first successful refresh
// the bundled seed table from `@codex-tracker/shared` applies.
//
// Admin commands (run against the target deployment; `--prod` for production):
//
//   npx convex run pricing:refresh                                              # fetch now
//   npx convex run pricing:setOverride '{"model":"gpt-6-astra","input":10,"cachedInput":1,"output":50}'
//   npx convex run pricing:clearOverride '{"model":"gpt-6-astra"}'
//   npx convex run pricing:repriceAll '{}'                                      # re-price stored rows
// ---------------------------------------------------------------------------------------------------

type Ctx = QueryCtx | MutationCtx;

const REPRICE_BATCH = 200;
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "codex-token-tracker pricing refresh (+https://github.com/CharryLee0426/codex_team_token_tracker)";

/** The bundled table, in snapshot form. */
export function seedEntries(): PricingEntry[] {
  return Object.entries(DEFAULT_PRICING)
    .map(([model, price]) => ({ model, source: "builtin" as const, ...price }))
    .sort((a, b) => a.model.localeCompare(b.model));
}

async function latestSnapshot(ctx: Ctx): Promise<Doc<"pricingSnapshots"> | null> {
  return await ctx.db.query("pricingSnapshots").withIndex("by_createdAt").order("desc").first();
}

async function status(ctx: Ctx): Promise<Doc<"pricingStatus"> | null> {
  return await ctx.db.query("pricingStatus").first();
}

async function patchStatus(ctx: MutationCtx, patch: Partial<Omit<Doc<"pricingStatus">, "_id" | "_creationTime">>) {
  const s = await status(ctx);
  if (s) await ctx.db.patch(s._id, patch);
  else await ctx.db.insert("pricingStatus", { checkedAt: patch.checkedAt ?? Date.now(), ...patch });
}

export interface EffectivePricing {
  snapshot: Doc<"pricingSnapshots"> | null;
  entries: PricingEntry[];
  /** `resolvePrice`-ready table: the snapshot (or seed) with overrides applied. */
  table: Record<string, ModelPrice>;
}

/** The table the backend bills with right now. */
export async function effectivePricing(ctx: Ctx): Promise<EffectivePricing> {
  const snapshot = await latestSnapshot(ctx);
  const byModel = new Map<string, PricingEntry>((snapshot?.entries ?? seedEntries()).map((e) => [e.model, e]));
  for (const o of await ctx.db.query("pricingOverrides").collect()) {
    byModel.set(o.model, {
      model: o.model,
      source: "override",
      input: o.input,
      cachedInput: o.cachedInput,
      output: o.output,
      ...(o.cacheWrite === undefined ? {} : { cacheWrite: o.cacheWrite }),
      ...(o.long === undefined ? {} : { long: o.long }),
    });
  }
  const entries = [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
  return { snapshot, entries, table: entriesToTable(entries) };
}

type Usage = Pick<TokenUsage, "input" | "cached" | "cacheWrite" | "output">;
type LongShare = TokenUsage | undefined;

/**
 * A long-context share must be a subset of its aggregate; anything else is a client bug and is
 * ignored rather than billed (the aggregate then prices at the standard tier — the safe direction).
 */
export function sanitizeLong(usage: TokenUsage, long: TokenUsage | undefined | null): LongShare {
  if (!long) return undefined;
  const keys: Array<keyof TokenUsage> = ["input", "cached", "cacheWrite", "output", "reasoning", "total", "requests"];
  for (const k of keys) {
    if (!Number.isFinite(long[k]) || long[k] < 0 || long[k] > usage[k]) return undefined;
  }
  return long.requests === 0 && long.input === 0 && long.output === 0 ? undefined : long;
}

/** USD for one aggregate (an hour's usage on one model, a session's usage on one model). */
export function priceUsage(table: Record<string, ModelPrice>, model: string, usage: Usage, long?: Partial<TokenUsage> | null): number {
  const cost = computeAggregateCost(usage, resolvePrice(model, table).price, long ?? undefined);
  return Number.isFinite(cost) && cost >= 0 ? cost : 0;
}

// ---------------------------------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------------------------------

/** The current table and where it came from (menubar local display, dashboard pricing panel). */
export const current = query({
  args: {},
  handler: async (ctx): Promise<PricingTableResponse> => {
    const { snapshot, entries } = await effectivePricing(ctx);
    const s = await status(ctx);
    return {
      entries,
      version: snapshot?._id ?? null,
      fetchedAt: snapshot?.fetchedAt ?? null,
      checkedAt: s?.checkedAt ?? null,
      lastError: s?.lastError ?? null,
      sourceUrl: OPENAI_PRICING_URL,
    };
  },
});

// ---------------------------------------------------------------------------------------------------
// Refresh from OpenAI
// ---------------------------------------------------------------------------------------------------

async function fetchText(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: "text/html", "user-agent": USER_AGENT }, signal: ctl.signal });
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function ruleOf(entry: PricingEntry): LongContextRule | null {
  if (!entry.long || entry.input <= 0 || entry.output <= 0) return null;
  return { threshold: entry.long.threshold, inputMultiplier: entry.long.input / entry.input, outputMultiplier: entry.long.output / entry.output };
}

function sameBaseRate(a: PricingEntry, b: { input: number; cachedInput: number | null; cacheWrite: number | null; output: number }): boolean {
  return a.input === b.input && a.cachedInput === (b.cachedInput ?? b.input) && (a.cacheWrite ?? null) === b.cacheWrite && a.output === b.output;
}

/** What the action needs before it can decide which model pages to consult. */
export const refreshContext = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ previous: PricingEntry[]; previousKey: string | null }> => {
    const snapshot = await latestSnapshot(ctx);
    return { previous: snapshot?.entries ?? seedEntries(), previousKey: snapshot?.key ?? null };
  },
});

/**
 * Read OpenAI's pricing page and commit a new snapshot when the table changed. Runs hourly (see
 * `crons.ts`); safe to run by hand at any time. A page that cannot be read or parsed leaves the
 * current snapshot in force and records the error on `pricingStatus`.
 *
 * The long-context rule is stated on each model's own page, so those are consulted only for models
 * whose base rate is new or changed since the previous table; unchanged models keep their tier. That
 * keeps a quiet hourly check to a single request.
 */
export const refresh = internalAction({
  args: {},
  handler: async (ctx): Promise<{ changed: boolean; models: number; error: string | null }> => {
    const { previous }: { previous: PricingEntry[]; previousKey: string | null } = await ctx.runQuery(internal.pricing.refreshContext, {});
    const fetchedAt = Date.now();
    let entries: PricingEntry[];
    try {
      const page = parseOpenAIPricingPage(await fetchText(OPENAI_PRICING_URL));
      if (!page.rows.length) throw new Error("no price tables found on the pricing page (layout changed?)");

      const previousByModel = new Map(previous.map((e) => [e.model, e]));
      const explicit = new Set(page.longContext.map((r) => r.model));
      const longRules: Record<string, LongContextRule | null> = {};
      const consult: string[] = [];
      for (const row of page.rows) {
        if (explicit.has(row.model)) continue;
        const prev = previousByModel.get(row.model);
        if (prev && sameBaseRate(prev, row)) {
          // Unchanged rate: the tier we already know still applies (a label alone never downgrades it).
          const rule = ruleOf(prev);
          if (rule || row.shortContextLimit === null) longRules[row.model] = rule;
          continue;
        }
        if (row.latest) consult.push(row.model);
      }
      const pages = await Promise.allSettled(consult.map((model) => fetchText(openAIModelPageUrl(model))));
      pages.forEach((r, i) => {
        const model = consult[i];
        if (r.status === "fulfilled") {
          longRules[model] = parseLongContextRule(r.value);
        } else {
          // Unreadable model page: keep the tier we had, or OpenAI's standing rule for a labelled row.
          const prev = previousByModel.get(model);
          const rule = prev ? ruleOf(prev) : null;
          if (rule) longRules[model] = rule;
          else if (page.rows.find((x) => x.model === model)?.shortContextLimit === null) {
            console.warn(`pricing refresh: could not read ${model}'s model page (${String(r.reason)}); pricing it flat`);
            longRules[model] = null;
          }
        }
      });

      entries = buildPricingEntries(page, { seed: DEFAULT_PRICING, longRules });
      const problem = validatePricingEntries(entries);
      if (problem) throw new Error(problem);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`pricing refresh failed: ${error}`);
      await ctx.runMutation(internal.pricing.recordCheck, { checkedAt: fetchedAt, error });
      return { changed: false, models: 0, error };
    }
    const { changed }: { changed: boolean } = await ctx.runMutation(internal.pricing.commitSnapshot, {
      fetchedAt,
      sourceUrl: OPENAI_PRICING_URL,
      key: pricingEntriesKey(entries),
      entries,
    });
    return { changed, models: entries.length, error: null };
  },
});

export const recordCheck = internalMutation({
  args: { checkedAt: v.number(), error: v.optional(v.string()) },
  handler: async (ctx, { checkedAt, error }) => {
    await patchStatus(ctx, { checkedAt, ...(error === undefined ? { okAt: checkedAt, lastError: undefined } : { lastError: error }) });
  },
});

const entryValidator = v.object({
  model: v.string(),
  source: v.union(v.literal("openai"), v.literal("alias"), v.literal("builtin"), v.literal("override")),
  ...priceFields,
});

/** Store a fetched table when it differs from the one in force, and re-price history against it. */
export const commitSnapshot = internalMutation({
  args: { fetchedAt: v.number(), sourceUrl: v.string(), key: v.string(), entries: v.array(entryValidator) },
  handler: async (ctx, { fetchedAt, sourceUrl, key, entries }): Promise<{ changed: boolean; snapshotId: Id<"pricingSnapshots"> | null }> => {
    const now = Date.now();
    const latest = await latestSnapshot(ctx);
    if (latest && latest.key === key) {
      await patchStatus(ctx, { checkedAt: now, okAt: now, lastError: undefined });
      return { changed: false, snapshotId: latest._id };
    }
    const snapshotId = await ctx.db.insert("pricingSnapshots", { createdAt: now, fetchedAt, sourceUrl, key, entries });
    await patchStatus(ctx, { checkedAt: now, okAt: now, lastError: undefined });
    await scheduleReprice(ctx);
    return { changed: true, snapshotId };
  },
});

// ---------------------------------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------------------------------

/** Pin a model's rate (USD / 1M tokens) regardless of what the page says; also used for models it does not list. */
export const setOverride = internalMutation({
  args: { model: v.string(), ...priceFields, cachedInput: v.optional(v.number()), note: v.optional(v.string()) },
  handler: async (ctx, { model: raw, note, ...price }) => {
    const model = raw.trim().toLowerCase();
    if (!model) throw new ConvexError({ code: "BAD_MODEL", message: "model is required" });
    const rates = [price.input, price.output, price.cachedInput ?? price.input, price.cacheWrite ?? 0];
    if (price.long) rates.push(price.long.threshold, price.long.input, price.long.cachedInput, price.long.output, price.long.cacheWrite ?? 0);
    if (rates.some((r) => !Number.isFinite(r) || r < 0)) throw new ConvexError({ code: "BAD_PRICE", message: "rates must be finite and >= 0" });
    const now = Date.now();
    const doc = {
      model,
      input: price.input,
      cachedInput: price.cachedInput ?? price.input,
      output: price.output,
      cacheWrite: price.cacheWrite,
      long: price.long,
      note,
      updatedAt: now,
    };
    const existing = await ctx.db.query("pricingOverrides").withIndex("by_model", (q) => q.eq("model", model)).unique();
    if (existing) await ctx.db.replace(existing._id, { ...doc, createdAt: existing.createdAt });
    else await ctx.db.insert("pricingOverrides", { ...doc, createdAt: now });
    await scheduleReprice(ctx);
    return { model, replaced: Boolean(existing) };
  },
});

export const clearOverride = internalMutation({
  args: { model: v.string() },
  handler: async (ctx, { model: raw }) => {
    const model = raw.trim().toLowerCase();
    const existing = await ctx.db.query("pricingOverrides").withIndex("by_model", (q) => q.eq("model", model)).unique();
    if (!existing) return { model, removed: false };
    await ctx.db.delete(existing._id);
    await scheduleReprice(ctx);
    return { model, removed: true };
  },
});

// ---------------------------------------------------------------------------------------------------
// Re-pricing stored rows
// ---------------------------------------------------------------------------------------------------

async function scheduleReprice(ctx: MutationCtx) {
  const now = Date.now();
  await patchStatus(ctx, { repriceStartedAt: now, repriceFinishedAt: undefined, repriced: 0 });
  await ctx.scheduler.runAfter(0, internal.pricing.repriceAll, { startedAt: now });
}

/**
 * Recompute every stored cost from its token counts and the table in force, one batch per
 * transaction. Idempotent and safe to run at any time: a row whose cost already matches is left
 * alone. Rows from clients older than wire 3 carry no long-context split and are billed at the
 * standard tier throughout — a lower bound for models with a long tier — until that device re-syncs.
 */
export const repriceAll = internalMutation({
  args: {
    startedAt: v.optional(v.number()),
    table: v.optional(v.union(v.literal("hourlyUsage"), v.literal("sessions"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    repriced: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ done: boolean; repriced: number }> => {
    const startedAt = args.startedAt ?? Date.now();
    const which = args.table ?? "hourlyUsage";
    let repriced = args.repriced ?? 0;
    const { table } = await effectivePricing(ctx);
    const now = Date.now();

    if (which === "hourlyUsage") {
      const page = await ctx.db.query("hourlyUsage").paginate({ cursor: args.cursor ?? null, numItems: REPRICE_BATCH });
      for (const row of page.page) {
        let touched = false;
        const models = row.models.map((m) => {
          const cost = priceUsage(table, m.model, m, sanitizeLong(m, m.long));
          if (cost === m.cost) return m;
          touched = true;
          return { ...m, cost };
        });
        if (!touched) continue;
        repriced++;
        await ctx.db.patch(row._id, { models, cost: models.reduce((s, m) => s + m.cost, 0), updatedAt: now });
      }
      if (!page.isDone) {
        await ctx.scheduler.runAfter(0, internal.pricing.repriceAll, { startedAt, table: "hourlyUsage", cursor: page.continueCursor, repriced });
        return { done: false, repriced };
      }
      await ctx.scheduler.runAfter(0, internal.pricing.repriceAll, { startedAt, table: "sessions", cursor: null, repriced });
      return { done: false, repriced };
    }

    const page = await ctx.db.query("sessions").paginate({ cursor: args.cursor ?? null, numItems: REPRICE_BATCH });
    for (const s of page.page) {
      const priced = priceSession(table, s);
      if (priced.cost === s.cost && !priced.modelsChanged) continue;
      repriced++;
      await ctx.db.patch(s._id, { cost: priced.cost, ...(priced.models ? { models: priced.models } : {}), updatedAt: now });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.pricing.repriceAll, { startedAt, table: "sessions", cursor: page.continueCursor, repriced });
      return { done: false, repriced };
    }
    await patchStatus(ctx, { repriceStartedAt: startedAt, repriceFinishedAt: now, repriced });
    return { done: true, repriced };
  },
});

type SessionLike = Pick<Doc<"sessions">, "model" | "input" | "cached" | "cacheWrite" | "output" | "reasoning" | "total" | "requests" | "cost" | "models">;

/** A session's cost: the sum over its per-model breakdown when the client sent one, else its totals at its last model. */
export function priceSession(table: Record<string, ModelPrice>, s: SessionLike): { cost: number; models?: Doc<"sessions">["models"]; modelsChanged: boolean } {
  if (s.models && s.models.length) {
    let modelsChanged = false;
    const models = s.models.map((m) => {
      const cost = priceUsage(table, m.model, m, sanitizeLong(m, m.long));
      if (cost !== m.cost) modelsChanged = true;
      return { ...m, cost };
    });
    return { cost: models.reduce((sum, m) => sum + m.cost, 0), models, modelsChanged };
  }
  return { cost: priceUsage(table, s.model, s), modelsChanged: false };
}

/** Kick off the first fetch when a deployment has never read the page (called from ingest). */
export async function ensureRefreshScheduled(ctx: MutationCtx) {
  if (await latestSnapshot(ctx)) return;
  if (await status(ctx)) return; // a refresh already ran or is running
  await patchStatus(ctx, { checkedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.pricing.refresh, {});
}
