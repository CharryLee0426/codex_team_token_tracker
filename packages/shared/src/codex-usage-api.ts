import type { RateLimits, RateLimitWindow } from "./codex-parser.ts";

/** Endpoint the official Codex client uses for account usage / rate limits (ChatGPT login). */
export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export interface NamedRateLimit {
  name: string;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
}

export interface LiveRateLimits extends RateLimits {
  source: "live" | "log";
  limitReached: boolean;
  /** Per-model / feature limits reported under `additional_rate_limits`. */
  additional: NamedRateLimit[];
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
}

function windowFrom(w: any, now: number): RateLimitWindow | null {
  if (!w || typeof w !== "object") return null;
  const used = typeof w.used_percent === "number" ? w.used_percent : null;
  if (used === null) return null;
  const windowSeconds = typeof w.limit_window_seconds === "number" ? w.limit_window_seconds : null;
  const resetsAt =
    typeof w.reset_at === "number"
      ? w.reset_at * 1000
      : typeof w.reset_after_seconds === "number"
        ? now + w.reset_after_seconds * 1000
        : null;
  return { usedPercent: used, windowMinutes: windowSeconds !== null ? Math.round(windowSeconds / 60) : null, resetsAt };
}

/** Parse the JSON body of GET /backend-api/wham/usage. Returns null when the shape is unrecognized. */
export function parseCodexUsageResponse(json: unknown, observedAt = Date.now()): LiveRateLimits | null {
  const j: any = json;
  if (!j || typeof j !== "object") return null;
  const rl = j.rate_limit;
  if (!rl || typeof rl !== "object") return null;
  const primary = windowFrom(rl.primary_window, observedAt);
  const secondary = windowFrom(rl.secondary_window, observedAt);
  const additional: NamedRateLimit[] = [];
  if (Array.isArray(j.additional_rate_limits)) {
    for (const a of j.additional_rate_limits) {
      if (!a || typeof a !== "object") continue;
      const inner = a.rate_limit ?? a;
      additional.push({
        name: typeof a.limit_name === "string" ? a.limit_name : typeof a.metered_feature === "string" ? a.metered_feature : "limit",
        primary: windowFrom(inner?.primary_window, observedAt),
        secondary: windowFrom(inner?.secondary_window, observedAt),
      });
    }
  }
  const credits = j.credits && typeof j.credits === "object"
    ? { hasCredits: !!j.credits.has_credits, unlimited: !!j.credits.unlimited, balance: typeof j.credits.balance === "string" ? j.credits.balance : null }
    : null;
  return {
    source: "live",
    primary,
    secondary,
    planType: typeof j.plan_type === "string" ? j.plan_type : null,
    limitId: typeof j.rate_limit_reached_type === "string" ? j.rate_limit_reached_type : null,
    observedAt,
    limitReached: !!rl.limit_reached,
    additional,
    credits,
  };
}

/** Wrap log-derived limits in the live shape so consumers handle one type. */
export function fromLogRateLimits(rl: RateLimits | null): LiveRateLimits | null {
  if (!rl) return null;
  return { ...rl, source: "log", limitReached: false, additional: [], credits: null };
}
