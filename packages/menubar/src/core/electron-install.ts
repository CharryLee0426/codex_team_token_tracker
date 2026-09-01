import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Self-contained Electron binary installer used when the `electron` npm package is present but its
 * binary is missing — npm ≥ 11 / pnpm ≥ 10 block install scripts of dependencies by default, and
 * Electron's own `install.js` (extract-zip) can exit 0 without extracting on newer Node versions.
 *
 * Flow: reuse a zip from Electron's download cache → otherwise download from GitHub releases (or
 * `ELECTRON_MIRROR`, e.g. https://npmmirror.com/mirrors/electron/) → extract with the OS tool
 * (`ditto` / `unzip` / `tar`) → write `path.txt` exactly like Electron's installer does.
 */

export interface InstallLog {
  info(msg: string): void;
  error(msg: string): void;
}

function archName(): string {
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    case "ia32":
      return "ia32";
    case "arm":
      return "armv7l";
    default:
      return process.arch;
  }
}

export function platformExecutablePath(): string {
  switch (process.platform) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "win32":
      return "electron.exe";
    default:
      return "electron";
  }
}

function electronCacheRoots(): string[] {
  const roots: string[] = [];
  if (process.env.electron_config_cache) roots.push(process.env.electron_config_cache);
  const home = os.homedir();
  if (process.platform === "darwin") roots.push(path.join(home, "Library", "Caches", "electron"));
  else if (process.platform === "win32") {
    if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, "electron", "Cache"));
  } else roots.push(path.join(process.env.XDG_CACHE_HOME ?? path.join(home, ".cache"), "electron"));
  return roots.filter((r) => fs.existsSync(r));
}

function findInDirs(dirs: string[], filename: string, depth = 3): string | null {
  for (const dir of dirs) {
    const found = walk(dir, filename, depth);
    if (found) return found;
  }
  return null;
}

function walk(dir: string, filename: string, depth: number): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === filename && fs.statSync(p).size > 1_000_000) return p;
  }
  if (depth <= 0) return null;
  for (const e of entries) {
    if (e.isDirectory()) {
      const r = walk(path.join(dir, e.name), filename, depth - 1);
      if (r) return r;
    }
  }
  return null;
}

function downloadUrl(version: string, filename: string): string {
  const mirror = process.env.ELECTRON_MIRROR || "https://github.com/electron/electron/releases/download/v";
  const dir = process.env.ELECTRON_CUSTOM_DIR ? process.env.ELECTRON_CUSTOM_DIR.replace("{{ version }}", version) : version;
  const base = mirror.endsWith("/") || mirror.endsWith("v") ? mirror : mirror + "/";
  return `${base}${dir}/${filename}`;
}

async function download(url: string, dest: string, log: InstallLog): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get("content-length") || 0);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + ".part";
  const out = fs.createWriteStream(tmp);
  let received = 0;
  let lastPct = -10;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
      if (total) {
        const pct = Math.floor((received / total) * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          log.info(`  ${pct}% (${(received / 1_048_576).toFixed(0)} / ${(total / 1_048_576).toFixed(0)} MB)`);
        }
      }
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }
  fs.renameSync(tmp, dest);
}

function extractZip(zip: string, dest: string): boolean {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const attempts: Array<[string, string[]]> =
    process.platform === "darwin"
      ? [["ditto", ["-x", "-k", zip, dest]], ["unzip", ["-q", "-o", zip, "-d", dest]]]
      : process.platform === "win32"
        ? [
            ["tar", ["-xf", zip, "-C", dest]],
            ["powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`]],
          ]
        : [["unzip", ["-q", "-o", zip, "-d", dest]], ["bsdtar", ["-xf", zip, "-C", dest]], ["tar", ["-xf", zip, "-C", dest]]];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { stdio: "ignore", windowsHide: true });
    if (r.status === 0 && fs.existsSync(path.join(dest, platformExecutablePath()))) return true;
  }
  return false;
}

/** Install the Electron binary into `<pkgDir>/dist` and write `path.txt`. Returns the executable path. */
export async function installElectronBinary(pkgDir: string, log: InstallLog): Promise<string | null> {
  let version: string;
  try {
    version = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
  const platform = process.platform === "darwin" && process.env.npm_config_platform === "mas" ? "mas" : process.platform;
  const filename = `electron-v${version}-${platform}-${archName()}.zip`;
  const dist = path.join(pkgDir, "dist");
  const exe = path.join(dist, platformExecutablePath());

  let zip = findInDirs(electronCacheRoots(), filename);
  if (zip) log.info(`  using cached ${path.basename(zip)}`);
  else {
    const cacheRoot = electronCacheRoots()[0] ?? path.join(os.tmpdir(), "codex-tracker-electron");
    zip = path.join(cacheRoot, "codex-token-tracker", filename);
    const url = downloadUrl(version, filename);
    log.info(`  ${url}`);
    try {
      await download(url, zip, log);
    } catch (err) {
      log.error(`  download failed: ${(err as Error).message}`);
      return null;
    }
  }
  if (!extractZip(zip, dist)) {
    log.error("  extraction failed (no ditto/unzip/tar available?)");
    return null;
  }
  fs.writeFileSync(path.join(pkgDir, "path.txt"), platformExecutablePath());
  return fs.existsSync(exe) ? exe : null;
}
