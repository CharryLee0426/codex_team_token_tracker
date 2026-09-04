import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const usageFields = {
  input: v.number(),
  cached: v.number(),
  cacheWrite: v.number(),
  output: v.number(),
  reasoning: v.number(),
  total: v.number(),
  requests: v.number(),
  cost: v.number(),
};

/** `agent` = tool that produced the usage ("codex" | "pi" | "hermes" | custom); absent means "codex". */
export const modelUsageValidator = v.object({ model: v.string(), agent: v.optional(v.string()), ...usageFields });

export const liveValidator = v.object({
  sessionId: v.union(v.string(), v.null()),
  model: v.union(v.string(), v.null()),
  tokensPerSecond: v.number(),
  lastEventAt: v.union(v.number(), v.null()),
  todayTotal: v.number(),
  todayCost: v.number(),
  updatedAt: v.number(),
});

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    /** When the dashboard's guided tour was finished or skipped; unset = it opens on the next visit. */
    onboardedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerkId", ["clerkId"]),

  orgs: defineTable({
    clerkOrgId: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerkOrgId", ["clerkOrgId"]),

  memberships: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    role: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_user", ["orgId", "userId"]),

  /**
   * Reusable organization invite links ("/j/<code>"). Unlike a Clerk email invitation these are not
   * bound to an address: anyone holding the code can redeem it until it expires, runs out of seats
   * or is revoked. `code` is the only secret — org, role and limits are resolved server-side.
   */
  orgInvites: defineTable({
    code: v.string(),
    orgId: v.id("orgs"),
    clerkOrgId: v.string(),
    role: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
    /** 0 = unlimited seats (still bounded by `expiresAt`). */
    maxUses: v.number(),
    usedCount: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_org", ["orgId"]),

  /** One row per (invite, redeemer): makes redemption idempotent and gives admins an audit trail. */
  orgInviteUses: defineTable({
    inviteId: v.id("orgInvites"),
    userId: v.id("users"),
    status: v.string(), // pending | joined
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_invite", ["inviteId"])
    .index("by_invite_user", ["inviteId", "userId"]),

  /**
   * One row per *login* (`codex-tracker login`), but usage is stored per *machine*: the first login
   * from a machine is its canonical device, and later logins from the same machine — the tray app and
   * the headless agent, or a re-login — are aliases whose `mergedInto` points at it. A device token
   * always resolves to the canonical row (see `lib/auth.requireDevice`), so hourly rows and sessions
   * for one machine live under one device id and are never counted twice.
   */
  devices: defineTable({
    userId: v.id("users"),
    name: v.string(),
    platform: v.string(),
    hostname: v.optional(v.string()),
    tokenHash: v.string(),
    appVersion: v.optional(v.string()),
    timezone: v.optional(v.string()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    revokedAt: v.optional(v.number()),
    live: v.optional(liveValidator),
    /** Hashed hardware identity reported by clients ≥ 0.3.0 (`shared/device-identity.ts`). */
    machineId: v.optional(v.string()),
    /** Set on aliases: the canonical device of the same machine that owns this login's usage. */
    mergedInto: v.optional(v.id("devices")),
    /** Throttle for the duplicate sweep that runs on heartbeats. */
    dedupCheckedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_tokenHash", ["tokenHash"])
    .index("by_user_machine", ["userId", "machineId"]),

  deviceAuthRequests: defineTable({
    code: v.string(),
    pollSecretHash: v.string(),
    status: v.string(), // pending | approved | consumed | denied | expired
    deviceName: v.string(),
    platform: v.string(),
    hostname: v.optional(v.string()),
    machineId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    deviceId: v.optional(v.id("devices")),
    tokenPlain: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_expiresAt", ["expiresAt"]),

  /** One row per (device, UTC hour). All timestamps are UTC ms; rendering converts to the viewer's local time. */
  hourlyUsage: defineTable({
    userId: v.id("users"),
    deviceId: v.id("devices"),
    hourStart: v.number(),
    models: v.array(modelUsageValidator),
    ...usageFields,
    updatedAt: v.number(),
  })
    .index("by_user_hour", ["userId", "hourStart"])
    .index("by_device_hour", ["deviceId", "hourStart"]),

  sessions: defineTable({
    userId: v.id("users"),
    deviceId: v.id("devices"),
    sessionId: v.string(),
    agent: v.optional(v.string()),
    model: v.string(),
    projectName: v.optional(v.string()),
    cwdHash: v.optional(v.string()),
    startedAt: v.number(),
    lastActivityAt: v.number(),
    ...usageFields,
    source: v.optional(v.string()),
    cliVersion: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_device_session", ["deviceId", "sessionId"])
    .index("by_user_lastActivity", ["userId", "lastActivityAt"]),
});
