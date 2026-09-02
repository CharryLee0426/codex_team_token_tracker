/** Shared bits of the reusable organization invite link (`<origin>/j/<code>`). */

/** Expiry choices offered when minting a link. Seven days is the ceiling enforced server-side. */
export const INVITE_DAY_OPTIONS = [1, 3, 5, 7] as const;
export type InviteDays = (typeof INVITE_DAY_OPTIONS)[number];

/** Seat limits offered in the UI; 0 means "no limit, expiry only". */
export const INVITE_SEAT_OPTIONS = [0, 1, 5, 25] as const;

export const INVITE_PATH = "/j";

/**
 * Absolute link to hand out. In the browser this is whatever origin the admin is actually on
 * (http://localhost:3000 in development, the deployed domain in production); on the server it falls
 * back to NEXT_PUBLIC_APP_URL.
 */
export function inviteUrl(code: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return `${base}${INVITE_PATH}/${code}`;
}

/** Link shown before an origin is known (SSR without NEXT_PUBLIC_APP_URL): relative, still valid. */
export function invitePath(code: string): string {
  return `${INVITE_PATH}/${code}`;
}

export type InviteStatus = "valid" | "expired" | "revoked" | "exhausted" | "not_found";

/** Whole days left before `expiresAt`, floored at 0. */
export function daysLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)));
}
