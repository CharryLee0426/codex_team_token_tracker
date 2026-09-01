"use client";

import { useTranslations } from "next-intl";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { OrgRequired } from "./org-required";
import { MembersTable } from "./members-table";
import { Card } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import { Skeleton } from "@/components/ui/skeleton";

export function MembersView() {
  const t = useTranslations("members");
  const tt = useTranslations("team");
  const { clerkOrg, org, isLoaded } = useCurrentOrg();
  if (!isLoaded) return <Skeleton className="h-40" />;
  if (!clerkOrg) return <OrgRequired />;
  return (
    <div className="space-y-4">
      <PageTitle title={t("title")} subtitle={`${t("subtitle")} · ${clerkOrg.name}`} />
      <Card>{org ? <MembersTable orgId={org.id} /> : <div className="p-6 text-sm text-fg-2">{tt("syncing")}</div>}</Card>
    </div>
  );
}
