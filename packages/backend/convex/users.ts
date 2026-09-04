import { mutation, query } from "./_generated/server";
import { currentUser, publicUser, upsertIdentityUser } from "./lib/auth";

/** Upsert the signed-in user from Clerk identity claims. Call once on dashboard load. */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => await upsertIdentityUser(ctx),
});

/** The signed-in user, plus the onboarding flag only they need (`publicUser` is what other members see). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    return user ? { ...publicUser(user), onboardedAt: user.onboardedAt ?? null } : null;
  },
});

/**
 * Records that the guided tour was finished or skipped, so it stops opening by itself. Stored on the
 * account rather than in the browser: a new laptop or a cleared profile should not replay it.
 * Idempotent — the first completion wins, replays from Settings do not move the date.
 */
export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user || user.onboardedAt) return null;
    await ctx.db.patch(user._id, { onboardedAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});
