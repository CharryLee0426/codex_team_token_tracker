import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import {
  expandCompactRows,
  hourStartOf,
  isCanonicalTokenUsage,
  sha256Hex,
  MAX_BUCKETS_PER_PUSH,
  MAX_SESSIONS_PER_PUSH,
  type DashboardConfigResponse,
  type HourBucket,
  type HourRow,
  type LiveSnapshot,
  type ParsedSession,
  type UploadHourBucket,
  type UploadSession,
} from "@codex-tracker/shared";
import { backendSupports, loadState, saveState, updateConfig, type TrackerConfig, type UploadState } from "./config";
import { machineId } from "./platform";

/** Wire version from which the backend accepts `machineId` (one device per machine). */
export const WIRE_MACHINE_ID = 2;
/** Bump when the backend's session upsert identity changes, forcing one safe replay of summaries. */
export const SESSION_UPLOAD_IDENTITY_EPOCH = 2;

export class SignedOutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignedOutError";
  }
}

export async function fetchDashboardConfig(dashboardUrl: string): Promise<DashboardConfigResponse> {
  const res = await fetch(`${dashboardUrl.replace(/\/+$/, "")}/api/config`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Dashboard config request failed (${res.status}) for ${dashboardUrl}`);
  const json = (await res.json()) as Partial<DashboardConfigResponse>;
  if (!json || typeof json.convexUrl !== "string" || !/^https?:\/\//.test(json.convexUrl)) {
    throw new Error(`Dashboard at ${dashboardUrl} did not return a Convex URL`);
  }
  return {
    convexUrl: json.convexUrl,
    dashboardUrl: typeof json.dashboardUrl === "string" ? json.dashboardUrl : dashboardUrl,
    appName: typeof json.appName === "string" ? json.appName : "Codex Tracker",
    wireVersion: typeof json.wireVersion === "number" ? json.wireVersion : 1,
  };
}

/**
 * Resolve (and cache in config) the Convex deployment URL for the configured dashboard, together
 * with the wire version its backend speaks (so newer fields are only sent where they are understood).
 */
export async function resolveConvexUrl(cfg: TrackerConfig, force = false): Promise<string> {
  if (cfg.convexUrl && cfg.wireVersion !== null && !force) return cfg.convexUrl;
  const remote = await fetchDashboardConfig(cfg.dashboardUrl);
  updateConfig({ convexUrl: remote.convexUrl, wireVersion: remote.wireVersion });
  cfg.convexUrl = remote.convexUrl;
  cfg.wireVersion = remote.wireVersion;
  return remote.convexUrl;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError) {
    const d = err.data as { message?: string; code?: string } | string;
    if (typeof d === "string") return d;
    return d?.message ?? d?.code ?? "Convex error";
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function isBadToken(err: unknown): boolean {
  if (!(err instanceof ConvexError)) return false;
  const d = err.data as { code?: string } | undefined;
  return d?.code === "BAD_TOKEN";
}

function isNetworkError(err: unknown): boolean {
  return !(err instanceof ConvexError) && err instanceof Error && /fetch|network|ECONN|ENOTFOUND|timeout/i.test(err.message);
}

function bucketHash(b: HourBucket): string {
  const u = b.usage;
  return `${u.input}|${u.cached}|${u.cacheWrite}|${u.output}|${u.reasoning}|${u.total}|${u.requests}|${b.cost.toFixed(6)}`;
}

function uploadableBucket(bucket: HourBucket): boolean {
  return Number.isSafeInteger(bucket.hourStart)
    && bucket.hourStart >= 0
    && Number.isFinite(bucket.cost)
    && bucket.cost >= 0
    && isCanonicalTokenUsage(bucket.usage);
}

function uploadableSession(session: ParsedSession, cost: number): boolean {
  return Number.isFinite(cost)
    && cost >= 0
    && Number.isFinite(session.startedAt)
    && session.startedAt >= 0
    && Number.isFinite(session.lastActivityAt)
    && session.lastActivityAt >= 0
    && isCanonicalTokenUsage(session.cumulative);
}

function uploadableLive(live: LiveSnapshot): boolean {
  return Number.isFinite(live.tokensPerSecond)
    && live.tokensPerSecond >= 0
    && (live.lastEventAt === null || (Number.isFinite(live.lastEventAt) && live.lastEventAt >= 0))
    && Number.isSafeInteger(live.todayTotal)
    && live.todayTotal >= 0
    && Number.isFinite(live.todayCost)
    && live.todayCost >= 0;
}

function uploadSession(s: ParsedSession, cost: number): UploadSession {
  return {
    sessionId: s.sessionId,
    agent: s.agent,
    model: s.model,
    projectName: s.projectName,
    cwdHash: s.cwd ? sha256Hex(s.cwd) : null,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    input: s.cumulative.input,
    cached: s.cumulative.cached,
    cacheWrite: s.cumulative.cacheWrite,
    output: s.cumulative.output,
    reasoning: s.cumulative.reasoning,
    total: s.cumulative.total,
    requests: s.cumulative.requests,
    cost,
    source: s.source ?? s.originator ?? null,
    cliVersion: s.cliVersion,
  };
}

/** Hash exactly the normalized session payload; any outbound correction must invalidate local state. */
export function sessionUploadHash(s: ParsedSession, cost: number): string {
  return sha256Hex(JSON.stringify(uploadSession(s, cost)));
}

function bucketStateKey(b: { hourStart: number; model: string; agent: string }): string {
  return `${b.hourStart}|${b.model}|${b.agent}`;
}

export function sessionStateKey(s: Pick<ParsedSession, "agent" | "sessionId">): string {
  return `${SESSION_UPLOAD_IDENTITY_EPOCH}|${s.agent}|${s.sessionId}`;
}

export interface UploaderOptions {
  getConfig: () => TrackerConfig;
  /**
   * The backend rejected `badToken`. Another process on this machine (tray app vs. headless agent —
   * they share the config file) may have logged in again since; the callback returns the token that is
   * on disk *now* so the uploader can adopt it, or null when this process really is signed out.
   */
  onSignedOut: (reason: string, badToken: string) => string | null;
  log?: (msg: string) => void;
}

/** Pushes local aggregates to Convex, remembers what was already pushed, and pulls other devices' data. */
export class Uploader {
  private client: ConvexHttpClient | null = null;
  private clientUrl: string | null = null;
  private state: UploadState;
  lastError: string | null = null;
  lastUploadAt: number | null;
  lastRemoteFetchAt: number | null = null;
  remoteRows: HourRow[] = [];
  private inFlight = false;

  constructor(private readonly opts: UploaderOptions) {
    this.state = loadState();
    this.lastUploadAt = this.state.lastUploadAt;
  }

  resetState() {
    this.state = { pushedBuckets: {}, pushedSessions: {}, lastUploadAt: null };
    saveState(this.state);
    this.lastUploadAt = null;
    this.remoteRows = [];
    this.lastRemoteFetchAt = null;
    this.client = null;
  }

  private token(): string {
    const t = this.opts.getConfig().deviceToken;
    if (!t) throw new SignedOutError("not signed in");
    return t;
  }

  private async getClient(force = false): Promise<ConvexHttpClient> {
    const cfg = this.opts.getConfig();
    const url = await resolveConvexUrl(cfg, force);
    if (!this.client || this.clientUrl !== url) {
      this.client = new ConvexHttpClient(url);
      this.clientUrl = url;
    }
    return this.client;
  }

  /** Run a Convex call with token/network error handling and a one-time URL refresh retry. */
  private async call<T>(fn: (client: ConvexHttpClient, token: string) => Promise<T>): Promise<T> {
    const token = this.token();
    try {
      const r = await fn(await this.getClient(), token);
      this.lastError = null;
      return r;
    } catch (err) {
      if (isBadToken(err)) {
        // A fresh login by the other process on this machine? Then its token is in the shared config.
        const replacement = this.opts.onSignedOut(errorMessage(err), token);
        if (replacement && replacement !== token) {
          this.opts.log?.("device token was replaced by another login on this machine; retrying with it");
          try {
            const r = await fn(await this.getClient(), replacement);
            this.lastError = null;
            return r;
          } catch (err2) {
            if (!isBadToken(err2)) {
              this.lastError = errorMessage(err2);
              throw err2;
            }
            this.opts.onSignedOut(errorMessage(err2), replacement);
          }
        }
        throw new SignedOutError(errorMessage(err));
      }
      if (isNetworkError(err)) {
        try {
          const r = await fn(await this.getClient(true), token);
          this.lastError = null;
          return r;
        } catch (err2) {
          this.lastError = errorMessage(err2);
          throw err2;
        }
      }
      this.lastError = errorMessage(err);
      throw err;
    }
  }

  /** Wait for an in-flight incremental push to finish so a full sync isn't skipped by the guard. */
  private async awaitIdle(timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  }

  /**
   * Upload changed hour buckets and session summaries. Returns counts of pushed items.
   * With `full`, the record of what was already pushed is dropped first so *everything* is re-sent.
   */
  async pushAll(
    buckets: HourBucket[],
    sessions: ParsedSession[],
    sessionCosts: Map<string, number>,
    opts: { full?: boolean } = {},
  ): Promise<{ buckets: number; sessions: number }> {
    if (opts.full) await this.awaitIdle();
    if (this.inFlight) return { buckets: 0, sessions: 0 };
    this.inFlight = true;
    try {
      if (opts.full) {
        this.state.pushedBuckets = {};
        this.state.pushedSessions = {};
      }
      const changed: UploadHourBucket[] = [];
      const hashes = new Map<string, string>();
      for (const b of buckets.sort((a, b) => a.hourStart - b.hourStart)) {
        if (!uploadableBucket(b)) continue;
        const key = bucketStateKey(b);
        const h = bucketHash(b);
        if (this.state.pushedBuckets[key] === h) continue;
        hashes.set(key, h);
        changed.push({
          hourStart: b.hourStart,
          model: b.model,
          agent: b.agent,
          input: b.usage.input,
          cached: b.usage.cached,
          cacheWrite: b.usage.cacheWrite,
          output: b.usage.output,
          reasoning: b.usage.reasoning,
          total: b.usage.total,
          requests: b.usage.requests,
          cost: b.cost,
        });
      }
      let pushedBuckets = 0;
      for (let i = 0; i < changed.length; i += MAX_BUCKETS_PER_PUSH) {
        const chunk = changed.slice(i, i + MAX_BUCKETS_PER_PUSH);
        await this.call((c, token) => c.mutation(api.ingest.pushHourly, { token, buckets: chunk }));
        for (const b of chunk) {
          const key = bucketStateKey(b);
          this.state.pushedBuckets[key] = hashes.get(key)!;
        }
        pushedBuckets += chunk.length;
        this.state.lastUploadAt = Date.now();
        saveState(this.state);
      }

      const changedSessions: UploadSession[] = [];
      const sHashes = new Map<string, string>();
      for (const s of sessions) {
        if (!s.events.length) continue;
        const costKey = `${s.agent}:${s.sessionId}`;
        const sKey = sessionStateKey(s);
        const cost = sessionCosts.get(costKey) ?? 0;
        if (!uploadableSession(s, cost)) continue;
        const h = sessionUploadHash(s, cost);
        if (this.state.pushedSessions[sKey] === h) continue;
        sHashes.set(sKey, h);
        changedSessions.push(uploadSession(s, cost));
      }
      let pushedSessions = 0;
      for (let i = 0; i < changedSessions.length; i += MAX_SESSIONS_PER_PUSH) {
        const chunk = changedSessions.slice(i, i + MAX_SESSIONS_PER_PUSH);
        await this.call((c, token) => c.mutation(api.ingest.pushSessions, { token, sessions: chunk }));
        for (const s of chunk) this.state.pushedSessions[sessionStateKey(s)] = sHashes.get(sessionStateKey(s))!;
        pushedSessions += chunk.length;
        this.state.lastUploadAt = Date.now();
        saveState(this.state);
      }
      if (pushedBuckets || pushedSessions) this.lastUploadAt = this.state.lastUploadAt;
      else if (!this.lastUploadAt) {
        // nothing to push but confirm connectivity once
        this.lastUploadAt = this.state.lastUploadAt;
      }
      this.opts.log?.(`pushed ${pushedBuckets} buckets, ${pushedSessions} sessions`);
      return { buckets: pushedBuckets, sessions: pushedSessions };
    } finally {
      this.inFlight = false;
    }
  }

  async heartbeat(input: { appVersion: string; platform: string; hostname: string | null; timezone: string; live: LiveSnapshot | null }) {
    // The machine id lets the backend fold a second login from this computer into the same device.
    const extra = backendSupports(this.opts.getConfig(), WIRE_MACHINE_ID) ? { machineId: machineId() } : {};
    const live = input.live && uploadableLive(input.live) ? input.live : null;
    await this.call((c, token) => c.mutation(api.ingest.heartbeat, { token, ...input, live, ...extra }));
  }

  /** Other devices' hourly rows for the last `weeks` weeks (merged into the heatmap and "all devices today"). */
  async fetchRemote(weeks: number): Promise<HourRow[]> {
    const now = Date.now();
    const from = hourStartOf(now - weeks * 7 * 86_400_000);
    const to = hourStartOf(now) + 3_600_000;
    const rows = await this.call((c, token) => c.query(api.ingest.remoteHourly, { token, from, to, includeSelf: false }));
    this.remoteRows = expandCompactRows(rows);
    this.lastRemoteFetchAt = Date.now();
    return this.remoteRows;
  }

  async whoami() {
    return this.call((c, token) => c.query(api.ingest.whoami, { token }));
  }
}
