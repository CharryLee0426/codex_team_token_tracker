import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelPrice } from "@codex-tracker/shared";
import type { LanguageSetting } from "../i18n";

export const DEFAULT_DASHBOARD_URL = "https://codex.chenli.dev";

/** How a session directory's files are parsed (see src/core/sources). */
export type SourceFormat = "codex" | "pi" | "generic" | "opencode" | "cline";
export const SOURCE_FORMATS: SourceFormat[] = ["codex", "pi", "generic", "opencode", "cline"];

/** A user-configured session directory: `{ "path": "~/.myagent/logs", "agent": "myagent", "format": "generic" }`. */
export interface ExtraSessionDir {
  path: string;
  agent: string;
  format?: SourceFormat;
}

/** Built-in sources that are auto-discovered when enabled. */
export interface SourcesConfig {
  codex: boolean;
  pi: boolean;
  hermes: boolean;
  opencode: boolean;
  cline: boolean;
  roo: boolean;
  kilo: boolean;
}

export const DEFAULT_SOURCES: SourcesConfig = { codex: true, pi: true, hermes: true, opencode: true, cline: true, roo: true, kilo: true };
export const SOURCE_IDS = Object.keys(DEFAULT_SOURCES) as Array<keyof SourcesConfig>;

export interface TrackerConfig {
  dashboardUrl: string;
  convexUrl: string | null;
  deviceToken: string | null;
  deviceId: string | null;
  user: { name: string | null; email: string | null } | null;
  language: LanguageSetting;
  uploadIntervalSec: number;
  heartbeatIntervalSec: number;
  extraSessionDirs: Array<string | ExtraSessionDir>;
  launchAtLogin: boolean;
  trayTitle: "tokens" | "cost" | "none";
  /** Which agents' logs to read. */
  sources: SourcesConfig;
  /** Count every provider found in other agents' logs (API keys etc.), not only Codex-subscription providers. */
  trackAllProviders: boolean;
  /** Query chatgpt.com for live rate limits using the local Codex login. */
  liveRateLimits: boolean;
  /** Seconds between live rate-limit refreshes. */
  usageRefreshSec: number;
  /** Ask the npm registry whether a newer version has been published. */
  checkUpdates: boolean;
}

export const DEFAULT_CONFIG: TrackerConfig = {
  dashboardUrl: DEFAULT_DASHBOARD_URL,
  convexUrl: null,
  deviceToken: null,
  deviceId: null,
  user: null,
  language: "auto",
  uploadIntervalSec: 60,
  heartbeatIntervalSec: 15,
  extraSessionDirs: [],
  launchAtLogin: false,
  trayTitle: "tokens",
  sources: { ...DEFAULT_SOURCES },
  trackAllProviders: false,
  liveRateLimits: true,
  usageRefreshSec: 60,
  checkUpdates: true,
};

/** Keys users may change through `codex-tracker config set` (plus dotted `sources.<name>`). */
export const EDITABLE_KEYS: Array<keyof TrackerConfig> = [
  "dashboardUrl",
  "language",
  "uploadIntervalSec",
  "heartbeatIntervalSec",
  "extraSessionDirs",
  "launchAtLogin",
  "trayTitle",
  "sources",
  "trackAllProviders",
  "liveRateLimits",
  "usageRefreshSec",
  "checkUpdates",
];

export interface UploadState {
  pushedBuckets: Record<string, string>;
  pushedSessions: Record<string, string>;
  lastUploadAt: number | null;
}

export function configDir(): string {
  return process.env.CODEX_TRACKER_HOME || path.join(os.homedir(), ".codex-tracker");
}

function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function parseBool(raw: string): boolean {
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,31}$/;

/** Normalize a configured extra directory (string = Codex rollout dir) into its full form; null when invalid. */
export function normalizeExtraDir(entry: unknown): ExtraSessionDir | null {
  if (typeof entry === "string") {
    return entry.trim() ? { path: entry.trim(), agent: "codex", format: "codex" } : null;
  }
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path.trim()) return null;
  const agent = typeof o.agent === "string" && o.agent.trim() ? o.agent.trim().toLowerCase() : "codex";
  if (!AGENT_NAME_RE.test(agent)) return null;
  let format = SOURCE_FORMATS.includes(o.format as SourceFormat) ? (o.format as SourceFormat) : undefined;
  if (!format) format = SOURCE_FORMATS.includes(agent as SourceFormat) ? (agent as SourceFormat) : ["roo", "kilo"].includes(agent) ? "cline" : "generic";
  return { path: o.path.trim(), agent, format };
}

export function normalizeSources(value: unknown): SourcesConfig {
  const out = { ...DEFAULT_SOURCES };
  if (value && typeof value === "object") {
    for (const k of SOURCE_IDS) {
      const v = (value as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

export function loadConfig(): TrackerConfig {
  const stored = readJson<Partial<TrackerConfig>>(configPath(), {});
  const cfg: TrackerConfig = { ...DEFAULT_CONFIG, ...stored };
  cfg.extraSessionDirs = Array.isArray(cfg.extraSessionDirs)
    ? (cfg.extraSessionDirs.map(normalizeExtraDir).filter(Boolean) as ExtraSessionDir[])
    : [];
  cfg.sources = normalizeSources(stored.sources);
  cfg.trackAllProviders = stored.trackAllProviders === true;
  cfg.liveRateLimits = stored.liveRateLimits !== false;
  cfg.checkUpdates = stored.checkUpdates !== false;
  if (!(cfg.usageRefreshSec >= 15)) cfg.usageRefreshSec = DEFAULT_CONFIG.usageRefreshSec;
  if (!["auto", "en", "zh"].includes(cfg.language)) cfg.language = "auto";
  if (!(cfg.uploadIntervalSec >= 10)) cfg.uploadIntervalSec = DEFAULT_CONFIG.uploadIntervalSec;
  if (!(cfg.heartbeatIntervalSec >= 5)) cfg.heartbeatIntervalSec = DEFAULT_CONFIG.heartbeatIntervalSec;
  if (!["tokens", "cost", "none"].includes(cfg.trayTitle)) cfg.trayTitle = "tokens";
  cfg.dashboardUrl = (cfg.dashboardUrl || DEFAULT_DASHBOARD_URL).replace(/\/+$/, "");
  return cfg;
}

export function saveConfig(cfg: TrackerConfig) {
  writeJsonAtomic(configPath(), cfg);
}

export function updateConfig(patch: Partial<TrackerConfig>): TrackerConfig {
  const next = { ...loadConfig(), ...patch };
  saveConfig(next);
  return next;
}

/** Coerce a CLI string value into the right type for a config key. */
export function coerceConfigValue(key: keyof TrackerConfig, raw: string): TrackerConfig[keyof TrackerConfig] {
  switch (key) {
    case "uploadIntervalSec":
    case "heartbeatIntervalSec":
    case "usageRefreshSec": {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} must be a positive number`);
      if (key === "usageRefreshSec" && n < 15) throw new Error("usageRefreshSec must be at least 15");
      return Math.round(n);
    }
    case "launchAtLogin":
    case "trackAllProviders":
    case "liveRateLimits":
    case "checkUpdates":
      return parseBool(raw);
    case "extraSessionDirs": {
      const trimmed = raw.trim();
      if (trimmed.startsWith("[")) {
        let arr: unknown;
        try {
          arr = JSON.parse(trimmed);
        } catch {
          throw new Error("extraSessionDirs must be a JSON array or a comma-separated list of paths");
        }
        if (!Array.isArray(arr)) throw new Error("extraSessionDirs must be a JSON array");
        const out = arr.map(normalizeExtraDir);
        if (out.some((e) => !e)) throw new Error(`each entry needs a "path" (and optional "agent", "format": ${SOURCE_FORMATS.join(" | ")})`);
        return out as ExtraSessionDir[];
      }
      return trimmed
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    case "sources": {
      let obj: unknown;
      try {
        obj = JSON.parse(raw);
      } catch {
        throw new Error('sources must be JSON, e.g. {"pi":true,"opencode":false} (or use `config set sources.pi false`)');
      }
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("sources must be a JSON object");
      return normalizeSources(obj);
    }
    case "language":
      if (!["auto", "en", "zh"].includes(raw)) throw new Error("language must be en, zh or auto");
      return raw as LanguageSetting;
    case "trayTitle":
      if (!["tokens", "cost", "none"].includes(raw)) throw new Error("trayTitle must be tokens, cost or none");
      return raw as TrackerConfig["trayTitle"];
    case "dashboardUrl":
      if (!/^https?:\/\//.test(raw)) throw new Error("dashboardUrl must start with http:// or https://");
      return raw.replace(/\/+$/, "");
    default:
      return raw;
  }
}

export function statePath(): string {
  return path.join(configDir(), "state.json");
}

export function loadState(): UploadState {
  const s = readJson<Partial<UploadState>>(statePath(), {});
  return {
    pushedBuckets: s.pushedBuckets && typeof s.pushedBuckets === "object" ? s.pushedBuckets : {},
    pushedSessions: s.pushedSessions && typeof s.pushedSessions === "object" ? s.pushedSessions : {},
    lastUploadAt: typeof s.lastUploadAt === "number" ? s.lastUploadAt : null,
  };
}

export function saveState(state: UploadState) {
  writeJsonAtomic(statePath(), state);
}

export function clearState() {
  saveState({ pushedBuckets: {}, pushedSessions: {}, lastUploadAt: null });
}

export function pricingPath(): string {
  return path.join(configDir(), "pricing.json");
}

/**
 * Optional per-model price overrides (USD per 1M tokens), e.g.
 * { "gpt-5.6-sol": { "input": 2, "cachedInput": 0.2, "output": 16 } }
 */
export function loadPricingOverrides(): Record<string, ModelPrice> | undefined {
  const raw = readJson<Record<string, unknown>>(pricingPath(), {});
  const out: Record<string, ModelPrice> = {};
  for (const [model, p] of Object.entries(raw)) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (typeof o.input !== "number" || typeof o.output !== "number") continue;
    out[model.toLowerCase()] = {
      input: o.input,
      cachedInput: typeof o.cachedInput === "number" ? o.cachedInput : o.input,
      output: o.output,
      cacheWrite: typeof o.cacheWrite === "number" ? o.cacheWrite : undefined,
    };
  }
  return Object.keys(out).length ? out : undefined;
}
