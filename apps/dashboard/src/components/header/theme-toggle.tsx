"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useMounted } from "@/hooks/use-mounted";
import { Segmented } from "@/components/ui/segmented";

type Mode = "light" | "dark" | "system";

export function ThemeToggle({ className, labels = false }: { className?: string; labels?: boolean }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const t = useTranslations("nav");
  const current = (mounted ? (theme as Mode | undefined) : undefined) ?? "system";
  const options = [
    { value: "light" as Mode, icon: <Sun size={14} />, title: t("light"), label: labels ? t("light") : undefined },
    { value: "dark" as Mode, icon: <Moon size={14} />, title: t("dark"), label: labels ? t("dark") : undefined },
    { value: "system" as Mode, icon: <Monitor size={14} />, title: t("system"), label: labels ? t("system") : undefined },
  ];
  return <Segmented options={options} value={current} onChange={setTheme} ariaLabel={t("theme")} mode="group" className={className} />;
}
