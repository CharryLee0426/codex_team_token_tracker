/** Wire types shared between the menubar/agent uploader, the Convex backend and the dashboard. */
import type { PricingEntry } from "./openai-pricing-page.ts";

/**
 * Bumped when the client sends fields an older backend would reject. Clients read it from
 * `<dashboard>/api/config` and only send the newer fields when the backend understands them.
 *   1 — initial protocol
 *   2 — `machineId` on device-auth start and heartbeats (one device per machine, 0.3.0)
 *   3 — the backend prices uploads itself: buckets and sessions carry token counts only (`cost` is
 *       omitted), plus the `long` split and per-session `models` breakdown that make server-side
 *       pricing exact (0.5.0). Backends < 3 still need the device-computed `cost`.
 */
export const WIRE_VERSION = 3;
/** Wire version from which the backend prices uploads and ignores a device-computed `cost`. */
export const WIRE_SERVER_PRICING = 3;
export const DEVICE_AUTH_TTL_MS = 15 * 60 * 1000;
export const DEVICE_TOKEN_PREFIX = "cxt_";
export const MAX_BUCKETS_PER_PUSH = 400;
export const MAX_SESSIONS_PER_PUSH = 100;

/** Token counts of an aggregate (see `TokenUsage` for the field invariants). */
export interface UploadUsage {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
  requests: number;
}

/**
 * The part of an aggregate that came from requests whose prompt exceeded `LONG_CONTEXT_THRESHOLD`
 * (272K input tokens). Prompt sizes do not survive aggregation, so this is how the backend can still
 * bill those requests at OpenAI's long-context tier. Token counts only — nothing about the prompts.
 */
export type UploadLongContextUsage = UploadUsage;

export interface UploadHourBucket extends UploadUsage {
  hourStart: number; // UTC ms, floored to the hour
  model: string;
  agent: string; // which tool produced the usage: "codex" | "pi" | "hermes" | custom
  /** Wire ≥ 3: long-context share of this bucket. */
  long?: UploadLongContextUsage;
  /** Wire < 3 only: USD computed on the device. Backends ≥ 3 price the bucket themselves and ignore it. */
  cost?: number;
}

/** Wire ≥ 3: a session's usage per model, so a session that switched models is priced exactly. */
export interface UploadSessionModel extends UploadUsage {
  model: string;
  long?: UploadLongContextUsage;
}

export interface UploadSession extends UploadUsage {
  sessionId: string;
  agent: string;
  model: string; // most recent model of the session
  projectName: string | null;
  cwdHash: string | null; // sha256 of cwd – path itself never leaves the machine
  startedAt: number;
  lastActivityAt: number;
  /** Wire ≥ 3: per-model breakdown of the totals above. */
  models?: UploadSessionModel[];
  /** Wire < 3 only: USD computed on the device (see `UploadHourBucket.cost`). */
  cost?: number;
  source: string | null;
  cliVersion: string | null;
}

export interface LiveSnapshot {
  sessionId: string | null;
  model: string | null;
  /** Generated (output) tokens per second over the last 60 s. */
  tokensPerSecond: number;
  lastEventAt: number | null;
  todayTotal: number; // machine-local "today" total tokens
  /** Machine-local "today" USD, priced with the table the device last downloaded from the backend. */
  todayCost: number;
}

export interface HeartbeatPayload {
  appVersion: string;
  platform: string; // darwin | win32 | linux | wsl
  hostname: string | null;
  timezone: string;
  live: LiveSnapshot | null;
  /** Hashed machine identity (see `device-identity.ts`); only sent to backends with wireVersion >= 2. */
  machineId?: string;
}

export interface DashboardConfigResponse {
  convexUrl: string;
  dashboardUrl: string;
  appName: string;
  wireVersion: number;
}

export type DeviceAuthStatus = "pending" | "approved" | "expired" | "consumed" | "denied";

/**
 * The price table the backend currently bills with (`pricing.current`). The menubar downloads it for
 * its local display and the dashboard shows where each rate came from. Not secret: list prices.
 */
export interface PricingTableResponse {
  entries: PricingEntry[];
  /** Id of the snapshot the entries come from; null before the first successful refresh (seed table). */
  version: string | null;
  /** When the current snapshot was read from OpenAI's pricing page; null for the seed table. */
  fetchedAt: number | null;
  /** When the backend last looked for a change (successful or not). */
  checkedAt: number | null;
  /** Why the last check failed, when it did; the previous snapshot stays in force. */
  lastError: string | null;
  sourceUrl: string;
}

/** Compact hourly row as returned by dashboard/menubar queries (short keys keep payloads small). */
export interface CompactModelUsage {
  model: string;
  agent?: string; // absent = "codex" (rows written before multi-agent support)
  i: number; // input
  c: number; // cached
  w: number; // cache write
  o: number; // output
  r: number; // reasoning
  t: number; // total
  q: number; // requests
  usd: number; // cost USD (key must not start with "$": reserved by Convex)
}
export interface CompactHourRow extends Omit<CompactModelUsage, "model"> {
  h: number; // hourStart UTC ms
  u: string; // userId
  d: string; // deviceId
  m: CompactModelUsage[];
}

/** Expand compact rows into per-model HourRow-like records (one per model per hour). */
export function expandCompactRows(rows: CompactHourRow[]): Array<{
  hourStart: number; model: string; agent: string; userId: string; deviceId: string; cost: number;
  usage: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number; requests: number };
}> {
  const out: ReturnType<typeof expandCompactRows> = [];
  for (const r of rows) {
    const models = r.m.length ? r.m : [{ model: "unknown", i: r.i, c: r.c, w: r.w, o: r.o, r: r.r, t: r.t, q: r.q, usd: r.usd }];
    for (const m of models) {
      out.push({
        hourStart: r.h, model: m.model, agent: m.agent ?? "codex", userId: r.u, deviceId: r.d, cost: m.usd,
        usage: { input: m.i, cached: m.c, cacheWrite: m.w, output: m.o, reasoning: m.r, total: m.t, requests: m.q },
      });
    }
  }
  return out;
}
