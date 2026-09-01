"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@codex-tracker/backend/convex/_generated/api";

/** The Convex user record for the signed-in Clerk user (null until users.ensureUser has run). */
export function useMe() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  return { me: me ?? null, ready: !!me, isAuthenticated, isLoading: isLoading || (isAuthenticated && me === undefined) };
}
