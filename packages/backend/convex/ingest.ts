import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireDevice, publicUser } from "./lib/auth";
import { usageFields, liveValidator } from "./schema";
import { MAX_BUCKETS_PER_PUSH, MAX_SESSIONS_PER_PUSH } from "@codex-tracker/shared/wire";
import { isMachineId } from "@codex-tracker/shared/device-identity";
import { noteMachineId } from "./devices";
import type { Doc } from "./_generated/dataModel";

const bucketValidator = v.object({ hourStart: v.number(), model: v.string(), agent: v.optional(v.string()), ...usageFields });

function sumModels(models: Array<{ input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number; requests: number; cost: number }>) {
  const t = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0, requests: 0, cost: 0 };
  for (const m of models) {
    t.input += m.input; t.cached += m.cached; t.cacheWrite += m.cacheWrite; t.output += m.output;
    t.reasoning += m.reasoning; t.total += m.total; t.requests += m.requests; t.cost += m.cost;
  }
  return t;
}

export function compactRow(r: Doc<"hourlyUsage">) {
  return {
    h: r.hourStart,
    u: r.userId as string,
    d: r.deviceId as string,
    i: r.input, c: r.cached, w: r.cacheWrite, o: r.output, r: r.reasoning, t: r.total, q: r.requests, usd: r.cost,
    m: r.models.map((m) => ({ model: m.model, agent: m.agent ?? "codex", i: m.input, c: m.cached, w: m.cacheWrite, o: m.output, r: m.reasoning, t: m.total, q: m.requests, usd: m.cost })),
  };
}

/** Identify the device token's owner (menubar "signed in as ..."). */
export const whoami = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { device, user } = await requireDevice(ctx, token);
    const memberships = await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const orgs = [];
    for (const m of memberships) {
      const org = await ctx.db.get(m.orgId);
      if (org) orgs.push({ id: org._id, name: org.name, role: m.role });
    }
    return { user: publicUser(user), device: { id: device._id, name: device.name, platform: device.platform, createdAt: device.createdAt }, orgs };
  },
});

/**
 * Upsert absolute (device, hour, model) values. Idempotent: the device recomputes buckets from its
 * local logs, so re-sending the same bucket overwrites rather than accumulates.
 */
export const pushHourly = mutation({
  args: { token: v.string(), buckets: v.array(bucketValidator) },
  handler: async (ctx, { token, buckets }) => {
    if (buckets.length > MAX_BUCKETS_PER_PUSH) {
      throw new ConvexError({ code: "TOO_MANY", message: `Send at most ${MAX_BUCKETS_PER_PUSH} buckets per push` });
    }
    const { device, user } = await requireDevice(ctx, token);
    const now = Date.now();
    const byHour = new Map<number, typeof buckets>();
    for (const b of buckets) {
      if (!Number.isFinite(b.hourStart) || b.hourStart % 3_600_000 !== 0) continue;
      const list = byHour.get(b.hourStart) ?? [];
      list.push(b);
      byHour.set(b.hourStart, list);
    }
    let upserted = 0;
    for (const [hourStart, list] of byHour) {
      const existing = await ctx.db
        .query("hourlyUsage")
        .withIndex("by_device_hour", (q) => q.eq("deviceId", device._id).eq("hourStart", hourStart))
        .unique();
      type ModelEntry = { model: string; agent?: string; input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number; requests: number; cost: number };
      const keyOf = (m: { model: string; agent?: string }) => `${m.agent ?? "codex"}|${m.model}`;
      const models = new Map<string, ModelEntry>();
      for (const m of existing?.models ?? []) models.set(keyOf(m), m);
      for (const b of list) {
        models.set(keyOf(b), {
          model: b.model, agent: b.agent ?? "codex", input: b.input, cached: b.cached, cacheWrite: b.cacheWrite, output: b.output,
          reasoning: b.reasoning, total: b.total, requests: b.requests, cost: b.cost,
        });
      }
      const arr = [...models.values()].filter((m) => m.total > 0 || m.requests > 0);
      const totals = sumModels(arr);
      if (existing) {
        await ctx.db.patch(existing._id, { models: arr, ...totals, updatedAt: now });
      } else {
        await ctx.db.insert("hourlyUsage", { userId: user._id, deviceId: device._id, hourStart, models: arr, ...totals, updatedAt: now });
      }
      upserted++;
    }
    await ctx.db.patch(device._id, { lastSeenAt: now });
    return { upserted };
  },
});

const sessionValidator = v.object({
  sessionId: v.string(),
  agent: v.optional(v.string()),
  model: v.string(),
  projectName: v.union(v.string(), v.null()),
  cwdHash: v.union(v.string(), v.null()),
  startedAt: v.number(),
  lastActivityAt: v.number(),
  ...usageFields,
  source: v.union(v.string(), v.null()),
  cliVersion: v.union(v.string(), v.null()),
});

export const pushSessions = mutation({
  args: { token: v.string(), sessions: v.array(sessionValidator) },
  handler: async (ctx, { token, sessions }) => {
    if (sessions.length > MAX_SESSIONS_PER_PUSH) {
      throw new ConvexError({ code: "TOO_MANY", message: `Send at most ${MAX_SESSIONS_PER_PUSH} sessions per push` });
    }
    const { device, user } = await requireDevice(ctx, token);
    const now = Date.now();
    for (const s of sessions) {
      const agent = s.agent ?? "codex";
      const candidates = await ctx.db
        .query("sessions")
        .withIndex("by_device_session", (q) => q.eq("deviceId", device._id).eq("sessionId", s.sessionId))
        .collect();
      // The existing index narrows this to one session id. Filter the small candidate set by the
      // normalized agent in memory, avoiding a blocking index build on populated deployments.
      // Rows written before `agent` existed represent native Codex and are adopted here.
      const existing = candidates.find((candidate) => (candidate.agent ?? "codex") === agent) ?? null;
      const doc = {
        userId: user._id,
        deviceId: device._id,
        sessionId: s.sessionId,
        agent,
        model: s.model,
        projectName: s.projectName ?? undefined,
        cwdHash: s.cwdHash ?? undefined,
        startedAt: s.startedAt,
        lastActivityAt: s.lastActivityAt,
        input: s.input, cached: s.cached, cacheWrite: s.cacheWrite, output: s.output, reasoning: s.reasoning,
        total: s.total, requests: s.requests, cost: s.cost,
        source: s.source ?? undefined,
        cliVersion: s.cliVersion ?? undefined,
        updatedAt: now,
      };
      if (existing) await ctx.db.patch(existing._id, doc);
      else await ctx.db.insert("sessions", doc);
    }
    return { upserted: sessions.length };
  },
});

/**
 * Liveness + the "live now" snapshot. Also where a machine's identity is reconciled: the heartbeat's
 * `machineId` is backfilled onto devices created before 0.3.0, and duplicate device rows for the same
 * machine (a tray app and an agent that each ran `login`) are folded together — see `devices.ts`.
 */
export const heartbeat = mutation({
  args: {
    token: v.string(),
    appVersion: v.string(),
    platform: v.string(),
    hostname: v.union(v.string(), v.null()),
    timezone: v.string(),
    live: v.union(v.null(), v.object({
      sessionId: v.union(v.string(), v.null()),
      model: v.union(v.string(), v.null()),
      tokensPerSecond: v.number(),
      lastEventAt: v.union(v.number(), v.null()),
      todayTotal: v.number(),
      todayCost: v.number(),
    })),
    machineId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { device, login } = await requireDevice(ctx, args.token);
    const now = Date.now();
    const isCanonical = login._id === device._id;
    await ctx.db.patch(device._id, {
      lastSeenAt: now,
      appVersion: args.appVersion,
      timezone: args.timezone,
      live: args.live ? { ...args.live, updatedAt: now } : undefined,
      // An alias (e.g. the WSL agent of a Windows tray device) must not relabel the machine.
      ...(isCanonical ? { platform: args.platform, hostname: args.hostname ?? undefined } : {}),
    });
    if (!isCanonical) await ctx.db.patch(login._id, { lastSeenAt: now, appVersion: args.appVersion });
    if (isMachineId(args.machineId)) await noteMachineId(ctx, device, login, args.machineId, now);
    return { ok: true, serverTime: now };
  },
});

/** The owner's hourly rows across devices (menubar merges these with its local data). */
export const remoteHourly = query({
  args: { token: v.string(), from: v.number(), to: v.number(), includeSelf: v.optional(v.boolean()) },
  handler: async (ctx, { token, from, to, includeSelf }) => {
    const { device, user } = await requireDevice(ctx, token);
    if (to - from > 400 * 24 * 3_600_000) throw new ConvexError({ code: "RANGE", message: "Range too large" });
    const rows = await ctx.db
      .query("hourlyUsage")
      .withIndex("by_user_hour", (q) => q.eq("userId", user._id).gte("hourStart", from).lt("hourStart", to))
      .collect();
    return rows.filter((r) => includeSelf || r.deviceId !== device._id).map(compactRow);
  },
});
