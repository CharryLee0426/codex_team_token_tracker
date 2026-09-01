import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import type { Language } from "../i18n";
import { languageFromLocale } from "../i18n";

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
