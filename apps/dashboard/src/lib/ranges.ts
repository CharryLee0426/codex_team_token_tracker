import { DAY, HOUR, addLocalDays, dayKeyToLocalStart, hourStartOf, localDayKey } from "@codex-tracker/shared/time";

export type RangeKey = "today" | "7d" | "30d" | "90d" | "365d";
export const RANGE_KEYS: RangeKey[] = ["today", "7d", "30d", "90d", "365d"];
export const RANGE_DAYS: Record<RangeKey, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90, "365d": 365 };

export interface RangeBounds {
  key: RangeKey;
  days: number;
  fromKey: string; // local day key (inclusive)
  toKey: string; // local day key (inclusive, today)
  fromMs: number; // local midnight of fromKey
  toMs: number; // end of current UTC hour (exclusive)
}

/** Local-time range ending today, aligned to whole UTC hours for querying. */
export function rangeBounds(key: RangeKey, nowMs: number): RangeBounds {
  const days = RANGE_DAYS[key];
  const toKey = localDayKey(nowMs);
  const fromKey = addLocalDays(toKey, -(days - 1));
  const fromMs = hourStartOf(dayKeyToLocalStart(fromKey));
  const toMs = hourStartOf(nowMs) + HOUR;
  return { key, days, fromKey, toKey, fromMs, toMs };
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
