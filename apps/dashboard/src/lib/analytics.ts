import { expandCompactRows } from "@codex-tracker/shared/wire";
import { addUsageInPlace, cacheHitRate, emptyUsage, type TokenUsage } from "@codex-tracker/shared/usage";
import { isOpenAIModel, resolvePrice } from "@codex-tracker/shared/pricing";
import { groupByAgent, groupByLocalDay, groupByModel } from "@codex-tracker/shared/aggregate";
import { dayKeyRange, localParts, dayKeyToLocalStart } from "@codex-tracker/shared/time";

export type UsageRow = ReturnType<typeof expandCompactRows>[number];
export const OTHER_KEY = "__other__";
export const MAX_SERIES = 8;

/**
 * Keep only Codex (OpenAI) consumption. Devices running ≥ 0.2.0 already filter locally, but rows
 * uploaded by older clients from multi-provider agents (Cline/Roo/Kilo, OpenCode) can carry
 * Anthropic/Google/local models — this dashboard does not report those.
 */
export function codexRows(rows: UsageRow[]): UsageRow[] {
  return rows.filter((r) => isOpenAIModel(r.model ?? "unknown"));
}

export interface Summary {
  usage: TokenUsage;
  cost: number;
  cacheHit: number;
  activeUsers: number;
  models: number;
}

export function summarize(rows: UsageRow[]): Summary {
  const usage = emptyUsage();
  let cost = 0;
  const users = new Set<string>();
  const models = new Set<string>();
  for (const r of rows) {
    addUsageInPlace(usage, r.usage);
    cost += r.cost;
    users.add(r.userId);
    models.add(r.model);
  }
  return { usage, cost, cacheHit: cacheHitRate(usage), activeUsers: users.size, models: models.size };
}

export interface ModelStat {
  model: string;
  usage: TokenUsage;
  cost: number;
  share: number;
  estimated: boolean;
  matchedKey: string | null;
}

export function modelBreakdown(rows: UsageRow[]): ModelStat[] {
  const grouped = groupByModel(rows);
  const total = [...grouped.values()].reduce((a, c) => a + c.usage.total, 0) || 1;
  return [...grouped.values()]
    .map((c) => {
      const p = resolvePrice(c.key);
      return { model: c.key, usage: c.usage, cost: c.cost, share: c.usage.total / total, estimated: p.estimated, matchedKey: p.matchedKey };
    })
    .sort((a, b) => b.usage.total - a.usage.total);
}

export interface AgentStat {
  agent: string; // "codex" | "pi" | "hermes" | "opencode" | "cline" | ...
  usage: TokenUsage;
  cost: number;
  share: number;
}

/** Usage split by the tool that produced it (Codex CLI/Desktop vs. other Codex-OAuth agents). */
export function agentBreakdown(rows: UsageRow[]): AgentStat[] {
  const grouped = groupByAgent(rows);
  const total = [...grouped.values()].reduce((a, c) => a + c.usage.total, 0) || 1;
  return [...grouped.values()]
    .map((c) => ({ agent: c.key, usage: c.usage, cost: c.cost, share: c.usage.total / total }))
    .sort((a, b) => b.usage.total - a.usage.total);
}

/**
 * Stable series order: keep the order already assigned (so colors never repaint on data updates),
 * append newly seen models sorted by volume. Returns at most MAX_SERIES names; the rest fold into Other.
 */
export function orderModels(stats: ModelStat[], previous: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of previous) {
    if (stats.some((s) => s.model === m) && !seen.has(m)) {
      out.push(m);
      seen.add(m);
    }
  }
  for (const s of stats) {
    if (!seen.has(s.model)) {
      out.push(s.model);
      seen.add(s.model);
    }
  }
  return out.slice(0, MAX_SERIES);
}

export interface DailyStackPoint {
  day: string; // YYYY-MM-DD local
  total: number;
  cost: number;
  values: Record<string, number>; // model (or OTHER_KEY) → tokens
}

export function dailyStack(rows: UsageRow[], fromKey: string, toKey: string, series: string[]): DailyStackPoint[] {
  const byDay = new Map<string, DailyStackPoint>();
  for (const key of dayKeyRange(fromKey, toKey)) byDay.set(key, { day: key, total: 0, cost: 0, values: {} });
  const seriesSet = new Set(series);
  for (const r of rows) {
    const key = localParts(r.hourStart).dayKey;
    const p = byDay.get(key);
    if (!p) continue;
    const k = seriesSet.has(r.model) ? r.model : OTHER_KEY;
    p.values[k] = (p.values[k] ?? 0) + r.usage.total;
    p.total += r.usage.total;
    p.cost += r.cost;
  }
  return [...byDay.values()];
}

export interface WeekdayPoint {
  weekday: number; // 0=Sun..6=Sat
  day: string; // YYYY-MM-DD local
  total: number;
  cost: number;
}

/** One local calendar week, including zero-usage days, ordered Monday through Sunday. */
export function weekdaySeries(rows: UsageRow[], fromKey: string, toKey: string): WeekdayPoint[] {
  const totals = groupByLocalDay(rows);
  return dayKeyRange(fromKey, toKey).map((day) => {
    const c = totals.get(day);
    return { weekday: new Date(dayKeyToLocalStart(day)).getDay(), day, total: c?.usage.total ?? 0, cost: c?.cost ?? 0 };
  });
}

export interface ActiveHoursDay {
  day: string;
  weekday: number;
  hours: number[];
}

export interface ActiveHoursRow {
  weekday: number;
  hours: number[];
  days: ActiveHoursDay[];
}

/** Exact selected dates × local hours. Repeated DST hours share a slot without losing tokens. */
export function activeHoursDays(rows: UsageRow[], fromKey: string, toKey: string): ActiveHoursDay[] {
  const days = new Map<string, ActiveHoursDay>();
  for (const day of dayKeyRange(fromKey, toKey)) {
    days.set(day, { day, weekday: new Date(dayKeyToLocalStart(day)).getDay(), hours: new Array<number>(24).fill(0) });
  }
  for (const row of rows) {
    const { dayKey, hour } = localParts(row.hourStart);
    const day = days.get(dayKey);
    if (day) day.hours[hour] += row.usage.total;
  }
  return [...days.values()];
}

/** Weekday totals retain the dated values behind each heatmap cell. */
export function activeHoursRows(days: ActiveHoursDay[]): ActiveHoursRow[] {
  return [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    const matching = days.filter((day) => day.weekday === weekday);
    const hours = new Array<number>(24).fill(0);
    for (const day of matching) day.hours.forEach((v, h) => (hours[h] += v));
    return { weekday, hours, days: matching };
  }).filter((row) => row.days.length > 0);
}

export interface MemberStat {
  userId: string;
  usage: TokenUsage;
  cost: number;
  cacheHit: number;
  lastHour: number | null;
  share: number;
}

export function memberStats(rows: UsageRow[]): MemberStat[] {
  const map = new Map<string, MemberStat>();
  let grand = 0;
  for (const r of rows) {
    let s = map.get(r.userId);
    if (!s) {
      s = { userId: r.userId, usage: emptyUsage(), cost: 0, cacheHit: 0, lastHour: null, share: 0 };
      map.set(r.userId, s);
    }
    addUsageInPlace(s.usage, r.usage);
    s.cost += r.cost;
    if (s.lastHour === null || r.hourStart > s.lastHour) s.lastHour = r.hourStart;
    grand += r.usage.total;
  }
  const out = [...map.values()];
  for (const s of out) {
    s.cacheHit = cacheHitRate(s.usage);
    s.share = grand ? s.usage.total / grand : 0;
  }
  return out.sort((a, b) => b.usage.total - a.usage.total);
}

export function daysMap(rows: UsageRow[]) {
  return groupByLocalDay(rows);
}
