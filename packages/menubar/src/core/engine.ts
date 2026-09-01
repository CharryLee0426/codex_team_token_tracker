import { EventEmitter } from "node:events";
import { machineTimeZone, type LiveSnapshot } from "@codex-tracker/shared";
import { loadConfig, loadPricingOverrides, updateConfig, type TrackerConfig } from "./config";
import { SessionStore } from "./store";
import { computeStats, type Stats } from "./stats";
import { Uploader, SignedOutError, errorMessage } from "./uploader";
import { deviceLogin, logoutDevice, type LoginResult } from "./auth";
import { deviceName, hostname, platformKind, systemLocale } from "./platform";
import { resolveLanguage, type Language, type LanguageSetting } from "../i18n";
import type { Snapshot, AuthState } from "./snapshot";
import { APP_VERSION } from "../version";

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

/** Composes the file store, statistics and uploader; emits `snapshot` whenever the picture changes. */
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

  constructor(private readonly opts: EngineOptions) {
    super();
    this.config = loadConfig();
    this.store = new SessionStore(() => this.config.extraSessionDirs);
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
    if (this.opts.watch === false) return;
    this.store.startWatching(() => void this.refresh(false));
    this.timers.push(setInterval(() => void this.refresh(false), SHALLOW_MS));
    this.timers.push(setInterval(() => void this.refresh(true), DEEP_MS));
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
    this.store.stopWatching();
    this.pending?.abort.abort();
  }

  async refresh(deep: boolean): Promise<boolean> {
    if (this.refreshing) return false;
    this.refreshing = true;
    try {
      const changed = deep ? await this.store.refreshDeep() : await this.store.refreshShallow();
      if (changed) this.recompute();
      return changed;
    } catch (err) {
      this.opts.log?.(`refresh failed: ${errorMessage(err)}`);
      return false;
    } finally {
      this.refreshing = false;
    }
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
      const r = await this.uploader.pushAll(this.stats!.buckets, this.store.sessions(), this.stats!.sessionCosts);
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
    return {
      version: APP_VERSION,
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
      rateLimits: s.rateLimits,
      modelsToday: s.modelsToday,
      modelsMonth: s.modelsMonth,
      heatmap: s.heatmap,
      heatmapWeeks: this.heatmapWeeks,
      heatmapIncludesRemote: this.uploader.remoteRows.length > 0,
      counts: { sessions: this.store.sessions().length, files: this.store.fileCount },
      upload: {
        enabled: this.opts.upload && this.signedIn,
        lastUploadAt: this.uploader.lastUploadAt,
        lastError: this.uploader.lastError,
        lastRemoteFetchAt: this.uploader.lastRemoteFetchAt,
      },
      sessionDirs: SessionStore.rootDirs(this.store.roots),
      launchAtLogin: this.config.launchAtLogin,
      trayTitle: this.config.trayTitle,
    };
  }
}
