import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { DatabaseReader, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizeHostname, usageOverlapVerdict, type HourFingerprint, type OverlapVerdict } from "@codex-tracker/shared/device-identity";

/**
 * One device per machine.
 *
 * Every `codex-tracker login` inserts a `devices` row (it carries that login's token), but a machine's
 * usage must live under exactly one row or the dashboard counts it once per login. Two mechanisms keep
 * that true:
 *
 *  1. Logins that report a `machineId` (clients ≥ 0.3.0) are matched to the user's canonical device
 *     for that machine at approval time (`deviceAuth.approve`) and inserted as aliases of it.
 *  2. Heartbeats run a throttled sweep (`sweepDuplicates`) that finds other canonical devices of the
 *     same user that are the same machine — same machineId, or, for rows created before machine ids
 *     existed, the same hostname *and* identical hourly counts — and folds them into this one.
 *
 * Folding (`mergeDevices`) marks the loser as an alias (`mergedInto`) so its token keeps working, and
 * schedules `moveUsage`, which re-keys its hourly rows and sessions onto the canonical device in
 * batches. Where both rows have data for an hour the more recently updated copy wins; nothing is summed.
 */

/** Do not rerun the duplicate sweep for a device more often than this. */
export const DEDUP_INTERVAL_MS = 10 * 60 * 1000;
/** Hourly rows of the other device that the overlap test looks at (its most recent ones). */
const OVERLAP_PROBE_HOURS = 40;
/** Rows re-keyed per `moveUsage` invocation; it reschedules itself until nothing is left. */
const MOVE_BATCH = 100;

type Device = Doc<"devices">;

function fingerprint(r: Doc<"hourlyUsage">): HourFingerprint {
  return {
    hourStart: r.hourStart,
    total: r.total,
    requests: r.requests,
    models: r.models.map((m) => ({ agent: m.agent ?? "codex", model: m.model, total: m.total, requests: m.requests })),
  };
}

function deviceHost(d: Device): string {
  return normalizeHostname(d.hostname ?? d.name);
}

/** The user's canonical (non-alias) device for a machine id, if any. */
export async function canonicalDeviceFor(ctx: MutationCtx, userId: Id<"users">, machineId: string): Promise<Device | null> {
  const rows = await ctx.db
    .query("devices")
    .withIndex("by_user_machine", (q) => q.eq("userId", userId).eq("machineId", machineId))
    .collect();
  const canonical = rows.filter((d) => !d.mergedInto).sort((a, b) => a.createdAt - b.createdAt);
  return canonical[0] ?? null;
}

/** Compare `b`'s most recent hours with `a`'s rows for the same hours. */
async function overlapVerdict(db: DatabaseReader, a: Device, b: Device): Promise<OverlapVerdict> {
  const probe = await db
    .query("hourlyUsage")
    .withIndex("by_device_hour", (q) => q.eq("deviceId", b._id))
    .order("desc")
    .take(OVERLAP_PROBE_HOURS);
  const pairs = [];
  for (const row of probe) {
    const other = await db
      .query("hourlyUsage")
      .withIndex("by_device_hour", (q) => q.eq("deviceId", a._id).eq("hourStart", row.hourStart))
      .unique();
    pairs.push({ probe: fingerprint(row), other: other ? fingerprint(other) : null });
  }
  return usageOverlapVerdict(pairs);
}

type SameMachineReason = "machineId" | "usage" | null;

/**
 * Are `a` and `b` the same physical machine? Equal machine ids settle it. Otherwise — a row from before
 * machine ids, or Windows and WSL seen through two OS identities — the same hostname plus identical
 * usage for overlapping hours does: a different computer never reproduces another's token counts.
 */
async function sameMachineReason(db: DatabaseReader, a: Device, b: Device): Promise<{ reason: SameMachineReason; verdict: OverlapVerdict | null }> {
  if (a.machineId && b.machineId && a.machineId === b.machineId) return { reason: "machineId", verdict: null };
  const host = deviceHost(a);
  if (!host || host !== deviceHost(b)) return { reason: null, verdict: null };
  const verdict = await overlapVerdict(db, a, b);
  return { reason: verdict.same ? "usage" : null, verdict };
}

async function sameMachine(ctx: MutationCtx, a: Device, b: Device): Promise<boolean> {
  return (await sameMachineReason(ctx.db, a, b)).reason !== null;
}

/** Make `from` an alias of `into` and move its usage over (asynchronously, in batches). */
export async function mergeDevices(ctx: MutationCtx, from: Device, into: Device): Promise<void> {
  if (from._id === into._id || into.mergedInto) return;
  await ctx.db.patch(from._id, { mergedInto: into._id, live: undefined });
  if (from.machineId && !into.machineId) await ctx.db.patch(into._id, { machineId: from.machineId });
  // Never chain aliases: anything that pointed at `from` now points at `into`.
  const siblings = await ctx.db.query("devices").withIndex("by_user", (q) => q.eq("userId", from.userId)).collect();
  for (const d of siblings) {
    if (d.mergedInto === from._id) await ctx.db.patch(d._id, { mergedInto: into._id });
  }
  await ctx.scheduler.runAfter(0, internal.devices.moveUsage, { from: from._id, into: into._id });
}

/**
 * Fold other canonical devices of this user that are really this machine into `device`. Runs from
 * heartbeats, so it is throttled per device; returns the (possibly re-read) canonical device.
 */
export async function sweepDuplicates(ctx: MutationCtx, device: Device, now: number): Promise<Device> {
  if (device.mergedInto) return device;
  if (device.dedupCheckedAt && now - device.dedupCheckedAt < DEDUP_INTERVAL_MS) return device;
  await ctx.db.patch(device._id, { dedupCheckedAt: now });
  const all = await ctx.db.query("devices").withIndex("by_user", (q) => q.eq("userId", device.userId)).collect();
  const candidates = all
    .filter((d) => d._id !== device._id && !d.mergedInto)
    .filter((d) => (device.machineId && d.machineId === device.machineId) || (deviceHost(d) !== "" && deviceHost(d) === deviceHost(device)))
    .sort((a, b) => a.createdAt - b.createdAt);
  let canonical = device;
  for (const other of candidates) {
    if (!(await sameMachine(ctx, canonical, other))) continue;
    // The device that is alive right now wins, so the process sending heartbeats keeps its identity;
    // a revoked twin is simply retired into it.
    await mergeDevices(ctx, other, canonical);
    canonical = (await ctx.db.get(canonical._id)) ?? canonical;
  }
  return canonical;
}

/**
 * Record the machine id a heartbeat carried. Backfills rows created before 0.3.0 the first time their
 * client reports one, then runs the duplicate sweep.
 */
export async function noteMachineId(ctx: MutationCtx, device: Device, login: Device, machineId: string, now: number): Promise<Device> {
  if (login._id !== device._id && login.machineId !== machineId) await ctx.db.patch(login._id, { machineId });
  if (!device.machineId) {
    await ctx.db.patch(device._id, { machineId });
    device = { ...device, machineId };
  }
  return sweepDuplicates(ctx, device, now);
}

function rowTotals(r: Doc<"hourlyUsage">) {
  return { input: r.input, cached: r.cached, cacheWrite: r.cacheWrite, output: r.output, reasoning: r.reasoning, total: r.total, requests: r.requests, cost: r.cost };
}

/** Follow `mergedInto` to the device that actually owns usage now (bounded; aliases are not chained by design). */
async function resolveCanonical(db: DatabaseReader, id: Id<"devices">): Promise<Device | null> {
  let d = await db.get(id);
  for (let hop = 0; d?.mergedInto && hop < 8; hop++) d = await db.get(d.mergedInto);
  return d;
}

/**
 * Re-key one batch of `from`'s hourly rows and sessions onto `into`; reschedules itself while rows remain.
 * `into` is resolved to its canonical device at run time, so a job scheduled before its target was itself
 * folded into another device still lands the rows where they are counted.
 */
export const moveUsage = internalMutation({
  args: { from: v.id("devices"), into: v.id("devices") },
  handler: async (ctx, { from, into: requested }) => {
    const target = await resolveCanonical(ctx.db, requested);
    if (!target || target._id === from) return { moved: 0, done: true };
    const into = target._id;
    let moved = 0;
    const rows = await ctx.db
      .query("hourlyUsage")
      .withIndex("by_device_hour", (q) => q.eq("deviceId", from))
      .take(MOVE_BATCH);
    for (const r of rows) {
      const existing = await ctx.db
        .query("hourlyUsage")
        .withIndex("by_device_hour", (q) => q.eq("deviceId", into).eq("hourStart", r.hourStart))
        .unique();
      if (!existing) {
        await ctx.db.patch(r._id, { deviceId: into, userId: target.userId });
      } else {
        if (r.updatedAt > existing.updatedAt) await ctx.db.patch(existing._id, { models: r.models, ...rowTotals(r), updatedAt: r.updatedAt });
        await ctx.db.delete(r._id);
      }
      moved++;
    }
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_device_session", (q) => q.eq("deviceId", from))
      .take(MOVE_BATCH);
    for (const s of sessions) {
      const agent = s.agent ?? "codex";
      const candidates = await ctx.db
        .query("sessions")
        .withIndex("by_device_session", (q) => q.eq("deviceId", into).eq("sessionId", s.sessionId))
        .collect();
      const existing = candidates.find((candidate) => (candidate.agent ?? "codex") === agent) ?? null;
      if (!existing) {
        await ctx.db.patch(s._id, { deviceId: into, userId: target.userId, agent });
      } else {
        if (s.updatedAt > existing.updatedAt) {
          const { _id: _i, _creationTime: _c, ...rest } = s;
          await ctx.db.patch(existing._id, { ...rest, deviceId: into, userId: target.userId, agent });
        } else if (existing.agent === undefined) {
          await ctx.db.patch(existing._id, { agent });
        }
        await ctx.db.delete(s._id);
      }
      moved++;
    }
    const done = rows.length < MOVE_BATCH && sessions.length < MOVE_BATCH;
    if (!done) await ctx.scheduler.runAfter(0, internal.devices.moveUsage, { from, into });
    return { moved, done };
  },
});

// ---------------------------------------------------------------------------------------------------
// Admin backfill: reconcile every user's devices at once instead of waiting for each machine's next
// heartbeat on 0.3.0. Run from the CLI against the target deployment:
//
//   npx convex run devices:auditDuplicates '{}'            # dry run: what would be merged, and why
//   npx convex run devices:dedupeAll '{"apply": true}'     # merge them (moves rows asynchronously)
//   npx convex run devices:auditDuplicates '{}'            # afterwards: `pending` counts fall to 0
//   npx convex run devices:mergePair '{"from": "<id>", "into": "<id>"}'   # one pair the heuristic missed
//
// Merging never sums two rows: where both devices hold an hour, the more recently uploaded copy wins,
// so a machine that was counted twice ends up counted once. The candidate rule is deliberately narrow
// (same machine id, or same hostname *and* identical hourly counts); pairs that only share a hostname
// are listed with their verdict but left alone.
// ---------------------------------------------------------------------------------------------------

interface DuplicateCandidate {
  user: string;
  userId: Id<"users">;
  keep: { id: Id<"devices">; name: string; platform: string; lastSeenAt: number; hourlyRows: number };
  retire: { id: Id<"devices">; name: string; platform: string; lastSeenAt: number; hourlyRows: number; revoked: boolean };
  /** Why they count as one machine; null = same hostname but the usage did not match, so untouched. */
  reason: SameMachineReason;
  verdict: OverlapVerdict | null;
}

async function hourlyRowCount(db: DatabaseReader, deviceId: Id<"devices">, cap = 5000): Promise<number> {
  const rows = await db
    .query("hourlyUsage")
    .withIndex("by_device_hour", (q) => q.eq("deviceId", deviceId))
    .take(cap);
  return rows.length;
}

/** Every pair of a user's canonical devices that might be one machine, with the merge verdict. */
async function findDuplicates(ctx: QueryCtx | MutationCtx, onlyUser?: Id<"users">): Promise<DuplicateCandidate[]> {
  const users = onlyUser ? [await ctx.db.get(onlyUser)].filter((u): u is Doc<"users"> => u !== null) : await ctx.db.query("users").collect();
  const out: DuplicateCandidate[] = [];
  for (const u of users) {
    const devices = await ctx.db.query("devices").withIndex("by_user", (q) => q.eq("userId", u._id)).collect();
    const canonical = devices.filter((d) => !d.mergedInto).sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 0; i < canonical.length; i++) {
      for (let j = i + 1; j < canonical.length; j++) {
        const a = canonical[i];
        const b = canonical[j];
        const sameId = !!a.machineId && a.machineId === b.machineId;
        const host = deviceHost(a);
        if (!sameId && (host === "" || host !== deviceHost(b))) continue;
        const { reason, verdict } = await sameMachineReason(ctx.db, a, b);
        // Keep the one a process is still using (most recently seen); the other becomes its alias.
        const [keep, retire] = b.lastSeenAt >= a.lastSeenAt ? [b, a] : [a, b];
        out.push({
          user: u.name ?? u.email ?? u._id,
          userId: u._id,
          keep: { id: keep._id, name: keep.name, platform: keep.platform, lastSeenAt: keep.lastSeenAt, hourlyRows: await hourlyRowCount(ctx.db, keep._id) },
          retire: { id: retire._id, name: retire.name, platform: retire.platform, lastSeenAt: retire.lastSeenAt, hourlyRows: await hourlyRowCount(ctx.db, retire._id), revoked: !!retire.revokedAt },
          reason,
          verdict,
        });
      }
    }
  }
  return out;
}

/** Dry run: candidate pairs, plus aliases whose rows are still being moved (`pending`). */
export const auditDuplicates = internalQuery({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, { userId }) => {
    const candidates = await findDuplicates(ctx, userId);
    const aliases = (await ctx.db.query("devices").collect()).filter((d) => d.mergedInto && (!userId || d.userId === userId));
    const pending = [];
    for (const d of aliases) {
      const rows = await hourlyRowCount(ctx.db, d._id, 1);
      const sessions = (await ctx.db.query("sessions").withIndex("by_device_session", (q) => q.eq("deviceId", d._id)).take(1)).length;
      if (rows || sessions) pending.push({ alias: d._id, into: d.mergedInto, name: d.name });
    }
    return {
      wouldMerge: candidates.filter((c) => c.reason !== null),
      sameHostnameButDifferentUsage: candidates.filter((c) => c.reason === null),
      pending,
    };
  },
});

/**
 * Apply the audit's `wouldMerge` list (or just report it when `apply` is false). Pairs are first joined
 * into clusters (A~B and B~C make one machine {A, B, C}); each cluster keeps its most recently seen
 * device and every other member is folded straight into it — never into one another, so no alias ever
 * points at another alias and no row-move job targets a device that is about to be retired.
 */
export const dedupeAll = internalMutation({
  args: { apply: v.boolean(), userId: v.optional(v.id("users")) },
  handler: async (ctx, { apply, userId }) => {
    const candidates = (await findDuplicates(ctx, userId)).filter((c) => c.reason !== null);
    // union-find over device ids
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      const p = parent.get(x) ?? x;
      if (p === x) return x;
      const root = find(p);
      parent.set(x, root);
      return root;
    };
    const union = (a: string, b: string) => parent.set(find(a), find(b));
    for (const c of candidates) union(c.keep.id, c.retire.id);
    const clusters = new Map<string, Set<Id<"devices">>>();
    for (const c of candidates) {
      const root = find(c.keep.id);
      const set = clusters.get(root) ?? new Set<Id<"devices">>();
      set.add(c.keep.id);
      set.add(c.retire.id);
      clusters.set(root, set);
    }
    const plan: Array<{ user: string; keep: string; retire: string[] }> = [];
    const merged: Array<{ user: string; retired: string; into: string }> = [];
    for (const ids of clusters.values()) {
      const devices = (await Promise.all([...ids].map((id) => ctx.db.get(id)))).filter((d): d is Device => d !== null && !d.mergedInto);
      if (devices.length < 2) continue;
      devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      const [keep, ...rest] = devices;
      const user = candidates.find((c) => c.keep.id === keep._id || c.retire.id === keep._id)?.user ?? String(keep.userId);
      plan.push({ user, keep: keep.name, retire: rest.map((d) => d.name) });
      if (!apply) continue;
      for (const from of rest) {
        await mergeDevices(ctx, from, keep);
        merged.push({ user, retired: from.name, into: keep.name });
      }
    }
    return { apply, candidates: candidates.length, plan, merged };
  },
});

/** Merge one explicit pair (same user) that the heuristic did not catch, e.g. after a hostname change. */
export const mergePair = internalMutation({
  args: { from: v.id("devices"), into: v.id("devices") },
  handler: async (ctx, { from, into }) => {
    const a = await ctx.db.get(from);
    const b = await ctx.db.get(into);
    if (!a || !b) throw new Error("device not found");
    if (a.userId !== b.userId) throw new Error("devices belong to different users");
    if (b.mergedInto) throw new Error("`into` is itself an alias; merge into its canonical device instead");
    if (a.mergedInto) return { ok: true, alreadyMerged: true };
    await mergeDevices(ctx, a, b);
    return { ok: true, alreadyMerged: false };
  },
});
