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

/** The landing / auth surfaces are always rendered in the dark palette. */
export const SPACE_BG = THEMES.dark.bg;
