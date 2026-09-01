import { en, type MessageKey } from "./en";
import { zh } from "./zh";

export type Language = "en" | "zh";
export type LanguageSetting = Language | "auto";
export type { MessageKey };

const catalogs: Record<Language, Record<MessageKey, string>> = { en, zh };

export function t(lang: Language, key: MessageKey, params?: Record<string, string | number>): string {
  let s: string = catalogs[lang]?.[key] ?? en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Map a locale tag / env value to a supported language. */
export function languageFromLocale(locale: string | null | undefined): Language {
  const l = (locale ?? "").toLowerCase();
  return l.startsWith("zh") ? "zh" : "en";
}

export function resolveLanguage(setting: LanguageSetting, systemLocale: string | null | undefined): Language {
  return setting === "auto" ? languageFromLocale(systemLocale) : setting;
}

export function makeT(lang: Language) {
  return (key: MessageKey, params?: Record<string, string | number>) => t(lang, key, params);
}

/** Localized relative time ("3 minutes ago" / "3 分钟前"). */
export function relativeTime(lang: Language, ts: number | null, now = Date.now()): string {
  if (!ts) return t(lang, "never");
  const diff = ts - now;
  const abs = Math.abs(diff);
  if (abs < 10_000) return t(lang, "justNow");
  const rtf = new Intl.RelativeTimeFormat(lang === "zh" ? "zh-CN" : "en", { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "second") return rtf.format(Math.round(diff / ms), unit);
  }
  return t(lang, "justNow");
}

/** Localized duration for "resets in …" ("2h 15m" / "2 小时 15 分"). */
export function durationShort(lang: Language, ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (lang === "zh") {
    if (d > 0) return `${d} 天 ${h} 小时`;
    if (h > 0) return `${h} 小时 ${m} 分`;
    return `${m} 分`;
  }
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function windowLabel(lang: Language, minutes: number | null): string {
  if (!minutes) return "";
  if (minutes >= 7 * 24 * 60 - 1) return t(lang, "weekly");
  if (minutes >= 24 * 60) return t(lang, "days", { n: Math.round(minutes / (24 * 60)) });
  return t(lang, "hours", { n: Math.round(minutes / 60) });
}

export function localeTag(lang: Language): string {
  return lang === "zh" ? "zh-CN" : "en-US";
}
