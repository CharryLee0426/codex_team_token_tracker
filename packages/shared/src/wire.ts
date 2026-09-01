/** Wire types shared between the menubar/agent uploader, the Convex backend and the dashboard. */

export const WIRE_VERSION = 1;
export const DEVICE_AUTH_TTL_MS = 15 * 60 * 1000;
export const DEVICE_TOKEN_PREFIX = "cxt_";
export const MAX_BUCKETS_PER_PUSH = 400;
export const MAX_SESSIONS_PER_PUSH = 100;

export interface UploadHourBucket {
  hourStart: number; // UTC ms, floored to the hour
  model: string;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
  requests: number;
  cost: number; // USD, computed on the device with its pricing table
}

export interface UploadSession {
  sessionId: string;
  model: string;
  projectName: string | null;
  cwdHash: string | null; // sha256 of cwd – path itself never leaves the machine
  startedAt: number;
  lastActivityAt: number;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
  requests: number;
  cost: number;
  source: string | null;
  cliVersion: string | null;
}

export interface LiveSnapshot {
  sessionId: string | null;
  model: string | null;
  tokensPerSecond: number;
  lastEventAt: number | null;
  todayTotal: number; // machine-local "today" total tokens
  todayCost: number;
}

export interface HeartbeatPayload {
  appVersion: string;
  platform: string; // darwin | win32 | linux | wsl
  hostname: string | null;
  timezone: string;
  live: LiveSnapshot | null;
}

export interface DashboardConfigResponse {
  convexUrl: string;
  dashboardUrl: string;
  appName: string;
  wireVersion: number;
}

export type DeviceAuthStatus = "pending" | "approved" | "expired" | "consumed" | "denied";

/** Compact hourly row as returned by dashboard/menubar queries (short keys keep payloads small). */
export interface CompactModelUsage {
  model: string;
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
  hourStart: number; model: string; userId: string; deviceId: string; cost: number;
  usage: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number; requests: number };
}> {
  const out: ReturnType<typeof expandCompactRows> = [];
  for (const r of rows) {
    const models = r.m.length ? r.m : [{ model: "unknown", i: r.i, c: r.c, w: r.w, o: r.o, r: r.r, t: r.t, q: r.q, usd: r.usd }];
    for (const m of models) {
      out.push({
        hourStart: r.h, model: m.model, userId: r.u, deviceId: r.d, cost: m.usd,
        usage: { input: m.i, cached: m.c, cacheWrite: m.w, output: m.o, reasoning: m.r, total: m.t, requests: m.q },
      });
    }
  }
  return out;
}
