import { mutation, query } from "./_generated/server";
import { currentUser, publicUser } from "./lib/auth";

/** Upsert the signed-in user from Clerk identity claims. Call once on dashboard load. */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
    const fields = {
      email: identity.email ?? undefined,
      name: identity.name ?? identity.nickname ?? undefined,
      imageUrl: identity.pictureUrl ?? undefined,
    };
    if (existing) {
      const changed =
        existing.email !== fields.email || existing.name !== fields.name || existing.imageUrl !== fields.imageUrl;
      if (changed) await ctx.db.patch(existing._id, { ...fields, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("users", { clerkId: identity.subject, ...fields, createdAt: now, updatedAt: now });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    return user ? publicUser(user) : null;
  },
});
