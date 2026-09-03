import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { platformKind } from "../platform";
import { normalizeExtraDir, type ExtraSessionDir, type SourceFormat, type SourcesConfig } from "../config";
import type { SessionRoot, SourceContext, SourceDefinition, UserHome } from "./types";
import { codexSource } from "./codex";
import { piSource } from "./pi";
import { ompSource } from "./omp";
import { genericSource } from "./generic";
import { hermesSource } from "./hermes";
import { opencodeSource } from "./opencode";
import { clineSource, rooSource, kiloSource } from "./cline";
import { listDirs } from "./util";

export type { SessionRoot, SourceContext, SourceDefinition, SourceFile, ParseOptions, UserHome, RootKind, RootOrigin } from "./types";
export { codexHome } from "./codex";
export { piHome } from "./pi";
export { ompSessionDirs } from "./omp";
export { hermesHome } from "./hermes";
export { mergeSessions } from "./util";

/** Registry of all sources. Adding an agent = one module + one entry here (+ a `sources` config key). */
export const SOURCES: SourceDefinition[] = [codexSource, piSource, ompSource, hermesSource, opencodeSource, clineSource, rooSource, kiloSource, genericSource];

const byId = new Map(SOURCES.map((s) => [s.id, s]));
const byFormat: Record<SourceFormat, SourceDefinition> = {
  codex: codexSource,
  pi: piSource,
  generic: genericSource,
  opencode: opencodeSource,
  cline: clineSource,
};

export function sourceFor(root: SessionRoot): SourceDefinition {
  return byId.get(root.source) ?? byFormat[root.format] ?? genericSource;
}

export function sourceById(id: string): SourceDefinition | undefined {
  return byId.get(id);
}

/** WSL distro names as reported by `wsl.exe -l -q` (UTF-16LE output with embedded NULs). Windows only. */
function wslDistros(): string[] {
  if (process.platform !== "win32") return [];
  try {
    const raw = execFileSync("wsl.exe", ["-l", "-q"], { timeout: 5000, windowsHide: true });
    return raw
      .toString("utf16le")
      .split(String.fromCharCode(0))
      .join("")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const SKIP_WINDOWS_USERS = new Set(["public", "default", "default user", "all users", "desktop.ini"]);

/** The local home plus homes on the "other side": WSL distros from Windows, Windows users from WSL. */
export function userHomes(): UserHome[] {
  const kind = platformKind();
  const localLayout: UserHome["layout"] = kind === "darwin" ? "darwin" : kind === "win32" ? "win32" : "linux";
  const out: UserHome[] = [{ home: os.homedir(), origin: "local", layout: localLayout }];
  if (kind === "win32") {
    for (const distro of wslDistros()) {
      for (const prefix of [`\\\\wsl$\\${distro}`, `\\\\wsl.localhost\\${distro}`]) {
        const home = path.join(prefix, "home");
        const users = listDirs(home);
        if (!users.length) continue;
        for (const u of users) out.push({ home: path.join(home, u), origin: "wsl", layout: "linux" });
        out.push({ home: path.join(prefix, "root"), origin: "wsl", layout: "linux" });
        break; // one prefix worked; don't duplicate
      }
    }
  } else if (kind === "wsl") {
    for (const u of listDirs("/mnt/c/Users")) {
      if (SKIP_WINDOWS_USERS.has(u.toLowerCase())) continue;
      out.push({ home: path.join("/mnt/c/Users", u), origin: "windows", layout: "win32" });
    }
  }
  return out;
}

export interface DiscoverOptions {
  extraSessionDirs?: Array<string | ExtraSessionDir>;
  sources?: Partial<SourcesConfig>;
  /** Override the scanned homes (tests). */
  homes?: UserHome[];
  env?: NodeJS.ProcessEnv;
}

/** Discover existing session roots for every enabled source plus user-configured extra dirs. */
export function discoverSessionRoots(opts: DiscoverOptions = {}): SessionRoot[] {
  const enabled: Record<string, boolean> = { codex: true, pi: true, omp: true, hermes: true, opencode: true, cline: true, roo: true, kilo: true, ...(opts.sources ?? {}) };
  const ctx: SourceContext = { homes: opts.homes ?? userHomes(), platform: platformKind(), env: opts.env ?? process.env };
  const roots: SessionRoot[] = [];
  const seen = new Set<string>();
  const add = (r: SessionRoot) => {
    const key = `${path.resolve(r.dir)}|${r.exts.join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(r);
  };
  for (const s of SOURCES) {
    if (s.id === "generic" || enabled[s.id] === false) continue;
    try {
      for (const r of s.discover(ctx)) add(r);
    } catch {
      /* a source must never break discovery */
    }
  }
  for (const entry of opts.extraSessionDirs ?? []) {
    const e = normalizeExtraDir(entry);
    if (!e) continue;
    const dir = e.path.replace(/^~(?=$|\/|\\)/, os.homedir());
    if (!fs.existsSync(dir)) continue;
    const def = byFormat[e.format ?? "generic"] ?? genericSource;
    add(def.extraRoot(dir, e.agent));
  }
  return roots;
}

/** Recursively list files under a root that match its suffixes. */
export function walkFiles(root: SessionRoot): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < root.maxDepth && !e.name.startsWith(".")) walk(p, depth + 1);
      } else if (e.isFile() && root.exts.some((x) => e.name.endsWith(x))) {
        out.push(p);
      }
    }
  };
  walk(root.dir, 0);
  return out;
}

/** List matching files directly inside a directory (non-recursive). */
export function listFiles(dir: string, exts: string[]): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && exts.some((x) => e.name.endsWith(x)))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

export function describeRoot(root: SessionRoot): string {
  const tags = [root.agent];
  if (root.format !== root.agent && root.source !== root.agent) tags.push(root.format);
  if (root.origin === "wsl" || root.origin === "windows") tags.push(root.origin);
  if (root.origin === "extra") tags.push("custom");
  return `${root.dir}  [${tags.join(" · ")}]`;
}
