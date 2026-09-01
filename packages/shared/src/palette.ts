/**
 * Validated categorical palette (CVD-safe adjacent pairs in both modes; see dataviz reference).
 * Assign by slot in a FIXED order (first-seen / largest-first), never cycle; 9th+ series fold into "Other".
 */
export const CATEGORICAL_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"] as const;
export const CATEGORICAL_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"] as const;
export const OTHER_COLOR = "#898781";

/** Single-hue blue sequential ramp, light → dark (steps 100..700). */
export const SEQUENTIAL_BLUE = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b",
] as const;

/** Heatmap levels 0..4 for each mode: level 0 is the empty cell (surface-tinted), 1..4 ascend the blue ramp. */
export const HEATMAP_LEVELS_LIGHT = ["#eeeeec", "#b7d3f6", "#6da7ec", "#2a78d6", "#184f95"] as const;
export const HEATMAP_LEVELS_DARK = ["#26262a", "#184f95", "#256abf", "#3987e5", "#86b6ef"] as const;

export const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" } as const;

export function seriesColor(index: number, dark: boolean): string {
  const p = dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
  return index < p.length ? p[index] : OTHER_COLOR;
}

/**
 * Assign stable colors to a list of series names. Order = the order given (callers should pass
 * a stable ordering such as "largest total first at first render" and keep it).
 */
export function assignSeriesColors(names: string[], dark: boolean): Map<string, string> {
  const out = new Map<string, string>();
  names.forEach((n, i) => out.set(n, seriesColor(i, dark)));
  return out;
}
