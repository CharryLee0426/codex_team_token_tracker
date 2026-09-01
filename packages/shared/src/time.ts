export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Floor a UTC ms timestamp to the start of its UTC hour. */
export function hourStartOf(ms: number): number {
  return Math.floor(ms / HOUR) * HOUR;
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  weekday: number; // 0=Sunday .. 6=Saturday
  dayKey: string; // YYYY-MM-DD
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function dayKeyOf(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Break a UTC timestamp into wall-clock parts in the machine's local time zone (default)
 * or in an explicit IANA time zone.
 */
export function localParts(ms: number, tz?: string): LocalParts {
  if (!tz) {
    const d = new Date(ms);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return { year, month, day, hour: d.getHours(), weekday: d.getDay(), dayKey: dayKeyOf(year, month, day) };
  }
  const parts = formatterFor(tz).formatToParts(new Date(ms));
  let year = 0, month = 0, day = 0, hour = 0, weekday = 0;
  for (const p of parts) {
    switch (p.type) {
      case "year": year = Number(p.value); break;
      case "month": month = Number(p.value); break;
      case "day": day = Number(p.value); break;
      case "hour": hour = Number(p.value) % 24; break;
      case "weekday": weekday = WEEKDAYS[p.value] ?? 0; break;
    }
  }
  return { year, month, day, hour, weekday, dayKey: dayKeyOf(year, month, day) };
}

export function localDayKey(ms: number, tz?: string): string {
  return localParts(ms, tz).dayKey;
}

/** Start (ms) of the local calendar day containing `ms` (machine time zone). */
export function startOfLocalDay(ms: number = Date.now()): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Parse a YYYY-MM-DD key into the local-midnight timestamp. */
export function dayKeyToLocalStart(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export function addLocalDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dayKeyOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

export function todayKey(): string {
  return localDayKey(Date.now());
}

export function machineTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Inclusive list of day keys from `from` to `to`. */
export function dayKeyRange(from: string, to: string): string[] {
  const out: string[] = [];
  let k = from;
  let guard = 0;
  while (k <= to && guard++ < 5000) {
    out.push(k);
    k = addLocalDays(k, 1);
  }
  return out;
}
