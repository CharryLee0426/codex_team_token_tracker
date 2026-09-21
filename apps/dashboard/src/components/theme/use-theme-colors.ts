"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useMounted } from "@/hooks/use-mounted";
import { isDashboardThemePath, THEMES, TSUSHIMA_THEMES } from "@/lib/theme";
import { useDashboardTheme } from "./dashboard-theme-provider";

/** Shared by charts and Clerk so their concrete colors follow the CSS theme tokens. */
export function useThemeColors() {
  const { theme } = useDashboardTheme();
  const { resolvedTheme } = useTheme();
  const pathname = usePathname();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === "dark";
  const mode = dark ? "dark" : "light";
  const tsushima = theme === "tsushima" && isDashboardThemePath(pathname);
  return { colors: (tsushima ? TSUSHIMA_THEMES : THEMES)[mode], dark, mode, tsushima } as const;
}
