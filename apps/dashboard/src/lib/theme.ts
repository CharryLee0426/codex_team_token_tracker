/**
 * Design tokens shared by everything that cannot read CSS custom properties directly:
 * the chart theme (SVG presentation attributes), the scene canvas and Clerk's appearance API.
 * Keep these in sync with the `:root` / `.dark` blocks in `app/globals.css`.
 */
export interface ThemeColors {
  bg: string;
  bg2: string;
  card: string;
  card2: string;
  border: string;
  borderStrong: string;
  fg: string;
  fg2: string;
  muted: string;
  accent: string;
  accentFg: string;
  accentSoft: string;
  accentGlow: string;
  grid: string;
  axis: string;
}

export const THEMES: Record<"light" | "dark", ThemeColors> = {
  light: {
    bg: "#f3f5fa",
    bg2: "#ffffff",
    card: "#ffffff",
    card2: "#eef2f8",
    border: "rgba(16, 24, 40, 0.10)",
    borderStrong: "rgba(16, 24, 40, 0.22)",
    fg: "#0b1220",
    fg2: "#4b5670",
    muted: "#6f7a93",
    accent: "#0369a1",
    accentFg: "#ffffff",
    accentSoft: "rgba(3, 105, 161, 0.10)",
    accentGlow: "rgba(3, 105, 161, 0.25)",
    grid: "rgba(16, 24, 40, 0.08)",
    axis: "#6f7a93",
  },
  dark: {
    bg: "#05070d",
    bg2: "#090d16",
    card: "#0c1220",
    card2: "#121a2b",
    border: "rgba(148, 163, 196, 0.14)",
    borderStrong: "rgba(148, 163, 196, 0.30)",
    fg: "#e8edf7",
    fg2: "#a7b1c6",
    muted: "#6f7a93",
    accent: "#5cc8ff",
    accentFg: "#041019",
    accentSoft: "rgba(92, 200, 255, 0.14)",
    accentGlow: "rgba(92, 200, 255, 0.35)",
    grid: "rgba(148, 163, 196, 0.10)",
    axis: "#6f7a93",
  },
};

export type ThemeMode = keyof typeof THEMES;

/** Visual themes are independent of the existing light / dark / system preference. */
export type DashboardTheme = "default" | "tsushima";
export const DASHBOARD_THEME_COOKIE = "dashboard-theme";
export const DASHBOARD_MOTION_COOKIE = "dashboard-motion";

export function toDashboardTheme(value: string | undefined): DashboardTheme {
  return value === "tsushima" ? "tsushima" : "default";
}

export function toDashboardMotion(value: string | undefined): boolean {
  return value !== "false";
}

export function isDashboardThemePath(pathname: string | null): boolean {
  return /^\/(dashboard|settings|cli-auth|preview)(\/|$)/.test(pathname ?? "");
}

/** Ink, rice paper and maple red. Mirror the Tsushima scopes in globals.css. */
export const TSUSHIMA_THEMES: Record<ThemeMode, ThemeColors> = {
  light: {
    bg: "#f1eee5",
    bg2: "#f8f5ed",
    card: "#fffcf5",
    card2: "#ede9dd",
    border: "rgba(54, 65, 57, 0.16)",
    borderStrong: "rgba(54, 65, 57, 0.32)",
    fg: "#222d2b",
    fg2: "#4f5b54",
    muted: "#64706c",
    accent: "#aa352d",
    accentFg: "#ffffff",
    accentSoft: "rgba(170, 53, 45, 0.09)",
    accentGlow: "rgba(170, 53, 45, 0.22)",
    grid: "rgba(54, 65, 57, 0.09)",
    axis: "#64706c",
  },
  dark: {
    bg: "#0c1112",
    bg2: "#101718",
    card: "#141c1d",
    card2: "#202a2a",
    border: "rgba(191, 199, 181, 0.18)",
    borderStrong: "rgba(191, 199, 181, 0.34)",
    fg: "#f0eee5",
    fg2: "#c0c6ba",
    muted: "#9faaa7",
    accent: "#ed8575",
    accentFg: "#26110d",
    accentSoft: "rgba(237, 133, 117, 0.13)",
    accentGlow: "rgba(237, 133, 117, 0.24)",
    grid: "rgba(191, 199, 181, 0.1)",
    axis: "#9faaa7",
  },
};

/** Sequential maple ramp; categorical series retain the shared CVD-validated palette. */
export const TSUSHIMA_HEATMAP: Record<ThemeMode, readonly string[]> = {
  light: ["#e7e5da", "#e9b8a8", "#d5806c", "#b44737", "#75291f"],
  dark: ["#293331", "#67382f", "#9b4b3d", "#cf7160", "#f0ac95"],
};

/** The landing / auth surfaces are always rendered in the dark palette. */
export const SPACE_BG = THEMES.dark.bg;
