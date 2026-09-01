import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

function fullName(d: any): string | undefined {
  const n = [d?.first_name, d?.last_name].filter(Boolean).join(" ").trim();
  return n || d?.username || undefined;
}

function primaryEmail(d: any): string | undefined {
  const list: any[] = d?.email_addresses ?? [];
  const primary = list.find((e) => e.id === d?.primary_email_address_id) ?? list[0];
  return primary?.email_address ?? undefined;
}

/** Applies Clerk webhook events so org rosters stay in sync even for members who never open the dashboard. */
export const handleClerkEvent = internalMutation({
  args: { type: v.string(), data: v.any() },
  handler: async (ctx, { type, data }) => {
    const now = Date.now();

    async function upsertUser(clerkId: string, fields: { email?: string; name?: string; imageUrl?: string }) {
      const existing = await ctx.db.query("users").withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId)).unique();
      if (existing) {
        await ctx.db.patch(existing._id, { ...fields, updatedAt: now });
        return existing._id;
      }
      return await ctx.db.insert("users", { clerkId, ...fields, createdAt: now, updatedAt: now });
    }

    async function upsertOrg(o: any) {
      const existing = await ctx.db.query("orgs").withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", o.id)).unique();
      const fields = { name: o.name ?? "Organization", slug: o.slug ?? undefined, imageUrl: o.image_url ?? undefined };
      if (existing) {
        await ctx.db.patch(existing._id, { ...fields, updatedAt: now });
        return existing._id;
      }
      return await ctx.db.insert("orgs", { clerkOrgId: o.id, ...fields, createdAt: now, updatedAt: now });
    }

    switch (type) {
      case "user.created":
      case "user.updated": {
        await upsertUser(data.id, { email: primaryEmail(data), name: fullName(data), imageUrl: data.image_url ?? undefined });
        break;
      }
      case "user.deleted": {
        const u = await ctx.db.query("users").withIndex("by_clerkId", (q) => q.eq("clerkId", data.id)).unique();
        if (u) {
          const ms = await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", u._id)).collect();
          for (const m of ms) await ctx.db.delete(m._id);
          const ds = await ctx.db.query("devices").withIndex("by_user", (q) => q.eq("userId", u._id)).collect();
          for (const d of ds) await ctx.db.patch(d._id, { revokedAt: now, live: undefined });
        }
        break;
      }
      case "organization.created":
      case "organization.updated": {
        await upsertOrg(data);
        break;
      }
      case "organization.deleted": {
        const org = await ctx.db.query("orgs").withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", data.id)).unique();
        if (org) {
          const ms = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect();
          for (const m of ms) await ctx.db.delete(m._id);
          await ctx.db.delete(org._id);
        }
        break;
      }
      case "organizationMembership.created":
      case "organizationMembership.updated": {
        const orgId = await upsertOrg(data.organization);
        const pud = data.public_user_data ?? {};
        const userId = await upsertUser(pud.user_id, {
          name: fullName(pud),
          imageUrl: pud.image_url ?? undefined,
          email: pud.identifier?.includes("@") ? pud.identifier : undefined,
        });
        const existing = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId)).unique();
        const role = typeof data.role === "string" ? data.role : "org:member";
        if (existing) await ctx.db.patch(existing._id, { role, updatedAt: now });
        else await ctx.db.insert("memberships", { orgId, userId, role, createdAt: now, updatedAt: now });
        break;
      }
      case "organizationMembership.deleted": {
        const org = await ctx.db.query("orgs").withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", data.organization?.id)).unique();
        const user = await ctx.db.query("users").withIndex("by_clerkId", (q) => q.eq("clerkId", data.public_user_data?.user_id)).unique();
        if (org && user) {
          const m = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", org._id).eq("userId", user._id)).unique();
          if (m) await ctx.db.delete(m._id);
        }
        break;
      }
      default:
        break;
    }
    return null;
  },
});
