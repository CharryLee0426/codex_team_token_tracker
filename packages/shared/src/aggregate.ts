import { hourStartOf, localParts, addLocalDays, dayKeyRange } from "./time.ts";
import { emptyUsage, addUsageInPlace, type TokenUsage } from "./usage.ts";
import { resolvePrice, computeCost, type ModelPrice } from "./pricing.ts";
import type { UsageEvent } from "./codex-parser.ts";

/** One (UTC hour, model) bucket – the unit uploaded to and stored in the realtime database. */
export interface HourBucket {
  hourStart: number; // UTC ms
  model: string;
  agent: string; // "codex" | "pi" | ...
  usage: TokenUsage;
  cost: number;
}

export function bucketKey(hourStart: number, model: string, agent = "codex"): string {
  return `${hourStart}|${model}|${agent}`;
}

export function bucketEvents(
  events: Iterable<UsageEvent>,
  pricing?: Record<string, ModelPrice>,
  into: Map<string, HourBucket> = new Map(),
): Map<string, HourBucket> {
  const priceCache = new Map<string, ModelPrice>();
  for (const e of events) {
    const hourStart = hourStartOf(e.ts);
    const agent = e.agent || "codex";
    const key = bucketKey(hourStart, e.model, agent);
    let b = into.get(key);
    if (!b) {
      b = { hourStart, model: e.model, agent, usage: emptyUsage(), cost: 0 };
      into.set(key, b);
    }
    addUsageInPlace(b.usage, e.usage);
    let p = priceCache.get(e.model);
    if (!p) {
      p = resolvePrice(e.model, pricing).price;
      priceCache.set(e.model, p);
    }
    b.cost += computeCost(e.usage, p);
  }
  return into;
}

/** A generic hourly row from either local buckets or the database. */
export interface HourRow {
  hourStart: number;
  model?: string;
  agent?: string;
  usage: TokenUsage;
  cost: number;
  userId?: string;
  deviceId?: string;
}

export interface Cell {
  key: string;
  usage: TokenUsage;
  cost: number;
}

function accumulate(map: Map<string, Cell>, key: string, r: HourRow) {
  let c = map.get(key);
  if (!c) {
    c = { key, usage: emptyUsage(), cost: 0 };
    map.set(key, c);
  }
  addUsageInPlace(c.usage, r.usage);
  c.cost += r.cost;
}

/** Group hourly rows by local calendar day (YYYY-MM-DD) in the machine (or given) time zone. */
export function groupByLocalDay(rows: Iterable<HourRow>, tz?: string): Map<string, Cell> {
  const out = new Map<string, Cell>();
  for (const r of rows) accumulate(out, localParts(r.hourStart, tz).dayKey, r);
  return out;
}

export function groupByModel(rows: Iterable<HourRow>): Map<string, Cell> {
  const out = new Map<string, Cell>();
  for (const r of rows) accumulate(out, r.model ?? "unknown", r);
  return out;
}

export function groupByAgent(rows: Iterable<HourRow>): Map<string, Cell> {
  const out = new Map<string, Cell>();
  for (const r of rows) accumulate(out, r.agent ?? "codex", r);
  return out;
}

export function groupByUser(rows: Iterable<HourRow>): Map<string, Cell> {
  const out = new Map<string, Cell>();
  for (const r of rows) accumulate(out, r.userId ?? "me", r);
  return out;
}

/** 7×24 matrix of total tokens: [weekday 0=Sun..6][hour 0..23] in local time. */
export function weekdayHourMatrix(rows: Iterable<HourRow>, tz?: string): number[][] {
  const m: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of rows) {
    const p = localParts(r.hourStart, tz);
    m[p.weekday][p.hour] += r.usage.total;
  }
  return m;
}

/** Totals per local weekday (index 0=Sun..6=Sat). */
export function weekdayTotals(rows: Iterable<HourRow>, tz?: string): Cell[] {
  const cells: Cell[] = Array.from({ length: 7 }, (_, i) => ({ key: String(i), usage: emptyUsage(), cost: 0 }));
  for (const r of rows) {
    const c = cells[localParts(r.hourStart, tz).weekday];
    addUsageInPlace(c.usage, r.usage);
    c.cost += r.cost;
  }
  return cells;
}

/** Totals per local hour of day (0..23). */
export function hourOfDayTotals(rows: Iterable<HourRow>, tz?: string): Cell[] {
  const cells: Cell[] = Array.from({ length: 24 }, (_, i) => ({ key: String(i), usage: emptyUsage(), cost: 0 }));
  for (const r of rows) {
    const c = cells[localParts(r.hourStart, tz).hour];
    addUsageInPlace(c.usage, r.usage);
    c.cost += r.cost;
  }
  return cells;
}

export interface HeatmapDay {
  dayKey: string;
  value: number; // total tokens
  cost: number;
  level: 0 | 1 | 2 | 3 | 4;
  usage: TokenUsage;
}

export interface HeatmapGrid {
  weeks: HeatmapDay[][]; // each week = 7 days, Sunday..Saturday; padded days have dayKey "" and value 0
  max: number;
  from: string;
  to: string;
}

/** Quantize a value into 5 levels (0 = none). Uses quantiles so a few outliers don't wash out the map. */
export function quantizeLevels(values: number[]): (v: number) => 0 | 1 | 2 | 3 | 4 {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return () => 0;
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75);
  return (v) => (v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4);
}

/**
 * Build a GitHub-style calendar grid ending on `endDay` (local day key), spanning `weeks` weeks.
 * Weeks run Sunday..Saturday.
 */
export function buildHeatmap(days: Map<string, Cell>, endDay: string, weeks: number): HeatmapGrid {
  // find the Saturday on/after endDay to complete the last column, then walk back
  const endParts = endDay.split("-").map(Number);
  const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);
  const padAfter = 6 - endDate.getDay();
  const lastCell = addLocalDays(endDay, padAfter);
  const firstCell = addLocalDays(lastCell, -(weeks * 7 - 1));
  const keys = dayKeyRange(firstCell, lastCell);
  const values = keys.map((k) => days.get(k)?.usage.total ?? 0);
  const level = quantizeLevels(values);
  const max = Math.max(0, ...values);
  const grid: HeatmapDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: HeatmapDay[] = [];
    for (let d = 0; d < 7; d++) {
      const idx = w * 7 + d;
      const key = keys[idx];
      const cell = days.get(key);
      const future = key > endDay;
      const v = future ? 0 : (cell?.usage.total ?? 0);
      week.push({
        dayKey: future ? "" : key,
        value: v,
        cost: cell?.cost ?? 0,
        level: future ? 0 : level(v),
        usage: cell?.usage ?? emptyUsage(),
      });
    }
    grid.push(week);
  }
  return { weeks: grid, max, from: firstCell, to: endDay };
}

/** Daily series for line/bar charts over a local day range (inclusive), zero-filled. */
export function dailySeries(days: Map<string, Cell>, from: string, to: string): Cell[] {
  return dayKeyRange(from, to).map((k) => days.get(k) ?? { key: k, usage: emptyUsage(), cost: 0 });
}
