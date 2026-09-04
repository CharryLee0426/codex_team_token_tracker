"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Compass } from "lucide-react";
import { LanguageSwitcher } from "@/components/header/language-switcher";
import { ThemeToggle } from "@/components/header/theme-toggle";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { PageHeader } from "@/components/ui/page-header";
import { TOUR_HREF, trackerCommands } from "@/lib/onboarding";

export function SettingsPanel({ tourHref = TOUR_HREF }: { tourHref?: string }) {
  const t = useTranslations("settings");
  const tn = useTranslations("nav");
  const to = useTranslations("onboarding");
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_APP_URL ?? "https://your-dashboard.vercel.app");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);
  const commands = trackerCommands(origin);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader eyebrow={tn("settings")} title={t("title")} subtitle={t("subtitle")} />
      <Card>
        <CardHeader title={t("language")} hint={t("languageHint")} action={<LanguageSwitcher />} />
      </Card>
      <Card>
        <CardHeader title={t("theme")} hint={t("themeHint")} action={<ThemeToggle labels className="max-sm:hidden" />} />
        <CardBody className="sm:hidden">
          <ThemeToggle labels />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={to("settingsTitle")}
          hint={to("settingsBody")}
          action={
            <LinkButton href={tourHref} variant="primary" size="sm">
              <Compass size={14} /> {to("settingsCta")}
            </LinkButton>
          }
        />
      </Card>
      <Card>
        <CardHeader title={t("connectTitle")} hint={t("connectBody")} />
        <CardBody className="space-y-4">
          <div>
            <p className="eyebrow mb-1.5">1 · {t("connectStep1")}</p>
            <CodeBlock code={commands.login} />
          </div>
          <div>
            <p className="eyebrow mb-1.5">2 · {t("connectStep2")}</p>
            <CodeBlock code={`${commands.run.padEnd(34)}# macOS menu bar / Windows tray\n${commands.agent.padEnd(34)}# headless: WSL2, SSH boxes, CI`} />
          </div>
          <div>
            <p className="eyebrow mb-1.5">3 · {t("connectStep3")}</p>
            <CodeBlock code={"npm i -g codex-token-tracker      # optional\ncodex-tracker                     # = npx codex-token-tracker"} />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("pricingTitle")} hint={t("pricingBody")} />
      </Card>
    </div>
  );
}
