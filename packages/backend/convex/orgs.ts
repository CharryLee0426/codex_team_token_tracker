import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { identityOrg, requireOrgMember, requireUser, publicUser } from "./lib/auth";

/**
 * Upsert the active Clerk organization and the caller's membership in it.
 * The org id must match the `org_id` claim in the caller's JWT, so a user can only
 * register memberships Clerk has actually granted them.
 */
export const ensureCurrentOrg = mutation({
  args: {
    clerkOrgId: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const claim = identityOrg(identity as unknown as Record<string, unknown>);
    if (!claim) {
      throw new ConvexError({
        code: "NO_ORG_CLAIM",
        message: "JWT has no org_id claim. Add org_id/org_role/org_slug/org_name to the Clerk 'convex' JWT template.",
      });
    }
    if (claim.clerkOrgId !== args.clerkOrgId) {
      throw new ConvexError({ code: "ORG_MISMATCH", message: "Active organization does not match token" });
    }
    if (!claim.name) {
      throw new ConvexError({ code: "NO_ORG_CLAIM", message: "JWT has no org_name claim. Update the Clerk 'convex' JWT template." });
    }
    const trustedProfile = { name: claim.name, slug: claim.slug ?? undefined };
    const now = Date.now();
    let org = await ctx.db
      .query("orgs")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .unique();
    if (!org) {
      const id = await ctx.db.insert("orgs", {
        clerkOrgId: args.clerkOrgId,
        ...trustedProfile,
        createdAt: now,
        updatedAt: now,
      });
      org = (await ctx.db.get(id))!;
    } else if (org.name !== trustedProfile.name || org.slug !== trustedProfile.slug) {
      // Images are not present in the signed claim; only the verified Clerk webhook updates them.
      await ctx.db.patch(org._id, { ...trustedProfile, updatedAt: now });
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", org!._id).eq("userId", user._id))
      .unique();
    if (!membership) {
      await ctx.db.insert("memberships", { orgId: org._id, userId: user._id, role: claim.role, createdAt: now, updatedAt: now });
    } else if (membership.role !== claim.role) {
      await ctx.db.patch(membership._id, { role: claim.role, updatedAt: now });
    }
    return org._id;
  },
});

export const byClerkId = query({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, { clerkOrgId }) => {
    const user = await requireUser(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const claim = identityOrg(identity as unknown as Record<string, unknown>);
    if (!claim || claim.clerkOrgId !== clerkOrgId) return null;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", clerkOrgId))
      .unique();
    if (!org) return null;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", org._id).eq("userId", user._id))
      .unique();
    if (!membership) return null;
    const count = (await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect()).length;
    return { id: org._id, name: org.name, slug: org.slug ?? null, imageUrl: org.imageUrl ?? null, role: membership.role, memberCount: count };
  },
});

/**
 * Legacy mirror lookup, restricted to the Clerk-signed active organization. Native and web clients
 * must discover switchable memberships through Clerk, then resolve the active one with `byClerkId`.
 */
export const myOrgs = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const claim = identityOrg(identity as unknown as Record<string, unknown>);
    if (!claim) return [];
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", claim.clerkOrgId))
      .unique();
    if (!org) return [];
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", org._id).eq("userId", user._id))
      .unique();
    if (!membership) return [];
    return [{ id: org._id, clerkOrgId: org.clerkOrgId, name: org.name, slug: org.slug ?? null, imageUrl: org.imageUrl ?? null, role: membership.role }];
  },
});

/** Members of an org with their last-seen device time and live state. */
export const members = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId);
    const memberships = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const out = [];
    for (const m of memberships) {
      const user = await ctx.db.get(m.userId);
      if (!user) continue;
      const devices = await ctx.db.query("devices").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
      const active = devices.filter((d) => !d.revokedAt);
      const lastSeenAt = active.reduce((a, d) => Math.max(a, d.lastSeenAt), 0) || null;
      const live = active
        .map((d) => d.live)
        .filter((l): l is NonNullable<typeof l> => !!l && Date.now() - l.updatedAt < 2 * 60 * 1000)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
      out.push({ ...publicUser(user), role: m.role, joinedAt: m.createdAt, deviceCount: active.length, lastSeenAt, live });
    }
    return out;
  },
});
