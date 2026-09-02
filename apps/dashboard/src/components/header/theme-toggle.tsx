"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useMounted } from "@/hooks/use-mounted";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

type Mode = "light" | "dark" | "system";

export function ThemeToggle({ className, labels = false }: { className?: string; labels?: boolean }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const t = useTranslations("nav");
  const current = (mounted ? (theme as Mode | undefined) : undefined) ?? "system";
  const dark = mounted && resolvedTheme === "dark";
  const nextMode: Mode = dark ? "light" : "dark";
  const nextLabel = t(nextMode);
  const NextIcon = dark ? Sun : Moon;
  const options = [
    { value: "light" as Mode, icon: <Sun size={14} />, title: t("light"), label: labels ? t("light") : undefined },
    { value: "dark" as Mode, icon: <Moon size={14} />, title: t("dark"), label: labels ? t("dark") : undefined },
    { value: "system" as Mode, icon: <Monitor size={14} />, title: t("system"), label: labels ? t("system") : undefined },
  ];

  return (
    <>
      <Button
        variant="secondary"
        size={labels ? "sm" : "icon-sm"}
        className={cn("sm:hidden", className)}
        aria-label={`${t("theme")}: ${nextLabel}`}
        title={nextLabel}
        disabled={!mounted}
        onClick={() => setTheme(nextMode)}
      >
        <NextIcon size={14} />
        {labels ? nextLabel : null}
      </Button>
      <Segmented options={options} value={current} onChange={setTheme} ariaLabel={t("theme")} mode="group" className={cn("hidden sm:grid", className)} />
    </>
  );
}
