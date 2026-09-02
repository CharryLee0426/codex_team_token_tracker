import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { isOrgAdmin, requireOrgAdmin, requireOrgMember, upsertIdentityUser } from "./lib/auth";

/**
 * Reusable organization invite links.
 *
 * Clerk's own invitations are bound to one email address, so they cannot be pasted into a group chat.
 * These are the Slack/Discord shape instead: a random code that anyone can redeem until it expires,
 * runs out of seats or is revoked. The link carries nothing but the code — organization, role and
 * limits are resolved server-side, so a redeemer cannot promote themselves by editing the URL.
 *
 * Redemption is split in two because creating the Clerk membership happens outside Convex:
 * `reserve` takes a seat, the caller creates the membership through the Clerk Backend API, then
 * `finalize` either confirms the seat or releases it.
 */

/** Crockford-style base32 minus look-alikes (0/O, 1/I/L) so codes survive being read aloud. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Expiry choices offered in the UI; 7 days is the hard ceiling. */
export const INVITE_DAY_OPTIONS = [1, 3, 5, 7] as const;
const MAX_DAYS = 7;
const MAX_SEATS = 500;
const ROLES = ["org:member", "org:admin"] as const;

export type InviteStatus = "valid" | "expired" | "revoked" | "exhausted";

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

/** Codes are compared case-insensitively so a link typed by hand still resolves. */
function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function statusOf(invite: Doc<"orgInvites">, now: number): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt <= now) return "expired";
  if (invite.maxUses > 0 && invite.usedCount >= invite.maxUses) return "exhausted";
  return "valid";
}

function publicInvite(invite: Doc<"orgInvites">, now: number) {
  return {
    id: invite._id,
    code: invite.code,
    role: invite.role,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
    remaining: invite.maxUses > 0 ? Math.max(0, invite.maxUses - invite.usedCount) : null,
    status: statusOf(invite, now),
  };
}

async function byCode(ctx: QueryCtx | MutationCtx, code: string) {
  const normalized = normalizeCode(code);
  if (normalized.length !== CODE_LENGTH) return null;
  return await ctx.db
    .query("orgInvites")
    .withIndex("by_code", (q) => q.eq("code", normalized))
    .unique();
}

/** Create a shareable link for the active organization. Admins only. */
export const create = mutation({
  args: {
    orgId: v.id("orgs"),
    days: v.number(),
    /** 0 = unlimited seats (still bounded by the expiry). */
    maxUses: v.optional(v.number()),
    role: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, days, maxUses, role }) => {
    const { user, org } = await requireOrgAdmin(ctx, orgId);
    if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) {
      throw new ConvexError({ code: "BAD_EXPIRY", message: `Expiry must be between 1 and ${MAX_DAYS} days` });
    }
    const seats = Math.floor(maxUses ?? 0);
    if (!Number.isFinite(seats) || seats < 0 || seats > MAX_SEATS) {
      throw new ConvexError({ code: "BAD_SEATS", message: `Seat limit must be between 0 (unlimited) and ${MAX_SEATS}` });
    }
    const inviteRole = role ?? "org:member";
    if (!(ROLES as readonly string[]).includes(inviteRole)) {
      throw new ConvexError({ code: "BAD_ROLE", message: "Role must be org:member or org:admin" });
    }

    const now = Date.now();
    // Re-roll on the (vanishingly unlikely) collision rather than trusting 60 bits blindly.
    let code = randomCode();
    for (let i = 0; i < 5 && (await byCode(ctx, code)); i++) code = randomCode();
    if (await byCode(ctx, code)) throw new ConvexError({ code: "RETRY", message: "Could not allocate a code, try again" });

    const id = await ctx.db.insert("orgInvites", {
      code,
      orgId,
      clerkOrgId: org.clerkOrgId,
      role: inviteRole,
      createdBy: user._id,
      createdAt: now,
      expiresAt: now + Math.round(days * DAY_MS),
      maxUses: seats,
      usedCount: 0,
    });
    return publicInvite((await ctx.db.get(id))!, now);
  },
});

/** How many links the panel shows; older ones stay redeemable but drop off the list. */
const LIST_LIMIT = 50;

/**
 * Links issued for the org, newest first. Admins only — the code is the credential. Returns `null`
 * rather than throwing for non-admins, so a role mismatch hides the panel instead of erroring the
 * whole members page.
 */
export const listForOrg = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    if (!(await isOrgAdmin(ctx, orgId))) return null;
    const now = Date.now();
    const invites = await ctx.db
      .query("orgInvites")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(LIST_LIMIT);
    return invites.map((i) => publicInvite(i, now));
  },
});

export const revoke = mutation({
  args: { inviteId: v.id("orgInvites") },
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new ConvexError({ code: "NOT_FOUND", message: "Invite not found" });
    await requireOrgAdmin(ctx, invite.orgId);
    if (!invite.revokedAt) await ctx.db.patch(inviteId, { revokedAt: Date.now() });
    return null;
  },
});

/**
 * What a link shows before anyone signs in: enough to decide whether to accept, and nothing more
 * (no Clerk ids, no roster). Deliberately unauthenticated — holding the code is the credential.
 */
export const preview = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const invite = await byCode(ctx, code);
    if (!invite) return { status: "not_found" as const, org: null, expiresAt: null, remaining: null, role: null };
    const now = Date.now();
    const org = await ctx.db.get(invite.orgId);
    const memberCount = org
      ? (await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect()).length
      : 0;
    return {
      status: statusOf(invite, now),
      org: org ? { name: org.name, imageUrl: org.imageUrl ?? null, memberCount } : null,
      expiresAt: invite.expiresAt,
      remaining: invite.maxUses > 0 ? Math.max(0, invite.maxUses - invite.usedCount) : null,
      role: invite.role,
    };
  },
});

/**
 * Take a seat on behalf of the signed-in user and hand the caller what it needs to create the
 * Clerk membership. Idempotent: re-running for the same user returns the existing reservation
 * instead of burning another seat.
 */
export const reserve = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await upsertIdentityUser(ctx);
    if (!userId) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required" });
    const invite = await byCode(ctx, code);
    if (!invite) throw new ConvexError({ code: "NOT_FOUND", message: "This invite link is not valid" });
    const org = await ctx.db.get(invite.orgId);
    if (!org) throw new ConvexError({ code: "NOT_FOUND", message: "Organization no longer exists" });

    const now = Date.now();
    const existingUse = await ctx.db
      .query("orgInviteUses")
      .withIndex("by_invite_user", (q) => q.eq("inviteId", invite._id).eq("userId", userId))
      .unique();
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", org._id).eq("userId", userId))
      .unique();

    // Someone re-opening their own link (or already on the roster) must not be blocked by an
    // expired or exhausted invite — they are not consuming anything new.
    if (!existingUse && !membership) {
      const status = statusOf(invite, now);
      if (status !== "valid") throw new ConvexError({ code: status.toUpperCase(), message: `This invite link is ${status}` });
    }

    let useId = existingUse?._id ?? null;
    if (!existingUse) {
      useId = await ctx.db.insert("orgInviteUses", { inviteId: invite._id, userId, status: "pending", createdAt: now, updatedAt: now });
      await ctx.db.patch(invite._id, { usedCount: invite.usedCount + 1 });
    }
    return {
      useId: useId!,
      clerkOrgId: invite.clerkOrgId,
      role: invite.role,
      orgName: org.name,
      orgSlug: org.slug ?? null,
      alreadyMember: !!membership,
    };
  },
});

/** Confirm a reservation once Clerk accepted the membership, or release the seat if it did not. */
export const finalize = mutation({
  args: { useId: v.id("orgInviteUses"), ok: v.boolean() },
  handler: async (ctx, { useId, ok }) => {
    const use = await ctx.db.get(useId);
    if (!use) return null;
    const userId = await upsertIdentityUser(ctx);
    if (!userId || userId !== use.userId) throw new ConvexError({ code: "FORBIDDEN", message: "Not your reservation" });
    if (ok) {
      if (use.status !== "joined") await ctx.db.patch(useId, { status: "joined", updatedAt: Date.now() });
      return null;
    }
    // Roll the seat back so a failed Clerk call does not silently shrink the link.
    const invite = await ctx.db.get(use.inviteId);
    if (invite && invite.usedCount > 0) await ctx.db.patch(invite._id, { usedCount: invite.usedCount - 1 });
    await ctx.db.delete(useId);
    return null;
  },
});

/** Who has redeemed a given link. Admins only. */
export const usesForInvite = query({
  args: { inviteId: v.id("orgInvites") },
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new ConvexError({ code: "NOT_FOUND", message: "Invite not found" });
    await requireOrgMember(ctx, invite.orgId);
    const uses = await ctx.db
      .query("orgInviteUses")
      .withIndex("by_invite", (q) => q.eq("inviteId", inviteId))
      .order("desc")
      .take(MAX_SEATS);
    return uses.map((u) => ({ id: u._id, userId: u.userId, status: u.status, createdAt: u.createdAt }));
  },
});
