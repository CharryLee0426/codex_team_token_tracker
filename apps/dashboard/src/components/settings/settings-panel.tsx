"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/header/language-switcher";
import { ThemeToggle } from "@/components/header/theme-toggle";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { PageTitle } from "@/components/ui/page-title";

export function SettingsPanel() {
  const t = useTranslations("settings");
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_APP_URL ?? "https://your-dashboard.vercel.app");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle title={t("title")} subtitle={t("subtitle")} />
      <Card>
        <CardHeader title={t("language")} hint={t("languageHint")} action={<LanguageSwitcher />} />
      </Card>
      <Card>
        <CardHeader title={t("theme")} hint={t("themeHint")} action={<ThemeToggle labels />} />
      </Card>
      <Card>
        <CardHeader title={t("connectTitle")} hint={t("connectBody")} />
        <CardBody className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-muted">1. {t("connectStep1")}</p>
            <CodeBlock code="npm i -g codex-token-tracker" />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted">2. {t("connectStep2")}</p>
            <CodeBlock code={`codex-tracker login --dashboard ${origin}`} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted">3. {t("connectStep3")}</p>
            <CodeBlock code={"codex-tracker            # macOS menu bar / Windows tray\ncodex-tracker agent      # headless: WSL2, SSH boxes, CI"} />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("pricingTitle")} hint={t("pricingBody")} />
      </Card>
    </div>
  );
}
