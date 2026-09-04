export function intlTag(locale: string): string {
  return locale === "zh" ? "zh-CN" : "en-US";
}

export function fmtDate(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), { year: "numeric", month: "short", day: "numeric" }).format(ms);
}

export function fmtDateTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
}

export function fmtTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

/** "Aug 31" style label for a YYYY-MM-DD local day key. */
export function fmtDayKey(dayKey: string, locale: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat(intlTag(locale), opts).format(new Date(y, m - 1, d));
}

/** "Aug 25, 2026, 00:00 PDT": an instant in a fixed time zone, so the label reads the same everywhere. */
export function fmtInstantIn(ms: number, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(ms);
}

export function fmtMonth(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), { month: "short" }).format(new Date(year, month - 1, 1));
}

/** "August 2026" / "2026年8月" — a calendar heading. */
export function fmtMonthYear(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export function fmtYear(year: number, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), { year: "numeric" }).format(new Date(year, 0, 1));
}

/** "25" / "25日" — a day-of-month on its own. */
export function fmtDayOfMonth(day: number, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), { day: "numeric" }).format(new Date(2000, 0, day));
}

/** "Aug 25 – Sep 3, 2026" for two local day keys; two full dates where formatRange is unavailable. */
export function fmtDayKeyRange(fromKey: string, toKey: string, locale: string): string {
  const [a, b] = [fromKey, toKey].map((k) => {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d);
  });
  const f = new Intl.DateTimeFormat(intlTag(locale), { year: "numeric", month: "short", day: "numeric" });
  return typeof f.formatRange === "function" ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`;
}

export function fmtRelative(ms: number, nowMs: number, locale: string): string {
  const diff = ms - nowMs;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(intlTag(locale), { numeric: "auto" });
  if (abs < 45_000) return rtf.format(0, "second").replace(/^in |^now$/, (m) => (m === "now" ? m : ""));
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return fmtDate(ms, locale);
}

export function fmtNumber(n: number, locale: string, digits = 0): string {
  return new Intl.NumberFormat(intlTag(locale), { maximumFractionDigits: digits }).format(n);
}
