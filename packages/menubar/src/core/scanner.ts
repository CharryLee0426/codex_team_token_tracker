import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { platformKind } from "./platform";

export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listDirs(p: string): string[] {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** WSL distro names as reported by `wsl.exe -l -q` (UTF-16LE output). Windows only. */
function wslDistros(): string[] {
  if (process.platform !== "win32") return [];
  try {
    const raw = execFileSync("wsl.exe", ["-l", "-q"], { timeout: 5000, windowsHide: true });
    return raw
      .toString("utf16le")
      .replace(/\u0000/g, "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const SKIP_WINDOWS_USERS = new Set(["public", "default", "default user", "all users", "desktop.ini"]);

/** Candidate `.codex` homes beyond the local one: WSL distros from Windows, Windows users from WSL. */
function crossPlatformCodexHomes(): string[] {
  const out: string[] = [];
  const kind = platformKind();
  if (kind === "win32") {
    for (const distro of wslDistros()) {
      for (const prefix of [`\\\\wsl$\\${distro}`, `\\\\wsl.localhost\\${distro}`]) {
        const home = path.join(prefix, "home");
        const users = listDirs(home);
        if (!users.length) continue;
        for (const u of users) out.push(path.join(home, u, ".codex"));
        out.push(path.join(prefix, "root", ".codex"));
        break; // one prefix worked; don't duplicate
      }
    }
  } else if (kind === "wsl") {
    for (const u of listDirs("/mnt/c/Users")) {
      if (SKIP_WINDOWS_USERS.has(u.toLowerCase())) continue;
      out.push(path.join("/mnt/c/Users", u, ".codex"));
    }
  }
  return out;
}

export interface SessionRoot {
  dir: string;
  kind: "sessions" | "archived" | "extra";
  origin: "local" | "wsl" | "windows" | "extra";
}

/** Discover existing session directories. Safe to call repeatedly (cheap stats). */
export function discoverSessionRoots(extraSessionDirs: string[] = []): SessionRoot[] {
  const roots: SessionRoot[] = [];
  const seen = new Set<string>();
  const add = (dir: string, kind: SessionRoot["kind"], origin: SessionRoot["origin"]) => {
    const key = path.resolve(dir);
    if (seen.has(key) || !isDir(dir)) return;
    seen.add(key);
    roots.push({ dir, kind, origin });
  };
  const home = codexHome();
  add(path.join(home, "sessions"), "sessions", "local");
  add(path.join(home, "archived_sessions"), "archived", "local");
  const kind = platformKind();
  for (const h of crossPlatformCodexHomes()) {
    const origin = kind === "win32" ? "wsl" : "windows";
    add(path.join(h, "sessions"), "sessions", origin);
    add(path.join(h, "archived_sessions"), "archived", origin);
  }
  for (const d of extraSessionDirs) add(d.replace(/^~(?=$|\/|\\)/, os.homedir()), "extra", "extra");
  return roots;
}

/** Recursively list rollout .jsonl files under a root. */
export function walkJsonl(root: string, maxDepth = 6): string[] {
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
        if (depth < maxDepth) walk(p, depth + 1);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        out.push(p);
      }
    }
  };
  walk(root, 0);
  return out;
}

/** List .jsonl files directly inside a directory (non-recursive). */
export function listJsonl(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/** Directories that receive new files right now: <root>/YYYY/MM/DD for today/yesterday (local) and today (UTC). */
export function hotDirs(root: SessionRoot): string[] {
  if (root.kind !== "sessions") return [root.dir];
  const dirs: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const offset of [0, -1]) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    dirs.push(path.join(root.dir, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())));
  }
  const u = new Date();
  dirs.push(path.join(root.dir, String(u.getUTCFullYear()), pad(u.getUTCMonth() + 1), pad(u.getUTCDate())));
  return [...new Set(dirs)];
}
