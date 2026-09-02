import { EventEmitter } from "node:events";
import { fromLogRateLimits, machineTimeZone, type LiveRateLimits, type LiveSnapshot } from "@codex-tracker/shared";
import { configDir, loadConfig, loadPricingOverrides, updateConfig, type TrackerConfig } from "./config";
import { SessionStore } from "./store";
import { computeStats, type Stats } from "./stats";
import { Uploader, SignedOutError, errorMessage } from "./uploader";
import { deviceLogin, logoutDevice, type LoginResult } from "./auth";
import { deviceName, hostname, platformKind, systemLocale } from "./platform";
import { fetchLiveRateLimits } from "./usage-api";
import { resolveLanguage, type Language, type LanguageSetting } from "../i18n";
import { checkForUpdate, runUpdate, type UpdateInfo } from "./update";
import type { Snapshot, AuthState, UpdateState, SyncPhase, SyncResult, SyncState } from "./snapshot";
import { APP_CHANNEL, APP_VERSION } from "../version";

export interface EngineOptions {
  /** Push data to the dashboard backend (requires a device token). */
  upload: boolean;
  /** Keep watching files / timers after start(). Default true. */
  watch?: boolean;
  heatmapWeeks?: number;
  systemLocale?: string | null;
  log?: (msg: string) => void;
}

const SHALLOW_MS = 3_000;
const DEEP_MS = 60_000;
const TICK_MS = 2_000;
const REMOTE_MS = 60_000;
const LIVE_LIMITS_DEBOUNCE_MS = 10_000;
const LIVE_LIMITS_MIN_GAP_MS = 20_000;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
/** How long a finished sync keeps reporting "done"/"error" before the banner returns to idle. */
const SYNC_BANNER_MS = 25_000;

/** Composes the file store, statistics, live rate limits and uploader; emits `snapshot` whenever the picture changes. */
export class Engine extends EventEmitter {
  config: TrackerConfig;
  readonly store: SessionStore;
  readonly uploader: Uploader;
  stats: Stats | null = null;
  private pricing = loadPricingOverrides();
  private timers: NodeJS.Timeout[] = [];
  private pending: { code: string | null; url: string | null; abort: AbortController } | null = null;
  private authError: string | null = null;
  private refreshing = false;
  private liveLimits: LiveRateLimits | null = null;
  private liveLimitsError: string | null = null;
  private liveLimitsAt: number | null = null;
  private liveLimitsInFlight = false;
  private liveLimitsTimer: NodeJS.Timeout | null = null;
  private lastLiveLimitsAttempt = 0;
  private update: UpdateInfo | null = null;
  private updateStatus: UpdateState["status"] = "idle";
  private updateLog: string | null = null;
  private syncStatus: SyncState["status"] = "idle";
  private syncPhase: SyncPhase | null = null;
  private syncStartedAt: number | null = null;
  private syncFinishedAt: number | null = null;
  private syncError: string | null = null;
  private syncResult: SyncResult | null = null;
  private syncBannerTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: EngineOptions) {
    super();
    this.config = loadConfig();
    this.store = new SessionStore(() => ({
      extraSessionDirs: this.config.extraSessionDirs,
      sources: this.config.sources,
      trackAllProviders: this.config.trackAllProviders,
    }));
    this.uploader = new Uploader({
      getConfig: () => this.config,
      onSignedOut: (reason) => {
        this.config = updateConfig({ deviceToken: null, deviceId: null, user: null });
        this.authError = reason;
        this.emitSnapshot();
      },
      log: opts.log,
    });
  }

  get heatmapWeeks(): number {
    return this.opts.heatmapWeeks ?? 16;
  }

  get signedIn(): boolean {
    return Boolean(this.config.deviceToken);
  }

  language(): Language {
    return resolveLanguage(this.config.language, this.opts.systemLocale ?? systemLocale());
  }

  reloadConfig() {
    this.config = loadConfig();
    this.pricing = loadPricingOverrides();
  }

  async start() {
    await this.store.refreshDeep();
    this.recompute();
    if (this.opts.watch === false) {
      // one-shot callers (CLI status/agent --once) want the live limits in the first snapshot
      await this.refreshLiveLimits(true);
      return;
    }
    void this.refreshLiveLimits(true);
    void this.checkUpdate(false);
    this.timers.push(setInterval(() => void this.checkUpdate(false), UPDATE_CHECK_MS));
    this.store.startWatching(() => void this.refresh(false));
    this.timers.push(setInterval(() => void this.refresh(false), SHALLOW_MS));
    this.timers.push(setInterval(() => void this.refresh(true), DEEP_MS));
    this.timers.push(setInterval(() => void this.refreshLiveLimits(false), this.config.usageRefreshSec * 1000));
    this.timers.push(
      setInterval(() => {
        // live tokens/sec decays as events age; recompute while a session is active
        if (this.stats?.live) this.recompute();
      }, TICK_MS),
    );
    if (this.opts.upload) {
      this.timers.push(setTimeout(() => void this.uploadNow().catch(() => {}), 2_000));
      this.timers.push(setInterval(() => void this.uploadNow().catch(() => {}), this.config.uploadIntervalSec * 1000));
      this.timers.push(setInterval(() => void this.heartbeatNow().catch(() => {}), this.config.heartbeatIntervalSec * 1000));
      this.timers.push(setTimeout(() => void this.fetchRemoteNow().catch(() => {}), 4_000));
      this.timers.push(setInterval(() => void this.fetchRemoteNow().catch(() => {}), REMOTE_MS));
    }
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.liveLimitsTimer) clearTimeout(this.liveLimitsTimer);
    this.liveLimitsTimer = null;
    if (this.syncBannerTimer) clearTimeout(this.syncBannerTimer);
    this.syncBannerTimer = null;
    this.store.stopWatching();
    this.pending?.abort.abort();
  }

  async refresh(deep: boolean): Promise<boolean> {
    if (this.refreshing) return false;
    this.refreshing = true;
    try {
      const changed = deep ? await this.store.refreshDeep() : await this.store.refreshShallow();
      if (changed) {
        this.recompute();
        this.scheduleLiveLimits();
      }
      return changed;
    } catch (err) {
      this.opts.log?.(`refresh failed: ${errorMessage(err)}`);
      return false;
    } finally {
      this.refreshing = false;
    }
  }

  /** Query chatgpt.com for the account's live limits (debounced; at most one request per 20 s unless forced). */
  async refreshLiveLimits(force: boolean): Promise<void> {
    if (!this.config.liveRateLimits || this.liveLimitsInFlight) return;
    const now = Date.now();
    if (!force && now - this.lastLiveLimitsAttempt < LIVE_LIMITS_MIN_GAP_MS) return;
    this.lastLiveLimitsAttempt = now;
    this.liveLimitsInFlight = true;
    try {
      const r = await fetchLiveRateLimits(APP_VERSION);
      if (r.limits) {
        this.liveLimits = r.limits;
        this.liveLimitsError = null;
        this.liveLimitsAt = r.fetchedAt;
      } else {
        this.liveLimitsError = r.error;
        this.opts.log?.(`live rate limits unavailable: ${r.error}`);
      }
      this.emitSnapshot();
    } finally {
      this.liveLimitsInFlight = false;
    }
  }

  /** New local usage was seen → re-check the live limits shortly (the backend updates a few seconds later). */
  private scheduleLiveLimits() {
    if (!this.config.liveRateLimits || this.opts.watch === false) return;
    if (this.liveLimitsTimer) clearTimeout(this.liveLimitsTimer);
    this.liveLimitsTimer = setTimeout(() => {
      this.liveLimitsTimer = null;
      void this.refreshLiveLimits(false);
    }, LIVE_LIMITS_DEBOUNCE_MS);
  }

  recompute() {
    this.stats = computeStats({
      sessions: this.store.sessions(),
      pricing: this.pricing,
      remoteRows: this.uploader.remoteRows,
      heatmapWeeks: this.heatmapWeeks,
    });
    this.emitSnapshot();
  }

  emitSnapshot() {
    this.emit("snapshot", this.snapshot());
  }

  liveSnapshot(): LiveSnapshot | null {
    const s = this.stats;
    if (!s) return null;
    return {
      sessionId: s.live?.sessionId ?? null,
      model: s.live?.model ?? null,
      tokensPerSecond: s.live?.tokensPerSecond ?? 0,
      lastEventAt: s.live?.lastEventAt ?? s.lastActivityAt,
      todayTotal: s.today.usage.total,
      todayCost: s.today.cost,
    };
  }

  async uploadNow(): Promise<{ buckets: number; sessions: number }> {
    if (!this.signedIn) return { buckets: 0, sessions: 0 };
    if (!this.stats) this.recompute();
    try {
      const r = await this.uploader.pushAll(this.stats!.buckets, this.stats!.sessions, this.stats!.sessionCosts);
      this.emitSnapshot();
      return r;
    } catch (err) {
      if (!(err instanceof SignedOutError)) this.opts.log?.(`upload failed: ${errorMessage(err)}`);
      this.emitSnapshot();
      throw err;
    }
  }

  async heartbeatNow() {
    if (!this.signedIn) return;
    await this.uploader.heartbeat({
      appVersion: APP_VERSION,
      platform: platformKind(),
      hostname: hostname(),
      timezone: machineTimeZone(),
      live: this.liveSnapshot(),
    });
  }

  async fetchRemoteNow() {
    if (!this.signedIn) return;
    await this.uploader.fetchRemote(this.heatmapWeeks);
    this.recompute();
  }

  /**
   * Full sync ("calibrate this device"). Unlike the periodic incremental upload this deliberately
   * throws away every cache on the way:
   *  1. re-read the config so sources enabled since start-up are picked up,
   *  2. drop the parsed-file index and re-discover + re-parse every transcript of every agent
   *     (Codex plus the agents running on the Codex subscription: pi, OpenCode, Cline/Roo/Kilo,
   *     Hermes and any custom `extraSessionDirs`),
   *  3. recompute the aggregates with the current pricing table,
   *  4. re-upload *everything* — not just what changed — so the dashboard's totals for this device
   *     are replaced by the freshly computed ones,
   *  5. pull the other devices' rows and the live rate limits back down.
   *
   * Returns null when a sync is already running. Never throws: failures land in the returned state.
   */
  async syncNow(): Promise<SyncResult | null> {
    if (this.syncStatus === "running") return null;
    if (this.syncBannerTimer) {
      clearTimeout(this.syncBannerTimer);
      this.syncBannerTimer = null;
    }
    const startedAt = Date.now();
    this.syncStatus = "running";
    this.syncPhase = null;
    this.syncStartedAt = startedAt;
    this.syncFinishedAt = null;
    this.syncError = null;
    const phase = (p: SyncPhase) => {
      this.syncPhase = p;
      this.emitSnapshot();
    };
    try {
      phase("scanning");
      this.reloadConfig();
      this.store.reset();
      await this.store.refreshDeep();

      phase("computing");
      this.recompute();

      let uploadedBuckets = 0;
      let uploadedSessions = 0;
      const uploaded = this.opts.upload && this.signedIn;
      if (uploaded) {
        phase("uploading");
        const r = await this.uploader.pushAll(this.stats!.buckets, this.stats!.sessions, this.stats!.sessionCosts, { full: true });
        uploadedBuckets = r.buckets;
        uploadedSessions = r.sessions;
        await this.heartbeatNow().catch(() => {}); // cosmetic; never fail the sync over it
        phase("downloading");
        await this.fetchRemoteNow();
      }

      phase("limits");
      await this.refreshLiveLimits(true);

      const finishedAt = Date.now();
      this.syncResult = {
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        files: this.store.fileCount,
        sessions: this.store.sessions().length,
        roots: this.store.roots.length,
        agents: [...new Set(this.store.roots.map((r) => r.agent))].sort(),
        uploadedBuckets,
        uploadedSessions,
        uploaded,
      };
      this.syncStatus = "done";
      this.syncFinishedAt = finishedAt;
      this.opts.log?.(
        `sync: ${this.syncResult.files} files, ${this.syncResult.sessions} sessions, ` +
          `${uploadedBuckets} buckets / ${uploadedSessions} sessions uploaded in ${this.syncResult.durationMs} ms`,
      );
      return this.syncResult;
    } catch (err) {
      this.syncStatus = "error";
      this.syncFinishedAt = Date.now();
      this.syncError = err instanceof SignedOutError ? "not signed in" : errorMessage(err);
      this.opts.log?.(`sync failed: ${this.syncError}`);
      return null;
    } finally {
      this.syncPhase = null;
      this.emitSnapshot();
      this.scheduleSyncBannerClear();
    }
  }

  /** Return the sync banner to "idle" a little after it finished, keeping `last` for the footer. */
  private scheduleSyncBannerClear() {
    if (this.opts.watch === false) return;
    if (this.syncBannerTimer) clearTimeout(this.syncBannerTimer);
    this.syncBannerTimer = setTimeout(() => {
      this.syncBannerTimer = null;
      if (this.syncStatus === "done" || this.syncStatus === "error") {
        this.syncStatus = "idle";
        this.emitSnapshot();
      }
    }, SYNC_BANNER_MS);
    this.syncBannerTimer.unref?.();
  }

  private syncState(): SyncState {
    return {
      status: this.syncStatus,
      phase: this.syncPhase,
      startedAt: this.syncStartedAt,
      finishedAt: this.syncFinishedAt,
      error: this.syncError,
      last: this.syncResult,
    };
  }

  /**
   * Ask the npm registry for the newest published version (cached for 6 h unless `force`).
   * Best-effort: a failure is recorded on the snapshot, never thrown.
   */
  async checkUpdate(force: boolean): Promise<UpdateInfo | null> {
    if (!this.config.checkUpdates) {
      this.update = null;
      return null;
    }
    if (this.updateStatus === "checking" || this.updateStatus === "installing") return this.update;
    this.updateStatus = "checking";
    this.emitSnapshot();
    this.update = await checkForUpdate({ force });
    this.updateStatus = "idle";
    if (this.update.error) this.opts.log?.(`update check failed: ${this.update.error}`);
    this.emitSnapshot();
    return this.update;
  }

  /**
   * Install the newest version globally with the package manager this copy came from.
   * The new code only takes effect once the app is restarted, so the UI says so rather than
   * pretending to hot-swap itself.
   */
  async installUpdate(): Promise<boolean> {
    if (this.updateStatus === "installing") return false;
    if (!this.update?.available) await this.checkUpdate(true);
    if (!this.update?.available) return false;
    this.updateStatus = "installing";
    this.updateLog = null;
    this.emitSnapshot();
    const r = await runUpdate({ version: this.update.latest ?? undefined });
    this.updateStatus = r.ok ? "installed" : "failed";
    this.updateLog = r.ok ? null : `${r.command}\n${r.output}`.trim();
    if (!r.ok) this.opts.log?.(`update install failed (${r.code}): ${r.output}`);
    this.emitSnapshot();
    return r.ok;
  }

  private updateState(): UpdateState | null {
    if (!this.config.checkUpdates || !this.update) return null;
    return { ...this.update, status: this.updateStatus, log: this.updateLog };
  }

  /** Start the device-code login flow (resolves when approved / denied / expired / cancelled). */
  async login(openBrowser: boolean, onCode?: (code: string, url: string) => void): Promise<LoginResult> {
    if (this.pending) return { status: "cancelled" };
    const abort = new AbortController();
    this.pending = { code: null, url: null, abort };
    this.authError = null;
    this.emitSnapshot();
    try {
      const result = await deviceLogin(this.config, {
        openBrowser,
        signal: abort.signal,
        onCode: (code, url) => {
          this.pending = { code, url, abort };
          onCode?.(code, url);
          this.emitSnapshot();
        },
      });
      if (result.status === "approved") {
        this.reloadConfig();
        this.uploader.resetState();
        this.pending = null;
        this.emitSnapshot();
        if (this.opts.upload) {
          void this.uploadNow().catch(() => {});
          void this.fetchRemoteNow().catch(() => {});
        }
      } else if (result.status !== "cancelled") {
        this.authError = result.status;
      }
      return result;
    } catch (err) {
      this.authError = errorMessage(err);
      throw err;
    } finally {
      this.pending = null;
      this.emitSnapshot();
    }
  }

  cancelLogin() {
    this.pending?.abort.abort();
  }

  logout() {
    logoutDevice();
    this.reloadConfig();
    this.uploader.resetState();
    this.authError = null;
    this.recompute();
  }

  setLanguage(setting: LanguageSetting) {
    this.config = updateConfig({ language: setting });
    this.emitSnapshot();
  }

  setConfig(patch: Partial<TrackerConfig>) {
    this.config = updateConfig(patch);
    this.emitSnapshot();
  }

  authState(): AuthState {
    const status = this.pending ? "pending" : this.signedIn ? "signedIn" : "signedOut";
    return {
      status,
      user: this.config.user,
      pendingCode: this.pending?.code ?? null,
      verifyUrl: this.pending?.url ?? null,
      error: this.authError,
      dashboardUrl: this.config.dashboardUrl,
      deviceName: deviceName(),
    };
  }

  snapshot(): Snapshot {
    const s = this.stats ?? computeStats({ sessions: [], heatmapWeeks: this.heatmapWeeks });
    const sessions = this.store.sessions();
    return {
      version: APP_VERSION,
      channel: APP_CHANNEL,
      generatedAt: Date.now(),
      language: this.language(),
      languageSetting: this.config.language,
      platform: platformKind(),
      auth: this.authState(),
      today: {
        ...s.today,
        remoteUsage: s.remoteToday?.usage ?? null,
        remoteCost: s.remoteToday?.cost ?? null,
      },
      week: s.week,
      month: s.month,
      live: s.live,
      lastActivityAt: s.lastActivityAt,
      rateLimits: this.liveLimits ?? fromLogRateLimits(s.logRateLimits),
      rateLimitsError: this.config.liveRateLimits ? this.liveLimitsError : null,
      rateLimitsUpdatedAt: this.liveLimits ? this.liveLimitsAt : (s.logRateLimits?.observedAt ?? null),
      update: this.updateState(),
      sync: this.syncState(),
      modelsToday: s.modelsToday,
      modelsMonth: s.modelsMonth,
      byAgentToday: s.byAgentToday,
      byAgentMonth: s.byAgentMonth,
      heatmap: s.heatmap,
      heatmapWeeks: this.heatmapWeeks,
      heatmapIncludesRemote: this.uploader.remoteRows.length > 0,
      counts: { sessions: sessions.length, files: this.store.fileCount, byAgent: this.store.countsByAgent() },
      upload: {
        enabled: this.opts.upload && this.signedIn,
        lastUploadAt: this.uploader.lastUploadAt,
        lastError: this.uploader.lastError,
        lastRemoteFetchAt: this.uploader.lastRemoteFetchAt,
      },
      sessionDirs: SessionStore.rootDirs(this.store.roots),
      sessionRoots: this.store.roots.map((r) => ({ dir: r.dir, agent: r.agent, format: r.format, origin: r.origin })),
      configDir: configDir(),
      launchAtLogin: this.config.launchAtLogin,
      trayTitle: this.config.trayTitle,
    };
  }
}
