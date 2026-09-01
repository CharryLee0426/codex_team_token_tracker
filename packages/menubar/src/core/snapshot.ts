import type { TokenUsage, HeatmapGrid, LiveRateLimits } from "@codex-tracker/shared";
import type { Language, LanguageSetting } from "../i18n";
import type { PlatformKind } from "./platform";

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
  tokensPerSecond: number; // 60 s window
  tokensPerSecond10s: number; // 10 s window
  contextUsed: number; // last request's context size (input + output)
  contextWindow: number | null;
  sessionUsage: TokenUsage;
  sessionCost: number;
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
  quit(): Promise<void>;
}
