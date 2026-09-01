"use client";

import { useEffect, useRef, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useConvexAuth, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { api } from "@codex-tracker/backend/convex/_generated/api";

/**
 * Keeps Convex in sync with Clerk: upserts the signed-in user, and registers the active
 * organization + membership (verified server-side against the JWT's org_id claim).
 */
export function BootstrapUser() {
  const { isAuthenticated } = useConvexAuth();
  const { organization } = useOrganization();
  const ensureUser = useMutation(api.users.ensureUser);
  const ensureOrg = useMutation(api.orgs.ensureCurrentOrg);
  const [jwtHint, setJwtHint] = useState(false);
  const t = useTranslations("team");
  const userDone = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || userDone.current) return;
    userDone.current = true;
    ensureUser({}).catch((err) => {
      userDone.current = false;
      console.warn("ensureUser failed", err);
    });
  }, [isAuthenticated, ensureUser]);

  const orgId = organization?.id;
  const orgName = organization?.name;
  const orgSlug = organization?.slug ?? undefined;
  const orgImage = organization?.imageUrl ?? undefined;

  useEffect(() => {
    if (!isAuthenticated || !orgId || !orgName) return;
    let cancelled = false;
    let attempt = 0;
    const run = async () => {
      try {
        await ensureUser({});
        await ensureOrg({ clerkOrgId: orgId, name: orgName, slug: orgSlug, imageUrl: orgImage });
        if (!cancelled) setJwtHint(false);
      } catch (err) {
        const code = err instanceof ConvexError ? (err.data as { code?: string })?.code : undefined;
        if (code === "NO_ORG_CLAIM") {
          if (!cancelled) setJwtHint(true);
          return;
        }
        // The Convex token may still carry the previous org for a moment; retry a few times.
        if (attempt++ < 4 && !cancelled) setTimeout(run, 1500 * attempt);
        else console.warn("ensureCurrentOrg failed", err);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, orgId, orgName, orgSlug, orgImage, ensureOrg, ensureUser]);

  if (!jwtHint) return null;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-4">
      <div className="flex gap-3 rounded-xl border border-[rgba(250,178,25,0.5)] bg-[rgba(250,178,25,0.1)] px-4 py-3 text-sm">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
        <div>
          <p className="font-medium text-fg">{t("jwtHintTitle")}</p>
          <p className="text-fg-2">{t("jwtHintBody")}</p>
        </div>
      </div>
    </div>
  );
}
