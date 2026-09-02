"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocaleAction } from "@/i18n/actions";
import { locales, type Locale } from "@/i18n/config";
import { Segmented } from "@/components/ui/segmented";

const labels: Record<Locale, string> = { en: "EN", zh: "中文" };

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const t = useTranslations("nav");
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    startTransition(async () => {
      await setLocaleAction(next);
      try {
        localStorage.setItem("codex-tracker:locale", next);
      } catch {
        /* ignore */
      }
      router.refresh();
    });
  }

  return (
    <Segmented
      options={locales.map((l) => ({ value: l, label: labels[l], title: labels[l] }))}
      value={locale}
      onChange={choose}
      ariaLabel={t("language")}
      mode="group"
      disabled={pending}
      className={className}
    />
  );
}
