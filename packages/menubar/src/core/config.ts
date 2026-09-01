import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelPrice } from "@codex-tracker/shared";
import type { LanguageSetting } from "../i18n";

export const DEFAULT_DASHBOARD_URL = "https://codex-tracker.vercel.app";

export interface TrackerConfig {
  dashboardUrl: string;
  convexUrl: string | null;
  deviceToken: string | null;
  deviceId: string | null;
  user: { name: string | null; email: string | null } | null;
  language: LanguageSetting;
  uploadIntervalSec: number;
  heartbeatIntervalSec: number;
  extraSessionDirs: string[];
  launchAtLogin: boolean;
  trayTitle: "tokens" | "cost" | "none";
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
};

/** Keys users may change through `codex-tracker config set`. */
export const EDITABLE_KEYS: Array<keyof TrackerConfig> = [
  "dashboardUrl",
  "language",
  "uploadIntervalSec",
  "heartbeatIntervalSec",
  "extraSessionDirs",
  "launchAtLogin",
  "trayTitle",
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

export function loadConfig(): TrackerConfig {
  const stored = readJson<Partial<TrackerConfig>>(configPath(), {});
  const cfg: TrackerConfig = { ...DEFAULT_CONFIG, ...stored };
  if (!Array.isArray(cfg.extraSessionDirs)) cfg.extraSessionDirs = [];
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
    case "heartbeatIntervalSec": {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} must be a positive number`);
      return Math.round(n);
    }
    case "launchAtLogin":
      return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
    case "extraSessionDirs":
      return raw
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
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
