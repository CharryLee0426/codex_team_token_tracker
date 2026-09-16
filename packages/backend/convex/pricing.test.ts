/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import path from "node:path";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { DEFAULT_PRICING, LONG_CONTEXT_THRESHOLD, computeAggregateCost, computeCost, resolvePrice } from "@codex-tracker/shared/pricing";
import { OPENAI_PRICING_URL } from "@codex-tracker/shared/openai-pricing-page";
import { localDayKey } from "@codex-tracker/shared/time";
import { hashToken } from "./lib/auth";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 1_780_000_000_000 - (1_780_000_000_000 % 3_600_000);
const TOKEN = "cxt_test-device-token-0001";

/** One hour of gpt-6-astra usage, one request of which ran past the long-context threshold. */
const USAGE = { input: 500_000, cached: 300_000, cacheWrite: 20_000, output: 9_000, reasoning: 2_000, total: 509_000, requests: 5 };
const LONG = { input: 300_000, cached: 250_000, cacheWrite: 0, output: 3_000, reasoning: 1_000, total: 303_000, requests: 1 };
const SMALL = { input: 50_000, cached: 10_000, cacheWrite: 5_000, output: 1_000, reasoning: 100, total: 51_000, requests: 2 };

const FIXTURES = path.join(import.meta.dirname, "../../shared/src/__tests__/fixtures");
const PRICING_PAGE = readFileSync(path.join(FIXTURES, "openai-pricing-page.html"), "utf8");
const ASTRA_PAGE = readFileSync(path.join(FIXTURES, "openai-model-gpt-6-astra.html"), "utf8");

function createTest() {
  return convexTest(schema, modules);
}

async function seedDevice(t: ReturnType<typeof createTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "u1", createdAt: HOUR, updatedAt: HOUR });
    const deviceId = await ctx.db.insert("devices", {
      userId, name: "Mac", platform: "darwin", tokenHash: hashToken(TOKEN), createdAt: HOUR, lastSeenAt: HOUR,
    });
    return { userId, deviceId };
  });
}

/** Serve the fixture pages instead of developers.openai.com. */
function stubOpenAI(responses: Record<string, string | number> = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const body = responses[url] ?? (url === OPENAI_PRICING_URL ? PRICING_PAGE : url.includes("gpt-6-astra") ? ASTRA_PAGE : "<html>no rule</html>");
    if (typeof body === "number") return new Response("nope", { status: body });
    return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  }));
  return calls;
}

/** Run whatever `scheduler.runAfter` queued (the re-price sweep, a first refresh) to completion. */
async function settle(t: ReturnType<typeof createTest>) {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("hourly uploads are priced by the backend from their token counts, long-context share at the long tier", async () => {
  const t = createTest();
  const { deviceId } = await seedDevice(t);
  const astra = resolvePrice("gpt-6-astra").price;

  await t.mutation(api.ingest.pushHourly, {
    token: TOKEN,
    buckets: [
      // A wire-3 client: no `cost`, but the long-context split.
      { hourStart: HOUR, model: "gpt-6-astra", agent: "codex", ...USAGE, long: LONG },
      // A wire-2 client: its own (stale) cost is ignored, and with no split the standard tier applies throughout.
      { hourStart: HOUR, model: "gpt-5.5", agent: "pi", ...USAGE, cost: 0.01 },
    ],
  });

  const row = await t.run(async (ctx) => await ctx.db.query("hourlyUsage").withIndex("by_device_hour", (q) => q.eq("deviceId", deviceId)).unique());
  expect(row).not.toBeNull();
  const byModel = new Map(row!.models.map((m) => [m.model, m]));
  expect(byModel.get("gpt-6-astra")!.cost).toBeCloseTo(computeAggregateCost(USAGE, astra, LONG), 9);
  expect(byModel.get("gpt-6-astra")!.long).toEqual(LONG);
  expect(byModel.get("gpt-5.5")!.cost).toBeCloseTo(computeAggregateCost(USAGE, resolvePrice("gpt-5.5").price), 9);
  expect(byModel.get("gpt-5.5")!.cost).not.toBe(0.01);
  expect(byModel.get("gpt-5.5")!.long).toBeUndefined();
  expect(row!.cost).toBeCloseTo(byModel.get("gpt-6-astra")!.cost + byModel.get("gpt-5.5")!.cost, 9);

  // The long share equals what a device would have billed per request.
  const perRequest = computeCost(LONG, astra) + computeCost({ ...USAGE, input: USAGE.input - LONG.input, cached: USAGE.cached - LONG.cached, cacheWrite: USAGE.cacheWrite, output: USAGE.output - LONG.output }, astra);
  expect(byModel.get("gpt-6-astra")!.cost).toBeCloseTo(perRequest, 9);
});

test("a long-context share that is not a subset of its bucket is ignored, not billed", async () => {
  const t = createTest();
  await seedDevice(t);
  await t.mutation(api.ingest.pushHourly, {
    token: TOKEN,
    buckets: [{ hourStart: HOUR, model: "gpt-6-astra", agent: "codex", ...SMALL, long: { ...LONG, input: SMALL.input + 1 } }],
  });
  const row = await t.run(async (ctx) => await ctx.db.query("hourlyUsage").first());
  expect(row!.models[0].long).toBeUndefined();
  expect(row!.models[0].cost).toBeCloseTo(computeAggregateCost(SMALL, resolvePrice("gpt-6-astra").price), 9);
});

test("sessions are priced per model when the client sends the breakdown, else by their last model", async () => {
  const t = createTest();
  await seedDevice(t);
  const base = { projectName: "demo", cwdHash: null, startedAt: HOUR, lastActivityAt: HOUR + 1000, source: null, cliVersion: null };
  await t.mutation(api.ingest.pushSessions, {
    token: TOKEN,
    sessions: [
      { sessionId: "mixed", agent: "codex", model: "gpt-5.4-mini", ...base, ...USAGE, models: [
        { model: "gpt-6-astra", ...LONG, long: LONG },
        { model: "gpt-5.4-mini", input: 200_000, cached: 50_000, cacheWrite: 20_000, output: 6_000, reasoning: 1_000, total: 206_000, requests: 4 },
      ] },
      { sessionId: "legacy", agent: "codex", model: "gpt-6-astra", ...base, ...USAGE, cost: 123 },
    ],
  });
  const sessions = await t.run(async (ctx) => await ctx.db.query("sessions").collect());
  const mixed = sessions.find((s) => s.sessionId === "mixed")!;
  const legacy = sessions.find((s) => s.sessionId === "legacy")!;
  const astraPart = computeAggregateCost(LONG, resolvePrice("gpt-6-astra").price, LONG);
  const miniPart = computeAggregateCost({ input: 200_000, cached: 50_000, cacheWrite: 20_000, output: 6_000 }, resolvePrice("gpt-5.4-mini").price);
  expect(mixed.cost).toBeCloseTo(astraPart + miniPart, 9);
  expect(mixed.models!.map((m) => m.cost)).toEqual([expect.closeTo(astraPart, 9), expect.closeTo(miniPart, 9)]);
  expect(legacy.cost).toBeCloseTo(computeAggregateCost(USAGE, resolvePrice("gpt-6-astra").price), 9);
  expect(legacy.models).toBeUndefined();
});

test("refresh reads OpenAI's page into a snapshot once, re-prices history, and stays quiet when nothing changed", async () => {
  const t = createTest();
  const calls = stubOpenAI();
  await seedDevice(t);
  // History priced by the seed table.
  await t.mutation(api.ingest.pushHourly, { token: TOKEN, buckets: [{ hourStart: HOUR, model: "gpt-6-astra", agent: "codex", ...USAGE, long: LONG }] });
  await t.mutation(api.ingest.pushSessions, { token: TOKEN, sessions: [{ sessionId: "s", agent: "codex", model: "gpt-5.5", projectName: null, cwdHash: null, startedAt: HOUR, lastActivityAt: HOUR, source: null, cliVersion: null, ...SMALL }] });
  const before = await t.query(api.pricing.current, {});
  expect(before.version).toBeNull();
  expect(before.entries.every((e) => e.source === "builtin")).toBe(true);

  const first = await t.action(internal.pricing.refresh, {});
  expect(first).toEqual({ changed: true, models: expect.any(Number), error: null });
  // Unchanged rates keep the tier the seed already knew: only the page itself was fetched.
  expect(calls).toEqual([OPENAI_PRICING_URL]);

  const after = await t.query(api.pricing.current, {});
  expect(after.version).not.toBeNull();
  expect(after.fetchedAt).toEqual(expect.any(Number));
  expect(after.lastError).toBeNull();
  const byModel = new Map(after.entries.map((e) => [e.model, e]));
  expect(byModel.get("gpt-6-astra")).toMatchObject({ source: "openai", input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50, long: { threshold: LONG_CONTEXT_THRESHOLD, input: 20, cachedInput: 2, cacheWrite: 25, output: 75 } });
  expect(byModel.get("gpt-5.5-codex")?.source).toBe("alias");
  expect(byModel.get("codex-mini-latest")?.source).toBe("builtin");

  // The sweep ran (rates equal the seed, so costs are unchanged but the pass completed).
  await settle(t);
  const status = await t.run(async (ctx) => await ctx.db.query("pricingStatus").first());
  expect(status?.repriceFinishedAt).toEqual(expect.any(Number));
  expect(status?.repriced).toBe(0);

  // Same page again: no new snapshot, just a fresh check time.
  const second = await t.action(internal.pricing.refresh, {});
  expect(second.changed).toBe(false);
  const snapshots = await t.run(async (ctx) => await ctx.db.query("pricingSnapshots").collect());
  expect(snapshots).toHaveLength(1);
  expect((await t.query(api.pricing.current, {})).version).toBe(after.version);
});

test("a changed rate produces a new snapshot and re-prices every stored row", async () => {
  const t = createTest();
  await seedDevice(t);
  await t.mutation(api.ingest.pushHourly, { token: TOKEN, buckets: [{ hourStart: HOUR, model: "gpt-6-astra", agent: "codex", ...USAGE, long: LONG }, { hourStart: HOUR, model: "gpt-5.4-mini", agent: "codex", ...SMALL }] });
  await t.mutation(api.ingest.pushSessions, { token: TOKEN, sessions: [{ sessionId: "s", agent: "codex", model: "gpt-6-astra", projectName: null, cwdHash: null, startedAt: HOUR, lastActivityAt: HOUR, source: null, cliVersion: null, ...USAGE, models: [{ model: "gpt-6-astra", ...USAGE, long: LONG }] }] });

  // OpenAI doubles Astra's rates (and the model page still states the 2x / 1.5x rule).
  const doubled = PRICING_PAGE.replace("gpt-6-astra&quot;],[0,10],[0,1],[0,12.5],[0,50]", "gpt-6-astra&quot;],[0,20],[0,2],[0,25],[0,100]");
  expect(doubled).not.toBe(PRICING_PAGE);
  const calls = stubOpenAI({ [OPENAI_PRICING_URL]: doubled });
  const r = await t.action(internal.pricing.refresh, {});
  expect(r.changed).toBe(true);
  expect(calls).toContain("https://developers.openai.com/api/docs/models/gpt-6-astra");
  await settle(t);

  const astra = { input: 20, cachedInput: 2, cacheWrite: 25, output: 100, long: { threshold: LONG_CONTEXT_THRESHOLD, input: 40, cachedInput: 4, cacheWrite: 50, output: 150 } };
  const row = await t.run(async (ctx) => await ctx.db.query("hourlyUsage").first());
  const entry = row!.models.find((m) => m.model === "gpt-6-astra")!;
  expect(entry.cost).toBeCloseTo(computeAggregateCost(USAGE, astra, LONG), 9);
  expect(entry.cost).toBeCloseTo(2 * computeAggregateCost(USAGE, DEFAULT_PRICING["gpt-6-astra"], LONG), 9);
  expect(row!.cost).toBeCloseTo(entry.cost + row!.models.find((m) => m.model === "gpt-5.4-mini")!.cost, 9);
  const session = await t.run(async (ctx) => await ctx.db.query("sessions").first());
  expect(session!.cost).toBeCloseTo(entry.cost, 9);
  expect(session!.models![0].cost).toBeCloseTo(entry.cost, 9);
  const status = await t.run(async (ctx) => await ctx.db.query("pricingStatus").first());
  expect(status?.repriced).toBe(2);
});

test("an unreadable page keeps the current table and records the error", async () => {
  const t = createTest();
  stubOpenAI({ [OPENAI_PRICING_URL]: 503 });
  const r = await t.action(internal.pricing.refresh, {});
  expect(r.changed).toBe(false);
  expect(r.error).toMatch(/503/);
  const current = await t.query(api.pricing.current, {});
  expect(current.version).toBeNull();
  expect(current.lastError).toMatch(/503/);
  expect(current.checkedAt).toEqual(expect.any(Number));
  expect(await t.run(async (ctx) => await ctx.db.query("pricingSnapshots").collect())).toHaveLength(0);

  // A page whose tables cannot be found is rejected the same way.
  stubOpenAI({ [OPENAI_PRICING_URL]: "<html><body>Under maintenance</body></html>" });
  const r2 = await t.action(internal.pricing.refresh, {});
  expect(r2.error).toMatch(/no price tables/);
});

test("overrides win over the snapshot and re-price stored rows; clearing one re-prices again", async () => {
  const t = createTest();
  await seedDevice(t);
  await t.mutation(api.ingest.pushHourly, { token: TOKEN, buckets: [{ hourStart: HOUR, model: "gpt-5.4-mini", agent: "codex", ...SMALL }] });
  const seedCost = (await t.run(async (ctx) => await ctx.db.query("hourlyUsage").first()))!.cost;

  await t.mutation(internal.pricing.setOverride, { model: "GPT-5.4-mini", input: 3, output: 18, note: "negotiated" });
  await settle(t);
  const current = await t.query(api.pricing.current, {});
  expect(current.entries.find((e) => e.model === "gpt-5.4-mini")).toMatchObject({ source: "override", input: 3, cachedInput: 3, output: 18 });
  const overridden = (await t.run(async (ctx) => await ctx.db.query("hourlyUsage").first()))!.cost;
  expect(overridden).toBeCloseTo(computeAggregateCost(SMALL, { input: 3, cachedInput: 3, output: 18 }), 9);
  expect(overridden).not.toBeCloseTo(seedCost, 9);

  // New uploads use it too.
  await t.mutation(api.ingest.pushHourly, { token: TOKEN, buckets: [{ hourStart: HOUR + 3_600_000, model: "gpt-5.4-mini", agent: "codex", ...SMALL }] });
  const rows = await t.run(async (ctx) => await ctx.db.query("hourlyUsage").collect());
  expect(rows.map((r) => r.cost)).toEqual([expect.closeTo(overridden, 9), expect.closeTo(overridden, 9)]);

  expect(await t.mutation(internal.pricing.clearOverride, { model: "gpt-5.4-mini" })).toEqual({ model: "gpt-5.4-mini", removed: true });
  await settle(t);
  const restored = await t.run(async (ctx) => await ctx.db.query("hourlyUsage").collect());
  expect(restored.every((r) => Math.abs(r.cost - seedCost) < 1e-9)).toBe(true);
});

test("a heartbeat's today's-spend figure is computed by the backend, never taken from the device", async () => {
  const t = createTest();
  stubOpenAI(); // the first upload schedules a page refresh; keep it off the network and drain it below
  const { deviceId } = await seedDevice(t);
  const now = Date.now();
  const thisHour = now - (now % 3_600_000);
  // Two hours today and one two days ago, all priced by the backend on upload.
  await t.mutation(api.ingest.pushHourly, { token: TOKEN, buckets: [
    { hourStart: thisHour, model: "gpt-5.4-mini", agent: "codex", ...SMALL },
    { hourStart: thisHour - 3_600_000, model: "gpt-5.4-mini", agent: "codex", ...SMALL },
    { hourStart: thisHour - 48 * 3_600_000, model: "gpt-5.4-mini", agent: "codex", ...SMALL },
  ] });
  const rows = await t.run(async (ctx) => await ctx.db.query("hourlyUsage").collect());
  const expected = rows.filter((r) => r.hourStart >= thisHour - 3_600_000).reduce((s, r) => s + r.cost, 0);

  const live = { sessionId: null, model: null, tokensPerSecond: 0, lastEventAt: null, todayTotal: 2 * SMALL.total };
  for (const sent of [live, { ...live, todayCost: 999 }]) {
    await t.mutation(api.ingest.heartbeat, { token: TOKEN, appVersion: "0.5.0", platform: "darwin", hostname: null, timezone: "UTC", live: sent });
    const device = await t.run(async (ctx) => await ctx.db.get(deviceId));
    // The UTC hour just before midnight can fall on yesterday; the assertion tolerates that boundary.
    const yesterdayHour = localDayKey(thisHour - 3_600_000, "UTC") !== localDayKey(thisHour, "UTC");
    expect(device!.live!.todayCost).toBeCloseTo(yesterdayHour ? expected / 2 : expected, 9);
    expect(device!.live!.todayCost).not.toBe(999);
  }
  // An unknown zone falls back to UTC instead of failing the heartbeat.
  await t.mutation(api.ingest.heartbeat, { token: TOKEN, appVersion: "0.5.0", platform: "darwin", hostname: null, timezone: "Mars/Olympus", live });
  expect((await t.run(async (ctx) => await ctx.db.get(deviceId)))!.live!.todayCost).toBeGreaterThan(0);
  await settle(t);
});

test("the first upload on a deployment that never fetched the page schedules a refresh", async () => {
  const t = createTest();
  const calls = stubOpenAI();
  await seedDevice(t);
  await t.mutation(api.ingest.pushHourly, { token: TOKEN, buckets: [{ hourStart: HOUR, model: "gpt-5.4-mini", agent: "codex", ...SMALL }] });
  await t.mutation(api.ingest.pushHourly, { token: TOKEN, buckets: [{ hourStart: HOUR + 3_600_000, model: "gpt-5.4-mini", agent: "codex", ...SMALL }] });
  await settle(t);
  expect(calls.filter((u) => u === OPENAI_PRICING_URL)).toHaveLength(1);
  expect((await t.query(api.pricing.current, {})).version).not.toBeNull();
});
