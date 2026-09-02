import { mutation, query } from "./_generated/server";
import { currentUser, publicUser, upsertIdentityUser } from "./lib/auth";

/** Upsert the signed-in user from Clerk identity claims. Call once on dashboard load. */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => await upsertIdentityUser(ctx),
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    return user ? publicUser(user) : null;
  },
});
