import {
  bucketEvents,
  buildHeatmap,
  cacheHitRate,
  computeCost,
  emptyUsage,
  addUsageInPlace,
  groupByLocalDay,
  localDayKey,
  resolvePrice,
  startOfLocalDay,
  todayKey,
  type HourBucket,
  type HourRow,
  type ModelPrice,
  type ParsedSession,
  type RateLimits,
  type TokenUsage,
  type UsageEvent,
} from "@codex-tracker/shared";
import type { LiveState, ModelStat, PeriodStat } from "./snapshot";

export interface StatsInput {
  sessions: ParsedSession[];
  pricing?: Record<string, ModelPrice>;
  remoteRows?: HourRow[];
  now?: number;
  heatmapWeeks?: number;
}

export interface Stats {
  buckets: HourBucket[];
  today: PeriodStat;
  week: PeriodStat;
  month: PeriodStat;
  remoteToday: { usage: TokenUsage; cost: number } | null;
  live: LiveState | null;
  lastActivityAt: number | null;
  rateLimits: RateLimits | null;
  modelsToday: ModelStat[];
  modelsMonth: ModelStat[];
  heatmap: ReturnType<typeof buildHeatmap>;
  sessionCosts: Map<string, number>;
}

const LIVE_WINDOW_MS = 5 * 60 * 1000;
const DAY = 86_400_000;

class PriceCache {
  private cache = new Map<string, ReturnType<typeof resolvePrice>>();
  constructor(private overrides?: Record<string, ModelPrice>) {}
  get(model: string) {
    let m = this.cache.get(model);
    if (!m) {
      m = resolvePrice(model, this.overrides);
      this.cache.set(model, m);
    }
    return m;
  }
  cost(model: string, u: Partial<TokenUsage>): number {
    return computeCost(u, this.get(model).price);
  }
}

function periodStat(events: Iterable<UsageEvent>, since: number, prices: PriceCache): PeriodStat {
  const usage = emptyUsage();
  let cost = 0;
  for (const e of events) {
    if (e.ts < since) continue;
    addUsageInPlace(usage, e.usage);
    cost += prices.cost(e.model, e.usage);
  }
  return { usage, cost, cacheHitRate: cacheHitRate(usage) };
}

function modelStats(events: Iterable<UsageEvent>, since: number, prices: PriceCache): ModelStat[] {
  const map = new Map<string, ModelStat>();
  let total = 0;
  for (const e of events) {
    if (e.ts < since) continue;
    let m = map.get(e.model);
    if (!m) {
      const pm = prices.get(e.model);
      m = { model: e.model, usage: emptyUsage(), cost: 0, share: 0, estimated: pm.estimated, priceKey: pm.matchedKey };
      map.set(e.model, m);
    }
    addUsageInPlace(m.usage, e.usage);
    m.cost += prices.cost(e.model, e.usage);
    total += e.usage.total;
  }
  const out = [...map.values()].sort((a, b) => b.usage.total - a.usage.total);
  for (const m of out) m.share = total ? m.usage.total / total : 0;
  return out;
}

export function computeStats(input: StatsInput): Stats {
  const now = input.now ?? Date.now();
  const prices = new PriceCache(input.pricing);
  const sessions = input.sessions;
  const allEvents: UsageEvent[] = [];
  const sessionCosts = new Map<string, number>();
  let lastActivityAt: number | null = null;
  let latestLimits: RateLimits | null = null;

  for (const s of sessions) {
    let cost = 0;
    for (const e of s.events) {
      allEvents.push(e);
      cost += prices.cost(e.model, e.usage);
    }
    sessionCosts.set(s.sessionId, cost);
    if (s.lastActivityAt && (lastActivityAt === null || s.lastActivityAt > lastActivityAt)) lastActivityAt = s.lastActivityAt;
    if (s.rateLimits && (!latestLimits || s.rateLimits.observedAt > latestLimits.observedAt)) latestLimits = s.rateLimits;
  }

  const dayStart = startOfLocalDay(now);
  const today = periodStat(allEvents, dayStart, prices);
  const week = periodStat(allEvents, dayStart - 6 * DAY, prices);
  const month = periodStat(allEvents, dayStart - 29 * DAY, prices);
  const modelsToday = modelStats(allEvents, dayStart, prices);
  const modelsMonth = modelStats(allEvents, dayStart - 29 * DAY, prices);

  // live session: most recent activity within the live window
  let live: LiveState | null = null;
  const liveSession = sessions
    .filter((s) => s.events.length && now - s.lastActivityAt <= LIVE_WINDOW_MS)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
  if (liveSession) {
    let t60 = 0;
    let t10 = 0;
    for (const e of liveSession.events) {
      const age = now - e.ts;
      if (age <= 60_000) t60 += e.usage.total;
      if (age <= 10_000) t10 += e.usage.total;
    }
    const last = liveSession.events[liveSession.events.length - 1];
    live = {
      sessionId: liveSession.sessionId,
      projectName: liveSession.projectName,
      model: liveSession.model,
      startedAt: liveSession.startedAt,
      lastEventAt: last.ts,
      tokensPerSecond: t60 / 60,
      tokensPerSecond10s: t10 / 10,
      contextUsed: last.usage.input + last.usage.output,
      contextWindow: liveSession.contextWindow,
      sessionUsage: { ...liveSession.cumulative },
      sessionCost: sessionCosts.get(liveSession.sessionId) ?? 0,
    };
  }

  // hourly buckets (UTC) → local heatmap, merged with rows from other devices
  const bucketMap = bucketEvents(allEvents, input.pricing);
  const buckets = [...bucketMap.values()];
  const rows: HourRow[] = buckets.map((b) => ({ hourStart: b.hourStart, model: b.model, usage: b.usage, cost: b.cost }));
  const remoteRows = input.remoteRows ?? [];
  const days = groupByLocalDay([...rows, ...remoteRows]);
  const heatmap = buildHeatmap(days, todayKey(), input.heatmapWeeks ?? 16);

  let remoteToday: Stats["remoteToday"] = null;
  if (remoteRows.length) {
    const tk = localDayKey(now);
    const usage = emptyUsage();
    let cost = 0;
    for (const r of remoteRows) {
      if (localDayKey(r.hourStart) !== tk) continue;
      addUsageInPlace(usage, r.usage);
      cost += r.cost;
    }
    remoteToday = { usage, cost };
  }

  return {
    buckets,
    today,
    week,
    month,
    remoteToday,
    live,
    lastActivityAt,
    rateLimits: latestLimits,
    modelsToday,
    modelsMonth,
    heatmap,
    sessionCosts,
  };
}
