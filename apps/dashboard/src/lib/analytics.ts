import { expandCompactRows } from "@codex-tracker/shared/wire";
import { addUsageInPlace, cacheHitRate, emptyUsage, type TokenUsage } from "@codex-tracker/shared/usage";
import { resolvePrice } from "@codex-tracker/shared/pricing";
import { groupByAgent, groupByLocalDay, groupByModel, weekdayHourMatrix, weekdayTotals } from "@codex-tracker/shared/aggregate";
import { dayKeyRange, localParts, dayKeyToLocalStart } from "@codex-tracker/shared/time";

export type UsageRow = ReturnType<typeof expandCompactRows>[number];
export const OTHER_KEY = "__other__";
export const MAX_SERIES = 8;

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
  total: number;
  cost: number;
  days: number; // occurrences of this weekday in the range
  avg: number;
}

/** Mon..Sun ordered totals with per-occurrence averages. */
export function weekdaySeries(rows: UsageRow[], fromKey: string, toKey: string): WeekdayPoint[] {
  const totals = weekdayTotals(rows);
  const occurrences = new Array<number>(7).fill(0);
  for (const key of dayKeyRange(fromKey, toKey)) occurrences[new Date(dayKeyToLocalStart(key)).getDay()]++;
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((wd) => {
    const c = totals[wd];
    const days = occurrences[wd];
    return { weekday: wd, total: c.usage.total, cost: c.cost, days, avg: days ? c.usage.total / days : 0 };
  });
}

/** Rows Mon..Sun (index 0 = Monday) × 24 local hours. */
export function activeHoursRows(rows: UsageRow[]): { weekday: number; hours: number[] }[] {
  const m = weekdayHourMatrix(rows);
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => ({ weekday: wd, hours: m[wd] }));
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
