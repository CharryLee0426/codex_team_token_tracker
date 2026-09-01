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

export function fmtMonth(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), { month: "short" }).format(new Date(year, month - 1, 1));
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
