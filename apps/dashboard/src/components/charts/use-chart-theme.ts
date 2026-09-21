"use client";

import { useMemo } from "react";
import { CATEGORICAL_DARK, CATEGORICAL_LIGHT, HEATMAP_LEVELS_DARK, HEATMAP_LEVELS_LIGHT, OTHER_COLOR } from "@codex-tracker/shared/palette";
import { TSUSHIMA_HEATMAP } from "@/lib/theme";
import { useThemeColors } from "@/components/theme/use-theme-colors";

export interface ChartTheme {
  dark: boolean;
  categorical: readonly string[];
  heatmap: readonly string[];
  other: string;
  grid: string;
  axis: string;
  ink: string;
  ink2: string;
  /** Chart surface: the card background, used for the 2px gaps between stacked marks. */
  surface: string;
  border: string;
  accent: string;
  colorAt: (index: number) => string;
}

/** Concrete colors for SVG presentation attributes (recharts cannot read CSS custom properties). */
export function useChartTheme(): ChartTheme {
  const { colors, dark, mode, tsushima } = useThemeColors();
  return useMemo(() => {
    const categorical = dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
    return {
      dark,
      categorical,
      heatmap: tsushima ? TSUSHIMA_HEATMAP[mode] : dark ? HEATMAP_LEVELS_DARK : HEATMAP_LEVELS_LIGHT,
      other: OTHER_COLOR,
      grid: colors.grid,
      axis: colors.axis,
      ink: colors.fg,
      ink2: colors.fg2,
      surface: colors.card,
      border: colors.border,
      accent: colors.accent,
      colorAt: (i: number) => (i < categorical.length ? categorical[i] : OTHER_COLOR),
    };
  }, [colors, dark, mode, tsushima]);
}
