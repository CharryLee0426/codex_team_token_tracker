import type { TokenUsage, HeatmapGrid, LiveRateLimits } from "@codex-tracker/shared";
import type { Language, LanguageSetting } from "../i18n";
import type { AppChannel } from "../version";
import type { PlatformKind } from "./platform";
import type { UpdateInfo } from "./update";

export interface ModelStat {
  model: string;
  usage: TokenUsage;
  cost: number;
  share: number; // 0..1 of total tokens in the period
  estimated: boolean; // pricing inferred (model not in table)
  priceKey: string | null;
  /** Agents that used this model in the period (e.g. ["codex", "pi"]). */
  agents: string[];
}

/** Usage attributed to one agent (codex, pi, opencode, …) in a period. */
export interface AgentStat {
  agent: string;
  usage: TokenUsage;
  cost: number;
  share: number; // 0..1 of total tokens in the period
  sessions: number;
}

export interface LiveState {
  sessionId: string;
  agent: string;
  projectName: string | null;
  model: string;
  startedAt: number;
  lastEventAt: number;
  /** Generated (output) tokens per second over the last 60 s. */
  tokensPerSecond: number;
  /** Generated (output) tokens per second over the last 10 s — the burst rate. */
  tokensPerSecond10s: number;
  contextUsed: number; // last request's context size (input + output)
  contextWindow: number | null;
  sessionUsage: TokenUsage;
  sessionCost: number;
}

/** Self-update state: what the registry says, plus how the last in-app install attempt went. */
export interface UpdateState extends UpdateInfo {
  status: "idle" | "checking" | "installing" | "installed" | "failed";
  /** Tail of the installer output — only kept when `status` is "failed". */
  log: string | null;
}

/** Stages of a full sync, in the order they run. */
export type SyncPhase = "scanning" | "computing" | "uploading" | "downloading" | "limits";

/** What one completed full sync found and sent. */
export interface SyncResult {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** Transcript files re-read across every discovered source. */
  files: number;
  sessions: number;
  /** Session roots discovered across the enabled built-in sources and custom dirs. */
  roots: number;
  /** Agent names found on disk, e.g. ["codex", "opencode", "pi"]. */
  agents: string[];
  /** Hour buckets re-uploaded (0 when signed out). */
  uploadedBuckets: number;
  uploadedSessions: number;
  /** False when the device is signed out — the rescan still ran, nothing left the machine. */
  uploaded: boolean;
}

export interface SyncState {
  status: "idle" | "running" | "done" | "error";
  phase: SyncPhase | null;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  /** The most recent successful sync, kept after the banner clears. */
  last: SyncResult | null;
}

export type AuthStatus = "signedOut" | "pending" | "signedIn";

export interface AuthState {
  status: AuthStatus;
  user: { name: string | null; email: string | null } | null;
  pendingCode: string | null;
  verifyUrl: string | null;
  error: string | null;
  dashboardUrl: string;
  deviceName: string;
}

export interface PeriodStat {
  usage: TokenUsage;
  cost: number;
  cacheHitRate: number;
}

export interface SessionRootInfo {
  dir: string;
  agent: string;
  format: string;
  origin: string;
}

export interface Snapshot {
  version: string;
  /** "dev" for a local build (local dashboard, separate config dir), "prod" for a published one. */
  channel: AppChannel;
  generatedAt: number;
  language: Language;
  languageSetting: LanguageSetting;
  platform: PlatformKind;
  auth: AuthState;
  today: PeriodStat & { remoteUsage: TokenUsage | null; remoteCost: number | null };
  week: PeriodStat;
  month: PeriodStat;
  live: LiveState | null;
  lastActivityAt: number | null;
  /** Live account limits from chatgpt.com when available, else the latest values seen in Codex logs (`source: "log"`). */
  rateLimits: LiveRateLimits | null;
  rateLimitsError: string | null;
  rateLimitsUpdatedAt: number | null;
  /** Null when update checks are disabled (`config set checkUpdates false`). */
  update: UpdateState | null;
  /** Full-sync progress and the result of the last one. */
  sync: SyncState;
  modelsToday: ModelStat[];
  modelsMonth: ModelStat[];
  byAgentToday: AgentStat[];
  byAgentMonth: AgentStat[];
  heatmap: HeatmapGrid;
  heatmapWeeks: number;
  heatmapIncludesRemote: boolean;
  counts: { sessions: number; files: number; byAgent: Record<string, { sessions: number; files: number }> };
  upload: {
    enabled: boolean;
    lastUploadAt: number | null;
    lastError: string | null;
    lastRemoteFetchAt: number | null;
  };
  sessionDirs: string[];
  sessionRoots: SessionRootInfo[];
  /** Where config, device token and upload state live — differs between dev and prod builds. */
  configDir: string;
  launchAtLogin: boolean;
  trayTitle: "tokens" | "cost" | "none";
}

/** API exposed to the popover renderer through the preload bridge. */
export interface TrackerBridge {
  /** Null only during the first milliseconds before the engine has started; `onSnapshot` follows. */
  getSnapshot(): Promise<Snapshot | null>;
  onSnapshot(cb: (s: Snapshot) => void): () => void;
  setLanguage(lang: LanguageSetting): Promise<void>;
  openDashboard(): Promise<void>;
  openExternal(url: string): Promise<void>;
  login(): Promise<void>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  /** Rescan every agent source from scratch and re-upload this device's whole history. */
  syncNow(): Promise<void>;
  /** Force a registry check now. */
  checkUpdate(): Promise<void>;
  /** Run the global install; resolves once the package manager has exited. */
  installUpdate(): Promise<void>;
  quit(): Promise<void>;
}
