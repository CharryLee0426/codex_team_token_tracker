"use client";

import { CreateOrganization } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";

export function OrgRequired() {
  const t = useTranslations("team");
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_auto] items-start">
      <Card className="p-6">
        <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Users size={18} />
        </div>
        <h2 className="text-base font-semibold text-fg">{t("noOrgTitle")}</h2>
        <p className="mt-1 max-w-prose text-sm text-fg-2">{t("noOrgBody")}</p>
      </Card>
      <CreateOrganization afterCreateOrganizationUrl="/dashboard/team" skipInvitationScreen={false} />
    </div>
  );
}
