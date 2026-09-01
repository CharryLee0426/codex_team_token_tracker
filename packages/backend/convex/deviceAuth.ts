import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { hashToken, requireUser, publicUser } from "./lib/auth";
import { randomHex } from "@codex-tracker/shared/sha256";
import { DEVICE_AUTH_TTL_MS, DEVICE_TOKEN_PREFIX } from "@codex-tracker/shared/wire";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += "-";
    s += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return s;
}

function normalizeCode(code: string): string {
  const raw = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : code.toUpperCase();
}

/**
 * Device-authorization flow (menubar / headless agent):
 * 1. device calls `start` → gets a short code + poll secret
 * 2. user opens <dashboard>/cli-auth?code=XXXX-XXXX, signs in with Clerk (Google/GitHub) and approves
 * 3. device polls `poll` until approved and receives a long-lived device token
 */
export const start = mutation({
  args: { deviceName: v.string(), platform: v.string(), hostname: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    let code = makeCode();
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db.query("deviceAuthRequests").withIndex("by_code", (q) => q.eq("code", code)).unique();
      if (!clash) break;
      code = makeCode();
    }
    const pollSecret = randomHex(24);
    await ctx.db.insert("deviceAuthRequests", {
      code,
      pollSecretHash: hashToken(pollSecret),
      status: "pending",
      deviceName: args.deviceName.slice(0, 120),
      platform: args.platform.slice(0, 40),
      hostname: args.hostname?.slice(0, 120),
      createdAt: now,
      expiresAt: now + DEVICE_AUTH_TTL_MS,
    });
    return { code, pollSecret, expiresAt: now + DEVICE_AUTH_TTL_MS };
  },
});

export const poll = mutation({
  args: { code: v.string(), pollSecret: v.string() },
  handler: async (ctx, args) => {
    const req = await ctx.db.query("deviceAuthRequests").withIndex("by_code", (q) => q.eq("code", normalizeCode(args.code))).unique();
    if (!req || req.pollSecretHash !== hashToken(args.pollSecret)) {
      return { status: "expired" as const };
    }
    if (req.status === "pending" && Date.now() > req.expiresAt) {
      await ctx.db.patch(req._id, { status: "expired" });
      return { status: "expired" as const };
    }
    if (req.status === "approved" && req.tokenPlain && req.userId) {
      const token = req.tokenPlain;
      const user = await ctx.db.get(req.userId);
      await ctx.db.patch(req._id, { status: "consumed", tokenPlain: undefined });
      return {
        status: "approved" as const,
        token,
        deviceId: req.deviceId!,
        user: user ? publicUser(user) : null,
      };
    }
    if (req.status === "denied") return { status: "denied" as const };
    if (req.status === "consumed") return { status: "consumed" as const };
    return { status: "pending" as const };
  },
});

/** For the /cli-auth page: describe a pending request (signed-in users only). */
export const getRequest = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    await requireUser(ctx);
    const req = await ctx.db.query("deviceAuthRequests").withIndex("by_code", (q) => q.eq("code", normalizeCode(code))).unique();
    if (!req) return null;
    const expired = req.status === "pending" && Date.now() > req.expiresAt;
    return {
      code: req.code,
      deviceName: req.deviceName,
      platform: req.platform,
      hostname: req.hostname ?? null,
      status: expired ? "expired" : req.status,
      expiresAt: req.expiresAt,
    };
  },
});

export const approve = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx);
    const req = await ctx.db.query("deviceAuthRequests").withIndex("by_code", (q) => q.eq("code", normalizeCode(code))).unique();
    if (!req) throw new ConvexError({ code: "NOT_FOUND", message: "Unknown code" });
    if (req.status !== "pending") throw new ConvexError({ code: "BAD_STATE", message: `Request is ${req.status}` });
    if (Date.now() > req.expiresAt) {
      await ctx.db.patch(req._id, { status: "expired" });
      throw new ConvexError({ code: "EXPIRED", message: "Code expired; run login again on the device" });
    }
    const now = Date.now();
    const token = DEVICE_TOKEN_PREFIX + randomHex(32);
    const deviceId = await ctx.db.insert("devices", {
      userId: user._id,
      name: req.deviceName,
      platform: req.platform,
      hostname: req.hostname,
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
    });
    await ctx.db.patch(req._id, { status: "approved", userId: user._id, deviceId, tokenPlain: token });
    return { deviceName: req.deviceName, deviceId };
  },
});

export const deny = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    await requireUser(ctx);
    const req = await ctx.db.query("deviceAuthRequests").withIndex("by_code", (q) => q.eq("code", normalizeCode(code))).unique();
    if (req && req.status === "pending") await ctx.db.patch(req._id, { status: "denied" });
    return null;
  },
});

/** Cron: delete stale auth requests. */
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const stale = await ctx.db.query("deviceAuthRequests").withIndex("by_expiresAt", (q) => q.lt("expiresAt", cutoff)).take(500);
    for (const r of stale) await ctx.db.delete(r._id);
    return stale.length;
  },
});
