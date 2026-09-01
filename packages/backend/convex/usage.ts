import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgMember, requireUser, publicUser } from "./lib/auth";
import { compactRow } from "./ingest";
import type { Doc, Id } from "./_generated/dataModel";

const MAX_RANGE_MS = 62 * 24 * 3_600_000;
const scopeValidator = v.union(v.literal("personal"), v.literal("team"));

async function memberUsers(ctx: Parameters<typeof requireOrgMember>[0], orgId: Id<"orgs">): Promise<Doc<"users">[]> {
  const memberships = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const users: Doc<"users">[] = [];
  for (const m of memberships) {
    const u = await ctx.db.get(m.userId);
    if (u) users.push(u);
  }
  return users;
}

/**
 * Hourly usage rows (UTC hour buckets) for the personal or team scope in [from, to).
 * Clients split long ranges into ≤ 62-day chunks and convert to local time for rendering.
 */
export const hourly = query({
  args: { scope: scopeValidator, orgId: v.optional(v.id("orgs")), from: v.number(), to: v.number() },
  handler: async (ctx, { scope, orgId, from, to }) => {
    if (to <= from) return { rows: [], users: [] };
    if (to - from > MAX_RANGE_MS) throw new ConvexError({ code: "RANGE", message: "Range exceeds 62 days; chunk the request" });
    let users: Doc<"users">[];
    if (scope === "personal") {
      users = [await requireUser(ctx)];
    } else {
      if (!orgId) throw new ConvexError({ code: "NO_ORG", message: "orgId required for team scope" });
      await requireOrgMember(ctx, orgId);
      users = await memberUsers(ctx, orgId);
    }
    const rows = [];
    for (const u of users) {
      const r = await ctx.db
        .query("hourlyUsage")
        .withIndex("by_user_hour", (q) => q.eq("userId", u._id).gte("hourStart", from).lt("hourStart", to))
        .collect();
      for (const row of r) rows.push(compactRow(row));
    }
    rows.sort((a, b) => a.h - b.h);
    return { rows, users: users.map(publicUser) };
  },
});

export const recentSessions = query({
  args: { scope: scopeValidator, orgId: v.optional(v.id("orgs")), limit: v.optional(v.number()) },
  handler: async (ctx, { scope, orgId, limit }) => {
    const n = Math.min(Math.max(limit ?? 20, 1), 100);
    let users: Doc<"users">[];
    if (scope === "personal") users = [await requireUser(ctx)];
    else {
      if (!orgId) throw new ConvexError({ code: "NO_ORG", message: "orgId required for team scope" });
      await requireOrgMember(ctx, orgId);
      users = await memberUsers(ctx, orgId);
    }
    const out = [];
    for (const u of users) {
      const rows = await ctx.db
        .query("sessions")
        .withIndex("by_user_lastActivity", (q) => q.eq("userId", u._id))
        .order("desc")
        .take(n);
      for (const s of rows) {
        out.push({
          id: s._id,
          user: publicUser(u),
          deviceId: s.deviceId,
          sessionId: s.sessionId,
          agent: s.agent ?? "codex",
          model: s.model,
          projectName: s.projectName ?? null,
          startedAt: s.startedAt,
          lastActivityAt: s.lastActivityAt,
          input: s.input, cached: s.cached, cacheWrite: s.cacheWrite, output: s.output, reasoning: s.reasoning,
          total: s.total, requests: s.requests, cost: s.cost,
          source: s.source ?? null,
          cliVersion: s.cliVersion ?? null,
        });
      }
    }
    out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    return out.slice(0, n);
  },
});

/** Devices that sent a heartbeat in the last 2 minutes (live "now" indicator). */
export const liveNow = query({
  args: { scope: scopeValidator, orgId: v.optional(v.id("orgs")) },
  handler: async (ctx, { scope, orgId }) => {
    let users: Doc<"users">[];
    if (scope === "personal") users = [await requireUser(ctx)];
    else {
      if (!orgId) throw new ConvexError({ code: "NO_ORG", message: "orgId required for team scope" });
      await requireOrgMember(ctx, orgId);
      users = await memberUsers(ctx, orgId);
    }
    const cutoff = Date.now() - 2 * 60 * 1000;
    const out = [];
    for (const u of users) {
      const devices = await ctx.db.query("devices").withIndex("by_user", (q) => q.eq("userId", u._id)).collect();
      for (const d of devices) {
        if (d.revokedAt || !d.live || d.live.updatedAt < cutoff) continue;
        out.push({ user: publicUser(u), deviceId: d._id, deviceName: d.name, platform: d.platform, live: d.live });
      }
    }
    return out;
  },
});

export const myDevices = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const devices = await ctx.db.query("devices").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    return devices
      .filter((d) => !d.revokedAt)
      .map((d) => ({
        id: d._id, name: d.name, platform: d.platform, hostname: d.hostname ?? null, appVersion: d.appVersion ?? null,
        timezone: d.timezone ?? null, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, live: d.live ?? null,
      }));
  },
});

export const revokeDevice = mutation({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    const user = await requireUser(ctx);
    const device = await ctx.db.get(deviceId);
    if (!device || device.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Device not found" });
    await ctx.db.patch(deviceId, { revokedAt: Date.now(), live: undefined });
    return null;
  },
});
