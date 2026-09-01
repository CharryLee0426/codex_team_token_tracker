import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DevicesList } from "@/components/dashboard/devices-list";
import { PageTitle } from "@/components/ui/page-title";
import { CodeBlock } from "@/components/ui/code-block";

export const metadata: Metadata = { title: "Devices" };

export default async function DevicesPage() {
  const t = await getTranslations("devices");
  return (
    <div className="space-y-4">
      <PageTitle title={t("title")} subtitle={t("subtitle")} />
      <DevicesList />
      <div className="max-w-xl">
        <p className="mb-2 text-xs text-muted">{t("connectHint")}</p>
        <CodeBlock code="npm i -g codex-token-tracker && codex-tracker login" />
      </div>
    </div>
  );
}
