import { DAY, HOUR, addLocalDays, dayKeyToLocalStart, hourStartOf, localDayKey } from "@codex-tracker/shared/time";

/** Trailing presets: `n` local days ending today. */
export type PresetKey = "today" | "7d" | "30d" | "90d" | "365d";
export const PRESET_KEYS: PresetKey[] = ["today", "7d", "30d", "90d", "365d"];
export const PRESET_DAYS: Record<PresetKey, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90, "365d": 365 };

/** Every way to scope the board: a trailing preset, everything since the team plan started, or explicit days. */
export type RangeKey = PresetKey | "plan" | "custom";

export type RangeSelection =
  | { key: PresetKey }
  | { key: "plan" }
  /** Inclusive local day keys (YYYY-MM-DD). */
  | { key: "custom"; fromKey: string; toKey: string };

export const DEFAULT_RANGE: RangeSelection = { key: "30d" };

/** Longest custom span — the same as the 1-year preset (the calendar heatmap tops out at 53 weeks anyway). */
export const MAX_CUSTOM_DAYS = 366;

/** The active-hours grid always covers at least this many days so every weekday row has data. */
export const MIN_ACTIVE_HOURS_DAYS = 7;

/**
 * When the team's Codex plan started — the "Since team plan starts" range counts usage from this
 * instant. Defaults to 2026-08-25 00:00 Pacific Daylight Time; a deployment can override it with
 * NEXT_PUBLIC_TEAM_PLAN_START (any ISO-8601 timestamp with an offset). Rows are UTC hour buckets,
 * so the instant is floored to its hour.
 */
const DEFAULT_TEAM_PLAN_START = "2026-08-25T00:00:00-07:00";
export const TEAM_PLAN_TIME_ZONE = "America/Los_Angeles";
export const TEAM_PLAN_START_MS = parsePlanStart(process.env.NEXT_PUBLIC_TEAM_PLAN_START);

function parsePlanStart(raw: string | undefined): number {
  const ms = raw ? Date.parse(raw) : NaN;
  return hourStartOf(Number.isFinite(ms) ? ms : Date.parse(DEFAULT_TEAM_PLAN_START));
}

export interface RangeBounds {
  key: RangeKey;
  /** Local calendar days covered, both ends inclusive. */
  days: number;
  fromKey: string; // local day key (inclusive)
  toKey: string; // local day key (inclusive)
  fromMs: number; // first UTC hour bucket included
  toMs: number; // exclusive: the end of the current UTC hour, or the local midnight after toKey when that is in the past
}

/** Inclusive count of local days between two day keys (DST-safe). */
export function spanDays(fromKey: string, toKey: string): number {
  return Math.max(0, Math.round((dayKeyToLocalStart(toKey) - dayKeyToLocalStart(fromKey)) / DAY) + 1);
}

/** Resolve a selection into concrete local-day and UTC-hour bounds, aligned to whole hours for querying. */
export function rangeBounds(sel: RangeSelection, nowMs: number): RangeBounds {
  const todayKey = localDayKey(nowMs);
  const liveEnd = hourStartOf(nowMs) + HOUR;
  switch (sel.key) {
    case "plan": {
      const startKey = localDayKey(TEAM_PLAN_START_MS);
      const fromKey = startKey <= todayKey ? startKey : todayKey;
      return { key: "plan", days: spanDays(fromKey, todayKey), fromKey, toKey: todayKey, fromMs: TEAM_PLAN_START_MS, toMs: liveEnd };
    }
    case "custom": {
      const { fromKey, toKey } = normalizeCustom(sel.fromKey, sel.toKey, todayKey);
      const fromMs = hourStartOf(dayKeyToLocalStart(fromKey));
      const toMs = Math.min(dayKeyToLocalStart(addLocalDays(toKey, 1)), liveEnd);
      return { key: "custom", days: spanDays(fromKey, toKey), fromKey, toKey, fromMs, toMs };
    }
    default: {
      const days = PRESET_DAYS[sel.key];
      const fromKey = addLocalDays(todayKey, -(days - 1));
      return { key: sel.key, days, fromKey, toKey: todayKey, fromMs: hourStartOf(dayKeyToLocalStart(fromKey)), toMs: liveEnd };
    }
  }
}

/** A real YYYY-MM-DD calendar day (rejects 2026-02-31 and the like). */
export function isDayKey(key: unknown): key is string {
  return typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key) && localDayKey(dayKeyToLocalStart(key)) === key;
}

/** Order the ends, never look past today, and cap the span at MAX_CUSTOM_DAYS (the start moves). */
export function normalizeCustom(fromKey: string, toKey: string, todayKey: string): { fromKey: string; toKey: string } {
  let a = isDayKey(fromKey) ? fromKey : todayKey;
  let b = isDayKey(toKey) ? toKey : todayKey;
  if (a > b) [a, b] = [b, a];
  if (b > todayKey) b = todayKey;
  if (a > b) a = b;
  const earliest = addLocalDays(b, -(MAX_CUSTOM_DAYS - 1));
  if (a < earliest) a = earliest;
  return { fromKey: a, toKey: b };
}

/** Days the active-hours heatmap covers: the range, widened to the trailing week when it is shorter. */
export interface ActiveHoursWindow {
  fromKey: string;
  fromMs: number;
  days: number;
  /** True when the window is wider than the selected range. */
  widened: boolean;
}

export function activeHoursWindow(bounds: RangeBounds): ActiveHoursWindow {
  if (bounds.days >= MIN_ACTIVE_HOURS_DAYS) return { fromKey: bounds.fromKey, fromMs: bounds.fromMs, days: bounds.days, widened: false };
  const fromKey = addLocalDays(bounds.toKey, -(MIN_ACTIVE_HOURS_DAYS - 1));
  return { fromKey, fromMs: hourStartOf(dayKeyToLocalStart(fromKey)), days: MIN_ACTIVE_HOURS_DAYS, widened: true };
}

/** Storage form of a selection. Presets are stored as their bare key so older saved values keep working. */
export function serializeRange(sel: RangeSelection): string {
  return sel.key === "custom" || sel.key === "plan" ? JSON.stringify(sel) : sel.key;
}

export function parseRange(raw: string | null | undefined): RangeSelection | null {
  if (!raw) return null;
  if ((PRESET_KEYS as string[]).includes(raw)) return { key: raw as PresetKey };
  try {
    const v = JSON.parse(raw) as { key?: unknown; fromKey?: unknown; toKey?: unknown } | null;
    if (!v || typeof v.key !== "string") return null;
    if ((PRESET_KEYS as string[]).includes(v.key)) return { key: v.key as PresetKey };
    if (v.key === "plan") return { key: "plan" };
    if (v.key === "custom" && isDayKey(v.fromKey) && isDayKey(v.toKey)) return { key: "custom", fromKey: v.fromKey, toKey: v.toKey };
  } catch {
    /* not JSON */
  }
  return null;
}

/** Split [from, to) into consecutive chunks no longer than maxMs (Convex caps a single query at 62 days). */
export function splitRange(from: number, to: number, maxMs = 60 * DAY): Array<{ from: number; to: number }> {
  const chunks: Array<{ from: number; to: number }> = [];
  let start = from;
  while (start < to) {
    const end = Math.min(to, start + maxMs);
    chunks.push({ from: start, to: end });
    start = end;
  }
  return chunks;
}
