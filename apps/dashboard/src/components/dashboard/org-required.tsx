"use client";

import { CreateOrganization } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";

export function OrgRequired() {
  const t = useTranslations("team");
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_auto]">
      <Card className="p-6">
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Users size={18} />
        </div>
        <p className="eyebrow mb-1.5">{t("title")}</p>
        <h2 className="text-lg font-semibold tracking-tight text-fg">{t("noOrgTitle")}</h2>
        <p className="mt-1 max-w-prose text-sm text-fg-2">{t("noOrgBody")}</p>
      </Card>
      <CreateOrganization afterCreateOrganizationUrl="/dashboard/team" skipInvitationScreen={false} />
    </div>
  );
}
