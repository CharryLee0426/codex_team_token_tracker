"use client";

import { useTranslations } from "next-intl";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { UsageDashboard } from "./usage-dashboard";
import { OrgRequired } from "./org-required";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function TeamView() {
  const t = useTranslations("team");
  const { clerkOrg, org, isLoaded, orgLoading } = useCurrentOrg();
  if (!isLoaded) return <Skeleton className="h-40" />;
  if (!clerkOrg) return <OrgRequired />;
  if (!org) {
    return (
      <Card className="p-6 text-sm text-fg-2">
        {orgLoading ? t("syncing") : t("syncing")}
        <Skeleton className="mt-3 h-24" />
      </Card>
    );
  }
  return <UsageDashboard scope="team" orgId={org.id} orgName={org.name} />;
}
