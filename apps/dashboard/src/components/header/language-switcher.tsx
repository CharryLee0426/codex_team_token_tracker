"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocaleAction } from "@/i18n/actions";
import { locales, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

const labels: Record<Locale, string> = { en: "EN", zh: "中文" };

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
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
    <div className={cn("inline-flex items-center rounded-lg border border-border bg-card p-0.5", className)} role="group" aria-label={t("language")}>
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          onClick={() => choose(l)}
          className={cn(
            "h-7 rounded-md px-2 text-xs font-medium transition-colors",
            l === locale ? "bg-accent-soft text-accent" : "text-fg-2 hover:text-fg",
          )}
          aria-pressed={l === locale}
        >
          {labels[l]}
        </button>
      ))}
    </div>
  );
}
