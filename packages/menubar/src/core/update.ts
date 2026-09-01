import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { configDir } from "./config";
import { APP_VERSION } from "../version";

/** npm package this app is published as. */
export const NPM_PACKAGE = "codex-token-tracker";

const CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const LOG_TAIL_CHARS = 4_000;

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface UpdateInfo {
  /** Version running right now. */
  current: string;
  /** Newest version on the registry, or null when the check never succeeded. */
  latest: string | null;
  available: boolean;
  checkedAt: number | null;
  /** Why the last check failed, if it did (a stale `latest` may still be present). */
  error: string | null;
  packageManager: PackageManager;
  /** The exact command that installs `latest`, for display and for manual fallback. */
  command: string;
}

interface UpdateCache {
  checkedAt: number;
  latest: string;
}

function parseVersion(v: string): { nums: [number, number, number]; pre: string } {
  const s = String(v ?? "").trim().replace(/^v/, "");
  const i = s.indexOf("-");
  const core = i === -1 ? s : s.slice(0, i);
  const pre = i === -1 ? "" : s.slice(i + 1);
  const n = core.split(".").map((x) => Number.parseInt(x, 10) || 0);
  return { nums: [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0], pre };
}

/** semver-ish compare: -1 / 0 / 1. A release outranks any prerelease of the same core version. */
export function compareVersions(a: string, b: string): number {
  const A = parseVersion(a);
  const B = parseVersion(b);
  for (let i = 0; i < 3; i++) if (A.nums[i] !== B.nums[i]) return A.nums[i] < B.nums[i] ? -1 : 1;
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre < B.pre ? -1 : 1;
}

/** A local `pnpm build` run reports 0.0.0-dev; never nag those into "updating" to a release. */
function isDevBuild(version: string): boolean {
  return version.startsWith("0.0.0");
}

function registryBase(): string {
  const r =
    process.env.CODEX_TRACKER_REGISTRY ||
    process.env.npm_config_registry ||
    process.env.NPM_CONFIG_REGISTRY ||
    "https://registry.npmjs.org";
  return r.replace(/\/+$/, "");
}

/** Ask the registry for the `latest` dist-tag (a few hundred bytes, no packument download). */
export async function fetchLatestVersion(signal?: AbortSignal): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(`${registryBase()}/-/package/${NPM_PACKAGE}/dist-tags`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`registry responded ${res.status}`);
    const json = (await res.json()) as Record<string, unknown> | null;
    const latest = json?.latest;
    if (typeof latest !== "string" || !latest) throw new Error("registry returned no `latest` tag");
    return latest;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which package manager installed this copy — inferred from where `dist/` sits on disk
 * (…/pnpm/…, …/.bun/…, …/yarn/…), falling back to the manager that spawned us, then npm.
 */
export function detectPackageManager(installDir = path.resolve(__dirname, "..")): PackageManager {
  const p = installDir.replace(/\\/g, "/").toLowerCase();
  if (/\/\.?bun\//.test(p)) return "bun";
  if (/\/\.?pnpm[/-]/.test(p)) return "pnpm";
  if (/\/\.?yarn\//.test(p)) return "yarn";
  const ua = (process.env.npm_config_user_agent ?? "").toLowerCase();
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  return "npm";
}

export function updateArgs(pm: PackageManager, spec = `${NPM_PACKAGE}@latest`): string[] {
  switch (pm) {
    case "pnpm":
      return ["add", "-g", spec];
    case "yarn":
      return ["global", "add", spec];
    case "bun":
      return ["add", "-g", spec];
    default:
      return ["install", "-g", spec];
  }
}

export function updateCommand(pm: PackageManager, spec?: string): string {
  return `${pm} ${updateArgs(pm, spec).join(" ")}`;
}

function cachePath(): string {
  return path.join(configDir(), "update.json");
}

function readCache(): UpdateCache | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as Partial<UpdateCache>;
    if (typeof raw?.latest === "string" && typeof raw.checkedAt === "number") {
      return { latest: raw.latest, checkedAt: raw.checkedAt };
    }
  } catch {
    /* no cache yet */
  }
  return null;
}

function writeCache(c: UpdateCache) {
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(c, null, 2));
  } catch {
    /* cache is best-effort */
  }
}

function info(current: string, latest: string | null, checkedAt: number | null, error: string | null): UpdateInfo {
  const pm = detectPackageManager();
  return {
    current,
    latest,
    available: Boolean(latest) && !isDevBuild(current) && compareVersions(latest!, current) > 0,
    checkedAt,
    error,
    packageManager: pm,
    command: updateCommand(pm),
  };
}

/**
 * Look up the newest published version. Cached for 6 h in `~/.codex-tracker/update.json` so the
 * menu bar app and every CLI invocation share one registry round-trip; `force` skips the cache.
 * Never throws — a failed check surfaces as `error` with the last known `latest`.
 */
export async function checkForUpdate(opts: { force?: boolean; current?: string; signal?: AbortSignal } = {}): Promise<UpdateInfo> {
  const current = opts.current ?? APP_VERSION;
  const cached = readCache();
  if (!opts.force && cached && Date.now() - cached.checkedAt < CHECK_TTL_MS) {
    return info(current, cached.latest, cached.checkedAt, null);
  }
  try {
    const latest = await fetchLatestVersion(opts.signal);
    const checkedAt = Date.now();
    writeCache({ latest, checkedAt });
    return info(current, latest, checkedAt, null);
  } catch (err) {
    return info(current, cached?.latest ?? null, cached?.checkedAt ?? null, (err as Error).message);
  }
}

export interface InstallResult {
  ok: boolean;
  code: number | null;
  command: string;
  /** Tail of the installer's combined stdout/stderr — what to show when it failed. */
  output: string;
}

/**
 * Run the global install. `onOutput` receives the installer's output as it arrives (the CLI streams
 * it straight through; the menu bar app keeps the tail to show on failure).
 *
 * Global installs can fail for reasons we must not paper over — a root-owned npm prefix, a proxy,
 * a read-only volume — so the caller always gets the command back to run by hand.
 */
export function runUpdate(opts: { version?: string; onOutput?: (chunk: string) => void } = {}): Promise<InstallResult> {
  const pm = detectPackageManager();
  const spec = opts.version ? `${NPM_PACKAGE}@${opts.version}` : `${NPM_PACKAGE}@latest`;
  const args = updateArgs(pm, spec);
  const command = `${pm} ${args.join(" ")}`;
  return new Promise((resolve) => {
    let output = "";
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      opts.onOutput?.(text);
      output = (output + text).slice(-LOG_TAIL_CHARS);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(pm, args, {
        // Electron's bundled Node has no shell PATH resolution for `npm.cmd` on Windows.
        shell: process.platform === "win32",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as NodeJS.ProcessEnv,
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, code: null, command, output: (err as Error).message });
      return;
    }
    const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, command, output: output + err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, command, output });
    });
  });
}
