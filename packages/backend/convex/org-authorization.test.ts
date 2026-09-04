/// <reference types="vite/client" />

import type { UserIdentity } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function clerkIdentity(activeOrg?: string, role = "org:member"): Partial<UserIdentity> {
  return {
    subject: "clerk-user",
    issuer: "https://issuer.test",
    tokenIdentifier: "https://issuer.test|clerk-user",
    ...(activeOrg
      ? { org_id: activeOrg, org_role: role, org_name: "Target team", org_slug: "target-team" }
      : {}),
  };
}

function createTest() {
  return convexTest(schema, modules);
}

async function seedStaleMembership(t: ReturnType<typeof createTest>) {
  return await t.run(async (ctx) => {
    const now = 1_780_000_000_000;
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk-user",
      email: "viewer@example.test",
      name: "Viewer",
      createdAt: now,
      updatedAt: now,
    });
    const orgId = await ctx.db.insert("orgs", {
      clerkOrgId: "org_target",
      name: "Target team",
      slug: "target-team",
      createdAt: now,
      updatedAt: now,
    });
    const membershipId = await ctx.db.insert("memberships", {
      orgId,
      userId,
      role: "org:member",
      createdAt: now,
      updatedAt: now,
    });
    const inviteId = await ctx.db.insert("orgInvites", {
      code: "invite-code",
      orgId,
      clerkOrgId: "org_target",
      role: "org:member",
      createdBy: userId,
      createdAt: now,
      expiresAt: now + 86_400_000,
      maxUses: 5,
      usedCount: 0,
    });
    return { inviteId, membershipId, orgId };
  });
}

function teamReads(
  client: ReturnType<ReturnType<typeof createTest>["withIdentity"]>,
  orgId: Awaited<ReturnType<typeof seedStaleMembership>>["orgId"],
  inviteId: Awaited<ReturnType<typeof seedStaleMembership>>["inviteId"],
): Array<() => Promise<unknown>> {
  return [
    () => client.query(api.usage.hourly, { scope: "team", orgId, from: 0, to: 1 }),
    () => client.query(api.usage.recentSessions, { scope: "team", orgId, limit: 1 }),
    () => client.query(api.usage.liveNow, { scope: "team", orgId }),
    () => client.query(api.orgs.members, { orgId }),
    () => client.query(api.orgInvites.usesForInvite, { inviteId }),
  ];
}

test.each([
  ["no active organization", undefined],
  ["a different active organization", "org_other"],
])("team reads reject a stale mirror with %s", async (_label, activeOrg) => {
  const t = createTest();
  const { inviteId, orgId } = await seedStaleMembership(t);
  const client = t.withIdentity(clerkIdentity(activeOrg));

  for (const read of teamReads(client, orgId, inviteId)) {
    await expect(read()).rejects.toMatchObject({ data: { code: "ORG_MISMATCH" } });
  }
  await expect(client.query(api.orgs.byClerkId, { clerkOrgId: "org_target" })).resolves.toBeNull();
  await expect(client.query(api.orgs.myOrgs, {})).resolves.toEqual([]);
});

test("matching active organization permits team reads and scopes organization discovery", async () => {
  const t = createTest();
  const { inviteId, orgId } = await seedStaleMembership(t);
  const member = t.withIdentity(clerkIdentity("org_target"));

  await expect(member.query(api.usage.hourly, { scope: "team", orgId, from: 0, to: 1 })).resolves.toEqual({
    rows: [],
    users: [{ id: expect.any(String), name: "Viewer", email: "viewer@example.test", imageUrl: null }],
  });
  await expect(member.query(api.usage.recentSessions, { scope: "team", orgId, limit: 1 })).resolves.toEqual([]);
  await expect(member.query(api.usage.liveNow, { scope: "team", orgId })).resolves.toEqual([]);
  await expect(member.query(api.orgs.members, { orgId })).resolves.toEqual([
    expect.objectContaining({ id: expect.any(String), name: "Viewer", role: "org:member" }),
  ]);
  await expect(member.query(api.orgs.byClerkId, { clerkOrgId: "org_target" })).resolves.toEqual(
    expect.objectContaining({ id: orgId, name: "Target team", role: "org:member" }),
  );
  await expect(member.query(api.orgs.myOrgs, {})).resolves.toEqual([
    expect.objectContaining({ id: orgId, clerkOrgId: "org_target", role: "org:member" }),
  ]);
  await expect(member.query(api.orgInvites.usesForInvite, { inviteId })).rejects.toMatchObject({
    data: { code: "FORBIDDEN" },
  });

  const admin = t.withIdentity(clerkIdentity("org_target", "org:admin"));
  await expect(admin.query(api.orgInvites.usesForInvite, { inviteId })).resolves.toEqual([]);
});

test("matching active claim cannot replace the mirrored membership gate", async () => {
  const t = createTest();
  const { inviteId, membershipId, orgId } = await seedStaleMembership(t);
  await t.run(async (ctx) => await ctx.db.delete(membershipId));
  const client = t.withIdentity(clerkIdentity("org_target", "org:admin"));

  for (const read of teamReads(client, orgId, inviteId)) {
    await expect(read()).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  }
  await expect(client.query(api.orgs.byClerkId, { clerkOrgId: "org_target" })).resolves.toBeNull();
  await expect(client.query(api.orgs.myOrgs, {})).resolves.toEqual([]);
});

test("organization bootstrap trusts signed metadata instead of client-supplied profile fields", async () => {
  const t = createTest();
  const { orgId } = await seedStaleMembership(t);
  const client = t.withIdentity(clerkIdentity("org_target"));

  await client.mutation(api.orgs.ensureCurrentOrg, {
    clerkOrgId: "org_target",
    name: "Spoofed name",
    slug: "spoofed-slug",
    imageUrl: "https://attacker.example.test/logo.png",
  });

  const organization = await t.run(async (ctx) => await ctx.db.get(orgId));
  expect(organization).toMatchObject({
    name: "Target team",
    slug: "target-team",
  });
  expect(organization?.imageUrl).toBeUndefined();
});

test("personal usage remains available without an active organization", async () => {
  const t = createTest();
  await seedStaleMembership(t);
  const personal = t.withIdentity(clerkIdentity());

  await expect(personal.query(api.usage.hourly, { scope: "personal", from: 0, to: 1 })).resolves.toEqual({
    rows: [],
    users: [{ id: expect.any(String), name: "Viewer", email: "viewer@example.test", imageUrl: null }],
  });
});
