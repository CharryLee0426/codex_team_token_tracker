import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@codex-tracker/backend/convex/_generated/api";

/**
 * Redeem a reusable invite link.
 *
 * Clerk memberships can only be created with the backend API, and Convex owns the invite ledger, so
 * the exchange is: reserve a seat in Convex (idempotent per user), create the Clerk membership, then
 * confirm — or release the seat if Clerk refused. The client only ever sends the code; organization
 * and role come from the stored invite so neither can be forged in the URL.
 */

/** Convex error codes that mean "the link is the problem", mapped to the status the client renders. */
const INVITE_ERRORS: Record<string, number> = {
  NOT_FOUND: 404,
  EXPIRED: 410,
  REVOKED: 410,
  EXHAUSTED: 409,
  UNAUTHENTICATED: 401,
};

function convexErrorCode(err: unknown): string | null {
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string") return (data as { code: string }).code;
  return null;
}

/** Clerk answers a duplicate membership with 422 `already_a_member_in_organization`. */
function isAlreadyMember(err: unknown): boolean {
  const errors = (err as { errors?: Array<{ code?: string }> })?.errors;
  return Array.isArray(errors) && errors.some((e) => (e.code ?? "").includes("already_a_member"));
}

export async function POST(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code;
  } catch {
    // fall through to the empty-code check
  }
  if (!code) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const token = await getToken({ template: "convex" });
  if (!token) return NextResponse.json({ error: "no_convex_token" }, { status: 500 });

  let reservation: Awaited<ReturnType<typeof reserve>>;
  try {
    reservation = await reserve(code, token);
  } catch (err) {
    const codeName = convexErrorCode(err);
    if (codeName && INVITE_ERRORS[codeName]) return NextResponse.json({ error: codeName.toLowerCase() }, { status: INVITE_ERRORS[codeName] });
    console.error("invite reserve failed", err);
    return NextResponse.json({ error: "reserve_failed" }, { status: 500 });
  }

  if (!reservation.alreadyMember) {
    try {
      const clerk = await clerkClient();
      await clerk.organizations.createOrganizationMembership({
        organizationId: reservation.clerkOrgId,
        userId,
        role: reservation.role,
      });
    } catch (err) {
      if (!isAlreadyMember(err)) {
        // Give the seat back so a Clerk outage does not quietly shrink the link.
        await fetchMutation(api.orgInvites.finalize, { useId: reservation.useId, ok: false }, { token }).catch(() => {});
        console.error("createOrganizationMembership failed", err);
        return NextResponse.json({ error: "membership_failed" }, { status: 502 });
      }
    }
  }

  await fetchMutation(api.orgInvites.finalize, { useId: reservation.useId, ok: true }, { token }).catch((err) => {
    // The membership exists; a bookkeeping failure must not fail the join.
    console.warn("invite finalize failed", err);
  });

  return NextResponse.json({
    ok: true,
    organizationId: reservation.clerkOrgId,
    organizationName: reservation.orgName,
    alreadyMember: reservation.alreadyMember,
  });
}

function reserve(code: string, token: string) {
  return fetchMutation(api.orgInvites.reserve, { code }, { token });
}
