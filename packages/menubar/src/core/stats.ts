import {
  bucketEvents,
  buildHeatmap,
  cacheHitRate,
  computeCost,
  emptyUsage,
  groupByLocalDay,
  isCodexAuthProvider,
  isCanonicalTokenUsage,
  isOpenAIModel,
  localDayKey,
  resolvePrice,
  startOfLocalDay,
  todayKey,
  tryAddUsageInPlace,
  type HourBucket,
  type HourRow,
  type ModelPrice,
  type ParsedSession,
  type RateLimits,
  type TokenUsage,
  type UsageEvent,
} from "@codex-tracker/shared";
import type { AgentStat, LiveState, ModelStat, PeriodStat } from "./snapshot";

export interface StatsInput {
  sessions: ParsedSession[];
  pricing?: Record<string, ModelPrice>;
  remoteRows?: HourRow[];
  now?: number;
  heatmapWeeks?: number;
}

export interface Stats {
  buckets: HourBucket[];
  /** Sessions that produced OpenAI usage — what gets uploaded (see `computeStats`). */
  sessions: ParsedSession[];
  today: PeriodStat;
  week: PeriodStat;
  month: PeriodStat;
  remoteToday: { usage: TokenUsage; cost: number } | null;
  live: LiveState | null;
  lastActivityAt: number | null;
  /** Latest rate limits seen in Codex logs (stale whenever other agents consume the same subscription). */
  logRateLimits: RateLimits | null;
  modelsToday: ModelStat[];
  modelsMonth: ModelStat[];
  byAgentToday: AgentStat[];
  byAgentMonth: AgentStat[];
  heatmap: ReturnType<typeof buildHeatmap>;
  sessionCosts: Map<string, number>;
}

const LIVE_WINDOW_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60_000;
const BURST_WINDOW_MS = 10_000;
const DAY = 86_400_000;

/**
 * Generation speed over the trailing `windowMs`.
 *
 * Only *output* tokens count: an event's `input` is the whole prompt re-sent for that request
 * (tens to hundreds of thousands of tokens of context), so summing `usage.total` reported
 * throughput in the thousands of tok/s instead of the tens the model actually generates.
 *
 * The divisor is the part of the window the session has actually existed for, so a session that
 * started seconds ago is not diluted by time that never happened.
 */
function outputRate(events: UsageEvent[], now: number, windowMs: number, sessionStart: number): number {
  const from = now - windowMs;
  let output = 0;
  for (const e of events) {
    if (e.ts <= from) continue;
    output += e.usage.output;
  }
  if (output <= 0) return 0;
  const elapsedSec = Math.max(1, (now - Math.max(from, sessionStart)) / 1000);
  return output / elapsedSec;
}

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
    if (!tryAddUsageInPlace(usage, e.usage)) continue;
    const nextCost = cost + prices.cost(e.model, e.usage);
    if (Number.isFinite(nextCost)) cost = nextCost;
  }
  return { usage, cost, cacheHitRate: cacheHitRate(usage) };
}

function modelStats(events: Iterable<UsageEvent>, since: number, prices: PriceCache): ModelStat[] {
  const map = new Map<string, ModelStat & { agentSet: Set<string> }>();
  const totalUsage = emptyUsage();
  for (const e of events) {
    if (e.ts < since) continue;
    if (!tryAddUsageInPlace(totalUsage, e.usage)) continue;
    let m = map.get(e.model);
    if (!m) {
      const pm = prices.get(e.model);
      m = { model: e.model, usage: emptyUsage(), cost: 0, share: 0, estimated: pm.estimated, priceKey: pm.matchedKey, agents: [], agentSet: new Set() };
      map.set(e.model, m);
    }
    if (!tryAddUsageInPlace(m.usage, e.usage)) continue;
    const nextCost = m.cost + prices.cost(e.model, e.usage);
    if (Number.isFinite(nextCost)) m.cost = nextCost;
    m.agentSet.add(e.agent || "codex");
  }
  const out = [...map.values()].sort((a, b) => b.usage.total - a.usage.total);
  return out.map(({ agentSet, ...m }) => ({ ...m, agents: [...agentSet].sort(), share: totalUsage.total ? m.usage.total / totalUsage.total : 0 }));
}

function agentStats(sessions: ParsedSession[], since: number, prices: PriceCache): AgentStat[] {
  const map = new Map<string, AgentStat>();
  const totalUsage = emptyUsage();
  for (const s of sessions) {
    let counted = false;
    for (const e of s.events) {
      if (e.ts < since) continue;
      if (!tryAddUsageInPlace(totalUsage, e.usage)) continue;
      const agent = e.agent || s.agent || "codex";
      let a = map.get(agent);
      if (!a) {
        a = { agent, usage: emptyUsage(), cost: 0, share: 0, sessions: 0 };
        map.set(agent, a);
      }
      if (!tryAddUsageInPlace(a.usage, e.usage)) continue;
      const nextCost = a.cost + prices.cost(e.model, e.usage);
      if (Number.isFinite(nextCost)) a.cost = nextCost;
      if (!counted) {
        a.sessions++;
        counted = true;
      }
    }
  }
  const out = [...map.values()].sort((a, b) => b.usage.total - a.usage.total);
  for (const a of out) a.share = totalUsage.total ? a.usage.total / totalUsage.total : 0;
  return out;
}

/**
 * Build the only session shape that may leave the device. Some multi-provider agents keep one
 * session-level cumulative/model/timestamp alongside per-request events, so filtering only the
 * event array can otherwise leave a non-OpenAI summary attached to an OpenAI-only event list.
 */
function codexOAuthSession(session: ParsedSession): ParsedSession | null {
  const events = session.events.filter((event) =>
    Number.isFinite(event.ts)
    && event.ts >= 0
    && isOpenAIModel(event.model)
    && isCodexAuthProvider(event.provider)
    && isCanonicalTokenUsage(event.usage));
  if (!events.length) return null;

  const cumulative = emptyUsage();
  let firstEventAt = events[0].ts;
  let lastActivityAt = events[0].ts;
  let latest = events[0];
  for (const event of events) {
    // Fail closed for this session if individually valid records still overflow when combined.
    if (!tryAddUsageInPlace(cumulative, event.usage)) return null;
    if (event.ts < firstEventAt) firstEventAt = event.ts;
    if (event.ts >= lastActivityAt) {
      lastActivityAt = event.ts;
      latest = event;
    }
  }

  // Session metadata can predate the first usage record and is the correct denominator for a new
  // session's live rate. Later activity is safe to preserve only for native Codex: its entire file
  // is gated by one auth sidecar, while multi-provider parsers may have advanced their timestamp on
  // a record that was excluded before this final boundary.
  const startedAt = Number.isFinite(session.startedAt) && session.startedAt > 0
    ? Math.min(session.startedAt, firstEventAt)
    : firstEventAt;
  if (
    session.agent === "codex"
    && events.length === session.events.length
    && Number.isFinite(session.lastActivityAt)
    && session.lastActivityAt > lastActivityAt
  ) lastActivityAt = session.lastActivityAt;

  return {
    ...session,
    provider: latest.provider ?? null,
    startedAt,
    lastActivityAt,
    model: latest.model,
    events,
    cumulative,
  };
}

export function computeStats(input: StatsInput): Stats {
  const now = input.now ?? Date.now();
  const prices = new PriceCache(input.pricing);
  // Codex OAuth-only dashboard: drop API-key and non-OpenAI usage, then rebuild each summary from
  // those retained events before session metadata or totals can be uploaded.
  const sessions = input.sessions.map(codexOAuthSession).filter((session): session is ParsedSession => session !== null);
  const allEvents: UsageEvent[] = [];
  const sessionCosts = new Map<string, number>();
  let lastActivityAt: number | null = null;
  let latestLimits: RateLimits | null = null;

  for (const s of sessions) {
    let cost = 0;
    for (const e of s.events) {
      allEvents.push(e);
      const nextCost = cost + prices.cost(e.model, e.usage);
      if (Number.isFinite(nextCost)) cost = nextCost;
    }
    sessionCosts.set(`${s.agent}:${s.sessionId}`, cost);
    if (s.lastActivityAt && (lastActivityAt === null || s.lastActivityAt > lastActivityAt)) lastActivityAt = s.lastActivityAt;
    if (s.rateLimits && (!latestLimits || s.rateLimits.observedAt > latestLimits.observedAt)) latestLimits = s.rateLimits;
  }

  const dayStart = startOfLocalDay(now);
  const today = periodStat(allEvents, dayStart, prices);
  const week = periodStat(allEvents, dayStart - 6 * DAY, prices);
  const month = periodStat(allEvents, dayStart - 29 * DAY, prices);
  const modelsToday = modelStats(allEvents, dayStart, prices);
  const modelsMonth = modelStats(allEvents, dayStart - 29 * DAY, prices);
  const byAgentToday = agentStats(sessions, dayStart, prices);
  const byAgentMonth = agentStats(sessions, dayStart - 29 * DAY, prices);

  // live session: most recent activity within the live window, across every agent
  let live: LiveState | null = null;
  const liveSession = sessions
    .filter((s) => s.events.length && now - s.lastActivityAt <= LIVE_WINDOW_MS)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
  if (liveSession) {
    const last = liveSession.events[liveSession.events.length - 1];
    const start = liveSession.startedAt || liveSession.events[0].ts;
    live = {
      sessionId: liveSession.sessionId,
      agent: liveSession.agent,
      projectName: liveSession.projectName,
      model: liveSession.model,
      startedAt: liveSession.startedAt,
      lastEventAt: last.ts,
      tokensPerSecond: outputRate(liveSession.events, now, RATE_WINDOW_MS, start),
      tokensPerSecond10s: outputRate(liveSession.events, now, BURST_WINDOW_MS, start),
      contextUsed: last.usage.input + last.usage.output,
      contextWindow: liveSession.contextWindow,
      sessionUsage: { ...liveSession.cumulative },
      sessionCost: sessionCosts.get(`${liveSession.agent}:${liveSession.sessionId}`) ?? 0,
    };
  }

  // hourly buckets (UTC, per model × agent) → local heatmap, merged with rows from other devices
  const bucketMap = bucketEvents(allEvents, input.pricing);
  const buckets = [...bucketMap.values()];
  const rows: HourRow[] = buckets.map((b) => ({ hourStart: b.hourStart, model: b.model, agent: b.agent, usage: b.usage, cost: b.cost }));
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
      if (!tryAddUsageInPlace(usage, r.usage)) continue;
      const nextCost = cost + r.cost;
      if (Number.isFinite(nextCost)) cost = nextCost;
    }
    remoteToday = { usage, cost };
  }

  return {
    buckets,
    sessions,
    today,
    week,
    month,
    remoteToday,
    live,
    lastActivityAt,
    logRateLimits: latestLimits,
    modelsToday,
    modelsMonth,
    byAgentToday,
    byAgentMonth,
    heatmap,
    sessionCosts,
  };
}
