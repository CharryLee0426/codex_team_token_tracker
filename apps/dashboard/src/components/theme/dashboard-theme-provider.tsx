"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { DASHBOARD_MOTION_COOKIE, DASHBOARD_THEME_COOKIE, type DashboardTheme } from "@/lib/theme";

interface DashboardThemeContextValue {
  theme: DashboardTheme;
  setTheme: (theme: DashboardTheme) => void;
  /** User preference; consumers also honor the system's reduced-motion setting. */
  motion: boolean;
  setMotion: (enabled: boolean) => void;
  mounted: boolean;
}

const DashboardThemeContext = createContext<DashboardThemeContextValue | null>(null);

/** A cookie, like the sidebar preference, gives reloads the correct theme on the first paint. */
export function DashboardThemeProvider({ initialTheme, initialMotion, children }: { initialTheme: DashboardTheme; initialMotion: boolean; children: React.ReactNode }) {
  const [theme, updateTheme] = useState(initialTheme);
  const [motion, updateMotion] = useState(initialMotion);
  const mounted = useMounted();
  const setTheme = useCallback((next: DashboardTheme) => {
    updateTheme(next);
    try {
      document.cookie = `${DASHBOARD_THEME_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
    } catch {
      // The theme still works for this visit when browser storage is unavailable.
    }
  }, []);
  const setMotion = useCallback((enabled: boolean) => {
    updateMotion(enabled);
    try {
      document.cookie = `${DASHBOARD_MOTION_COOKIE}=${enabled};path=/;max-age=31536000;samesite=lax`;
    } catch {
      // The control still works for this visit when browser storage is unavailable.
    }
  }, []);
  const value = useMemo(() => ({ theme, setTheme, motion, setMotion, mounted }), [theme, setTheme, motion, setMotion, mounted]);
  return <DashboardThemeContext.Provider value={value}>{children}</DashboardThemeContext.Provider>;
}

export function useDashboardTheme(): DashboardThemeContextValue {
  const context = useContext(DashboardThemeContext);
  if (!context) throw new Error("useDashboardTheme must be used inside DashboardThemeProvider");
  return context;
}
