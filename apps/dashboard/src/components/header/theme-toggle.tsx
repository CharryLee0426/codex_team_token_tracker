"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

const options = [
  { key: "light", Icon: Sun },
  { key: "dark", Icon: Moon },
  { key: "system", Icon: Monitor },
] as const;

export function ThemeToggle({ className, labels = false }: { className?: string; labels?: boolean }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const t = useTranslations("nav");
  const current = mounted ? (theme ?? "system") : "system";
  return (
    <div className={cn("inline-flex items-center rounded-lg border border-border bg-card p-0.5", className)} role="group" aria-label={t("theme")}>
      {options.map(({ key, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => setTheme(key)}
          title={t(key)}
          aria-pressed={current === key}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
            current === key ? "bg-accent-soft text-accent" : "text-fg-2 hover:text-fg",
          )}
        >
          <Icon size={14} />
          {labels ? <span>{t(key)}</span> : null}
        </button>
      ))}
    </div>
  );
}
