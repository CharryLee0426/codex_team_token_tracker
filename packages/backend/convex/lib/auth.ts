import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sha256Hex } from "@codex-tracker/shared/sha256";
import { ConvexError } from "convex/values";

type Ctx = QueryCtx | MutationCtx;

export interface IdentityOrg {
  clerkOrgId: string;
  role: string;
  slug: string | null;
  name: string | null;
}

export async function getIdentity(ctx: Ctx) {
  return await ctx.auth.getUserIdentity();
}

export async function currentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

/** Upsert the signed-in user from Clerk identity claims. Shared by `users.ensureUser` and invite redemption. */
export async function upsertIdentityUser(ctx: MutationCtx): Promise<Id<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const now = Date.now();
  const fields = {
    email: identity.email ?? undefined,
    name: identity.name ?? identity.nickname ?? undefined,
    imageUrl: identity.pictureUrl ?? undefined,
  };
  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (existing) {
    const changed = existing.email !== fields.email || existing.name !== fields.name || existing.imageUrl !== fields.imageUrl;
    if (changed) await ctx.db.patch(existing._id, { ...fields, updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("users", { clerkId: identity.subject, ...fields, createdAt: now, updatedAt: now });
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (!user) throw new ConvexError({ code: "NO_USER", message: "User record missing; call users.ensureUser first" });
  return user;
}

/** Organization claims from the Clerk JWT template ("convex"): org_id / org_role / org_slug / org_name. */
export function identityOrg(identity: Record<string, unknown> | null | undefined): IdentityOrg | null {
  if (!identity) return null;
  const id = identity["org_id"];
  if (typeof id !== "string" || !id) return null;
  return {
    clerkOrgId: id,
    role: typeof identity["org_role"] === "string" ? (identity["org_role"] as string) : "member",
    slug: typeof identity["org_slug"] === "string" ? (identity["org_slug"] as string) : null,
    name: typeof identity["org_name"] === "string" ? (identity["org_name"] as string) : null,
  };
}

export async function requireOrgMember(ctx: Ctx, orgId: Id<"orgs">) {
  const user = await requireUser(ctx);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", user._id))
    .unique();
  if (!membership) throw new ConvexError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  const org = await ctx.db.get(orgId);
  if (!org) throw new ConvexError({ code: "NOT_FOUND", message: "Organization not found" });
  return { user, membership, org };
}

/**
 * Org admin gate for privileged actions (invite links). The role comes from the Clerk-signed JWT
 * (`org_role`) rather than the mirrored membership row, and the token's active organization must be
 * the one being acted on.
 */
export async function requireOrgAdmin(ctx: Ctx, orgId: Id<"orgs">) {
  const { user, membership, org } = await requireOrgMember(ctx, orgId);
  const identity = await ctx.auth.getUserIdentity();
  const claim = identityOrg(identity as unknown as Record<string, unknown>);
  if (!claim || claim.clerkOrgId !== org.clerkOrgId) {
    throw new ConvexError({ code: "ORG_MISMATCH", message: "Switch to this organization before managing it" });
  }
  if (claim.role !== "org:admin") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Only organization admins can manage invite links" });
  }
  return { user, membership, org };
}

/**
 * Non-throwing counterpart to `requireOrgAdmin`, for read paths that should degrade to "nothing to
 * show". A throwing query takes the whole page down with it, and admin-ness can legitimately be
 * false here — a token minted before an org switch, or a JWT template without the `org_role` claim.
 */
export async function isOrgAdmin(ctx: Ctx, orgId: Id<"orgs">): Promise<boolean> {
  const user = await currentUser(ctx);
  if (!user) return false;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", user._id))
    .unique();
  if (!membership) return false;
  const org = await ctx.db.get(orgId);
  if (!org) return false;
  const identity = await ctx.auth.getUserIdentity();
  const claim = identityOrg(identity as unknown as Record<string, unknown>);
  return !!claim && claim.clerkOrgId === org.clerkOrgId && claim.role === "org:admin";
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

/**
 * Resolve a device token (menubar/agent) to its device + user.
 *
 * `login` is the row the token was minted for; `device` is the canonical row usage is stored under —
 * the same row unless this login was folded into an earlier login from the same machine (`mergedInto`).
 * Aliases are never chained: merging always re-points them at the final canonical device.
 */
export async function requireDevice(ctx: Ctx, token: string) {
  if (!token || token.length < 16) throw new ConvexError({ code: "BAD_TOKEN", message: "Invalid device token" });
  const login = await ctx.db
    .query("devices")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hashToken(token)))
    .unique();
  if (!login || login.revokedAt) throw new ConvexError({ code: "BAD_TOKEN", message: "Device token revoked or unknown" });
  let device = login;
  if (login.mergedInto) {
    const canonical = await ctx.db.get(login.mergedInto);
    if (!canonical) throw new ConvexError({ code: "BAD_TOKEN", message: "Device record missing" });
    device = canonical;
  }
  if (device.revokedAt) throw new ConvexError({ code: "BAD_TOKEN", message: "Device token revoked or unknown" });
  const user = await ctx.db.get(device.userId);
  if (!user) throw new ConvexError({ code: "BAD_TOKEN", message: "Device owner missing" });
  return { device, login, user };
}

export function publicUser(u: Doc<"users">) {
  return { id: u._id, name: u.name ?? null, email: u.email ?? null, imageUrl: u.imageUrl ?? null };
}
