import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { MACHINE_ID_PREFIX, randomHex, sha256Hex } from "@codex-tracker/shared";
import type { Language } from "../i18n";
import { languageFromLocale } from "../i18n";
import { configDir } from "./config";

export type PlatformKind = "darwin" | "win32" | "linux" | "wsl";

let wslCache: boolean | null = null;
export function isWSL(): boolean {
  if (wslCache !== null) return wslCache;
  if (process.platform !== "linux") return (wslCache = false);
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return (wslCache = true);
  try {
    const v = fs.readFileSync("/proc/version", "utf8").toLowerCase();
    return (wslCache = v.includes("microsoft") || v.includes("wsl"));
  } catch {
    return (wslCache = false);
  }
}

export function platformKind(): PlatformKind {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  return isWSL() ? "wsl" : "linux";
}

export function platformLabel(kind: PlatformKind = platformKind()): string {
  return { darwin: "macOS", win32: "Windows", wsl: "WSL", linux: "Linux" }[kind];
}

export function hostname(): string {
  try {
    return os.hostname().replace(/\.local$/, "");
  } catch {
    return "unknown-host";
  }
}

export function deviceName(): string {
  const kind = platformKind();
  const distro = kind === "wsl" ? process.env.WSL_DISTRO_NAME : null;
  return `${hostname()} (${distro ? `WSL ${distro}` : platformLabel(kind)})`;
}

// ---------- machine identity ----------

const MACHINE_ID_FILE = "machine-id";
let machineIdCache: string | null = null;

function runCapture(cmd: string, args: string[]): string | null {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 5_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    if (r.error || r.status !== 0 || typeof r.stdout !== "string") return null;
    // reg.exe reached through WSL interop can hand back UTF-16; dropping NULs makes both encodings parse.
    return r.stdout.replace(/\0/g, "");
  } catch {
    return null;
  }
}

/** `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid` → the GUID, or null. */
export function parseMachineGuid(output: string | null): string | null {
  if (!output) return null;
  const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(output);
  return m ? m[1].toLowerCase() : null;
}

/** `ioreg -rd1 -c IOPlatformExpertDevice` → IOPlatformUUID, or null. */
export function parsePlatformUuid(output: string | null): string | null {
  if (!output) return null;
  const m = /"IOPlatformUUID"\s*=\s*"([0-9a-fA-F-]{36})"/.exec(output);
  return m ? m[1].toLowerCase() : null;
}

function windowsMachineGuid(regExe: string): string | null {
  return parseMachineGuid(runCapture(regExe, ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]));
}

function readFirstLine(file: string): string | null {
  try {
    const v = fs.readFileSync(file, "utf8").trim();
    return v.length >= 8 ? v : null;
  } catch {
    return null;
  }
}

/**
 * A stable identifier of this computer, taken from the OS: the IOPlatformUUID on macOS, the registry
 * MachineGuid on Windows, /etc/machine-id on Linux. Inside WSL the *Windows* MachineGuid is preferred
 * (via `reg.exe` interop) so the WSL agent and a Windows tray app on the same PC agree that they are
 * one machine. When none is readable, a random id is generated once and kept in the config directory.
 * Prefixed with the source so ids from different sources can never collide.
 */
function rawMachineId(): string {
  const kind = platformKind();
  if (kind === "darwin") {
    const uuid = parsePlatformUuid(runCapture("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]));
    if (uuid) return `darwin:${uuid}`;
  } else if (kind === "win32") {
    const guid = windowsMachineGuid("reg");
    if (guid) return `win32:${guid}`;
  } else {
    if (kind === "wsl") {
      for (const reg of ["/mnt/c/Windows/System32/reg.exe", "/mnt/c/WINDOWS/system32/reg.exe"]) {
        if (!fs.existsSync(reg)) continue;
        const guid = windowsMachineGuid(reg);
        if (guid) return `win32:${guid}`;
        break;
      }
    }
    for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      const id = readFirstLine(f);
      if (id) return `linux:${id.toLowerCase()}`;
    }
  }
  const file = path.join(configDir(), MACHINE_ID_FILE);
  const existing = readFirstLine(file);
  if (existing) return `file:${existing}`;
  const generated = randomHex(16);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated + "\n", { mode: 0o600 });
  } catch {
    /* unwritable config dir: the id lives for this process only */
  }
  return `file:${generated}`;
}

/**
 * Hashed machine identity sent to the dashboard so one computer maps to one device however many times
 * it logs in (tray app + headless agent, re-logins). Only the SHA-256 leaves the machine, never the
 * raw hardware id; the value is computed once per process.
 */
export function machineId(): string {
  if (!machineIdCache) machineIdCache = MACHINE_ID_PREFIX + sha256Hex(`codex-tracker-machine:${rawMachineId()}`).slice(0, 40);
  return machineIdCache;
}

export function hasDisplay(): boolean {
  const kind = platformKind();
  if (kind === "darwin" || kind === "win32") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Open a URL in the user's default browser without third-party dependencies. */
export async function openUrl(url: string): Promise<boolean> {
  const kind = platformKind();
  if (kind === "darwin") return run("open", [url]);
  if (kind === "win32") return run("cmd", ["/c", "start", "", url.replace(/&/g, "^&")]);
  if (kind === "wsl") {
    if (await run("wslview", [url])) return true;
    if (await run("powershell.exe", ["-NoProfile", "-Command", `Start-Process '${url.replace(/'/g, "''")}'`])) return true;
    return run("cmd.exe", ["/c", "start", "", url.replace(/&/g, "^&")]);
  }
  return run("xdg-open", [url]);
}

/** Best-effort OS language from the environment (Electron main should prefer app.getLocale()). */
export function systemLocale(): string {
  for (const k of ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"]) {
    const v = process.env[k];
    if (v && v !== "C" && v !== "POSIX") return v.split(":")[0];
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en";
  }
}

export function systemLanguage(): Language {
  return languageFromLocale(systemLocale());
}
