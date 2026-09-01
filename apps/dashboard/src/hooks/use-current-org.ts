"use client";

import { useOrganization } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@codex-tracker/backend/convex/_generated/api";

/** The active Clerk organization and its Convex record (null until membership has synced). */
export function useCurrentOrg() {
  const { organization, isLoaded } = useOrganization();
  const { isAuthenticated } = useConvexAuth();
  const org = useQuery(api.orgs.byClerkId, organization && isAuthenticated ? { clerkOrgId: organization.id } : "skip");
  return {
    clerkOrg: organization ?? null,
    org: org ?? null,
    isLoaded,
    orgLoading: !!organization && isAuthenticated && org === undefined,
  };
}
