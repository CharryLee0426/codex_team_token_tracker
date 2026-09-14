/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import schema from "./schema";
import { DEFAULT_PRICING, FALLBACK_PRICE_KEY, computeCost } from "@codex-tracker/shared/pricing";

const modules = import.meta.glob("./**/*.ts");

interface RepriceReport {
  apply: boolean;
  model: string;
  scanned: number;
  hourlyUsage: { rows: number; entries: number; delta: number };
  sessions: { rows: number; delta: number };
  skipped: Array<Record<string, string | number>>;
}

/**
 * `internal.pricing.reprice`, addressed by name. A one-off migration module reaches the committed
 * `_generated` bindings only when `convex deploy` next regenerates them, and this test should not
 * have to wait for that to run.
 */
const reprice = makeFunctionReference<"mutation", { model: string; apply: boolean }, RepriceReport>("pricing:reprice");

const HOUR = 1_780_000_000_000 - (1_780_000_000_000 % 3_600_000);
const STALE = DEFAULT_PRICING[FALLBACK_PRICE_KEY];
const ASTRA = DEFAULT_PRICING["gpt-6-astra"];
const ASTRA_FLAT = { input: ASTRA.input, cachedInput: ASTRA.cachedInput, cacheWrite: ASTRA.cacheWrite, output: ASTRA.output };

/** A single request's worth of usage, small enough that no long-context tier is involved. */
const USAGE = { input: 100_000, cached: 60_000, cacheWrite: 10_000, output: 4_000, reasoning: 1_000, total: 104_000, requests: 7 };
/** Aggregate whose *total* input crosses 272K although no single request need have. */
const BIG = { input: 900_000, cached: 700_000, cacheWrite: 50_000, output: 20_000, reasoning: 5_000, total: 920_000, requests: 40 };

async function seed(t: ReturnType<typeof convexTest>, astraCost: number, otherCost: number, sessionCost: number) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "u1", createdAt: HOUR, updatedAt: HOUR });
    const deviceId = await ctx.db.insert("devices", {
      userId, name: "Mac", platform: "darwin", tokenHash: "h", createdAt: HOUR, lastSeenAt: HOUR,
    });
    const astra = { model: "gpt-6-astra", agent: "codex", ...USAGE, cost: astraCost };
    const other = { model: "gpt-5.5", agent: "codex", ...USAGE, cost: otherCost };
    const hourId = await ctx.db.insert("hourlyUsage", {
      userId, deviceId, hourStart: HOUR, models: [astra, other],
      input: USAGE.input * 2, cached: USAGE.cached * 2, cacheWrite: USAGE.cacheWrite * 2, output: USAGE.output * 2,
      reasoning: USAGE.reasoning * 2, total: USAGE.total * 2, requests: USAGE.requests * 2,
      cost: astraCost + otherCost, updatedAt: HOUR,
    });
    const sessionId = await ctx.db.insert("sessions", {
      userId, deviceId, sessionId: "s1", agent: "codex", model: "gpt-6-astra",
      startedAt: HOUR, lastActivityAt: HOUR, ...USAGE, cost: sessionCost, updatedAt: HOUR,
    });
    return { userId, deviceId, hourId, sessionId };
  });
}

test("re-prices only the target model, leaving other models and the row invariant intact", async () => {
  const t = convexTest(schema, modules);
  const staleAstra = computeCost(USAGE, STALE);
  const otherCost = computeCost(USAGE, DEFAULT_PRICING["gpt-5.5"]);
  const ids = await seed(t, staleAstra, otherCost, staleAstra);

  const dry = await t.mutation(reprice, { model: "gpt-6-astra", apply: false });
  expect(dry.hourlyUsage.entries).toBe(1);
  expect(dry.sessions.rows).toBe(1);
  expect(dry.skipped).toEqual([]);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(ids.hourId))!.models[0].cost).toBe(staleAstra); // dry run wrote nothing
  });

  const run = await t.mutation(reprice, { model: "gpt-6-astra", apply: true });
  expect(run.hourlyUsage.entries).toBe(1);
  const expected = computeCost(USAGE, ASTRA_FLAT);
  expect(expected).toBeGreaterThan(staleAstra);

  await t.run(async (ctx) => {
    const row = (await ctx.db.get(ids.hourId))!;
    expect(row.models[0].cost).toBeCloseTo(expected, 12);
    expect(row.models[1].cost).toBe(otherCost); // untouched
    expect(row.cost).toBeCloseTo(row.models[0].cost + row.models[1].cost, 12);
    expect(row.total).toBe(USAGE.total * 2); // token totals never move
    const s = (await ctx.db.get(ids.sessionId))!;
    expect(s.cost).toBeCloseTo(expected, 12);
  });
});

test("is idempotent: a second run finds nothing at the stale rate", async () => {
  const t = convexTest(schema, modules);
  const staleAstra = computeCost(USAGE, STALE);
  await seed(t, staleAstra, computeCost(USAGE, DEFAULT_PRICING["gpt-5.5"]), staleAstra);

  const first = await t.mutation(reprice, { model: "gpt-6-astra", apply: true });
  expect(first.hourlyUsage.entries).toBe(1);
  const second = await t.mutation(reprice, { model: "gpt-6-astra", apply: true });
  expect(second.hourlyUsage.entries).toBe(0);
  expect(second.sessions.rows).toBe(0);
  expect(second.hourlyUsage.delta).toBe(0);
  expect(second.skipped).toHaveLength(2); // both now sit at the corrected rate, and are reported
});

test("skips entries that were not costed at the stale rate", async () => {
  const t = convexTest(schema, modules);
  const mixed = computeCost(USAGE, STALE) * 1.4; // e.g. a session that spanned two models
  const ids = await seed(t, computeCost(USAGE, STALE), 0.5, mixed);

  const run = await t.mutation(reprice, { model: "gpt-6-astra", apply: true });
  expect(run.sessions.rows).toBe(0);
  expect(run.skipped.some((s: Record<string, string | number>) => s.table === "sessions" && s.id === ids.sessionId)).toBe(true);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(ids.sessionId))!.cost).toBe(mixed); // left exactly as found
  });
});

test("prices aggregates at the standard tier even when their summed input crosses the threshold", async () => {
  const t = convexTest(schema, modules);
  const stale = computeCost(BIG, STALE);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "u2", createdAt: HOUR, updatedAt: HOUR });
    const deviceId = await ctx.db.insert("devices", { userId, name: "Mac", platform: "darwin", tokenHash: "h2", createdAt: HOUR, lastSeenAt: HOUR });
    const hourId = await ctx.db.insert("hourlyUsage", {
      userId, deviceId, hourStart: HOUR,
      models: [{ model: "gpt-6-astra", agent: "codex", ...BIG, cost: stale }],
      ...BIG, cost: stale, updatedAt: HOUR,
    });
    return { hourId };
  });

  await t.mutation(reprice, { model: "gpt-6-astra", apply: true });
  await t.run(async (ctx) => {
    const got = (await ctx.db.get(ids.hourId))!.models[0].cost;
    expect(got).toBeCloseTo(computeCost(BIG, ASTRA_FLAT), 12);
    // the long tier would have doubled the input rates; an aggregate must not reach for it
    expect(got).toBeLessThan(computeCost(BIG, ASTRA.long!));
  });
});

test("refuses a model the table would only price by inference", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(reprice, { model: "gpt-6-nebula", apply: false })).rejects.toThrow(/no exact entry/);
});
