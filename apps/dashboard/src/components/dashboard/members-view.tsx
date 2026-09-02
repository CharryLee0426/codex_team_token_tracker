"use client";

import { useTranslations } from "next-intl";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { OrgRequired } from "./org-required";
import { OrgMembersTable } from "./members-table";
import { InviteLinks } from "./invite-links";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export function MembersView() {
  const t = useTranslations("members");
  const tt = useTranslations("team");
  const { clerkOrg, org, isLoaded } = useCurrentOrg();
  if (!isLoaded) return <Skeleton className="h-40" />;
  if (!clerkOrg) return <OrgRequired />;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={clerkOrg.name} title={t("title")} subtitle={t("subtitle")} />
      {/* Admin-only, but the gate that counts is server-side: `listForOrg` answers null for anyone
          else and `InviteLinks` then renders nothing, so a stale role here cannot leak the codes. */}
      {org ? <InviteLinks orgId={org.id} /> : null}
      <Card>{org ? <OrgMembersTable orgId={org.id} /> : <div className="p-6 text-sm text-fg-2">{tt("syncing")}</div>}</Card>
    </div>
  );
}
