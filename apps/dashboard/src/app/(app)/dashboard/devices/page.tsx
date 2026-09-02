import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MyDevices } from "@/components/dashboard/devices-list";
import { PageHeader } from "@/components/ui/page-header";
import { CodeBlock } from "@/components/ui/code-block";

export const metadata: Metadata = { title: "Devices" };

export default async function DevicesPage() {
  const t = await getTranslations("devices");
  const tn = await getTranslations("nav");
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={tn("devices")} title={t("title")} subtitle={t("subtitle")} />
      <MyDevices />
      <div className="max-w-xl">
        <p className="eyebrow mb-2">{t("connectHint")}</p>
        <CodeBlock code="npm i -g codex-token-tracker && codex-tracker login" />
      </div>
    </div>
  );
}
