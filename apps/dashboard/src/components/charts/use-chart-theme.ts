"use client";

import { useTheme } from "next-themes";
import { useMemo } from "react";
import { CATEGORICAL_DARK, CATEGORICAL_LIGHT, HEATMAP_LEVELS_DARK, HEATMAP_LEVELS_LIGHT, OTHER_COLOR } from "@codex-tracker/shared/palette";
import { useMounted } from "@/hooks/use-mounted";

export interface ChartTheme {
  dark: boolean;
  categorical: readonly string[];
  heatmap: readonly string[];
  other: string;
  grid: string;
  axis: string;
  ink: string;
  ink2: string;
  surface: string;
  tooltipBg: string;
  border: string;
  colorAt: (index: number) => string;
}

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === "dark";
  return useMemo(() => {
    const categorical = dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
    return {
      dark,
      categorical,
      heatmap: dark ? HEATMAP_LEVELS_DARK : HEATMAP_LEVELS_LIGHT,
      other: OTHER_COLOR,
      grid: dark ? "#232327" : "#ececef",
      axis: dark ? "#71717a" : "#8a8a93",
      ink: dark ? "#fafafa" : "#0a0a0a",
      ink2: dark ? "#a1a1aa" : "#52525b",
      surface: dark ? "#141416" : "#fafafa",
      tooltipBg: dark ? "#1b1b1f" : "#ffffff",
      border: dark ? "#27272a" : "#e5e5e5",
      colorAt: (i: number) => (i < categorical.length ? categorical[i] : OTHER_COLOR),
    };
  }, [dark]);
}
