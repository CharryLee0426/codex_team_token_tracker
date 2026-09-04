/** Query parameter that opens the guided tour on any dashboard page: `/dashboard/personal?tour=1`. */
export const TOUR_QUERY = "tour";

/** Where the Settings button (and the `?tour=1` link) sends people: the personal board, tour open. */
export const TOUR_HREF = `/dashboard/personal?${TOUR_QUERY}=1`;

/** The dashboard a published `codex-token-tracker` talks to by default — no `--dashboard` flag needed there. */
export const DEFAULT_DASHBOARD_URL = "https://codex.chenli.dev";

/**
 * `NEXT_PUBLIC_ONBOARDING_TOUR` — a build-time switch for working on the tour (`pnpm dev:tour` sets it):
 *   force  every dashboard load opens it, whatever the account says
 *   off    it never opens by itself; the Settings button and `?tour=1` still work
 * Anything else is `auto`: open once per account, the first time the dashboard is visited.
 */
export type OnboardingMode = "auto" | "force" | "off";

export function onboardingMode(): OnboardingMode {
  const v = process.env.NEXT_PUBLIC_ONBOARDING_TOUR;
  return v === "force" || v === "off" ? v : "auto";
}

/** The commands the tour and the Settings card show for this dashboard. */
export function trackerCommands(origin: string | null | undefined): { login: string; run: string; agent: string } {
  const flag = origin && origin !== DEFAULT_DASHBOARD_URL ? ` --dashboard ${origin}` : "";
  return { login: `npx codex-token-tracker login${flag}`, run: "npx codex-token-tracker", agent: "npx codex-token-tracker agent" };
}
