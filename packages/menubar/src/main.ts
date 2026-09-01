import { app, ipcMain, Menu, nativeImage, nativeTheme, shell, type MenuItemConstructorOptions } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { menubar, type Menubar } from "menubar";
import { formatTokens, formatUSD } from "@codex-tracker/shared";
import { Engine } from "./core/engine";
import { errorMessage } from "./core/uploader";
import type { Snapshot } from "./core/snapshot";
import { t, type LanguageSetting } from "./i18n";
import { APP_NAME, APP_VERSION, IS_DEV_BUILD } from "./version";

const DEBUG = Boolean(process.env.CODEX_TRACKER_DEBUG);
const assetsDir = path.join(__dirname, "..", "assets");
const rendererIndex = path.join(__dirname, "renderer", "index.html");
const preloadPath = path.join(__dirname, "preload.js");
const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";

let mb: Menubar | null = null;
let engine: Engine | null = null;
let lastSnapshot: Snapshot | null = null;

function log(...args: unknown[]) {
  if (DEBUG) console.error("[codex-tracker]", ...args);
}

function trayIcon() {
  if (isMac) {
    const img = nativeImage.createFromPath(path.join(assetsDir, "trayTemplate.png"));
    img.setTemplateImage(true);
    return img;
  }
  const file = nativeTheme.shouldUseDarkColors || !isWin ? "tray-win.png" : "tray-win-light.png";
  const img = nativeImage.createFromPath(path.join(assetsDir, file));
  return isWin ? img.resize({ width: 16, height: 16 }) : img;
}

function trayText(s: Snapshot): string {
  switch (s.trayTitle) {
    case "tokens":
      return formatTokens(s.today.usage.total);
    case "cost":
      return formatUSD(s.today.cost);
    default:
      return "";
  }
}

function updateTray(s: Snapshot) {
  if (!mb?.tray) return;
  const L = s.language;
  const live = s.live ? ` · ${s.live.tokensPerSecond.toFixed(1)} ${t(L, "tokensPerSec")}` : "";
  mb.tray.setToolTip(`${APP_NAME} — ${t(L, "today")}: ${formatTokens(s.today.usage.total)} · ${formatUSD(s.today.cost)}${live}`);
  if (isMac) mb.tray.setTitle(trayText(s), { fontType: "monospacedDigit" });
}

// ---------- launch at login ----------
const launchAgentLabel = IS_DEV_BUILD ? "dev.codex-tracker.menubar.dev" : "dev.codex-tracker.menubar";
const launchAgentPath = path.join(os.homedir(), "Library", "LaunchAgents", `${launchAgentLabel}.plist`);

function setLaunchAtLogin(enabled: boolean) {
  if (isMac) {
    if (enabled) {
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${launchAgentLabel}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${path.join(__dirname, "main.js")}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Interactive</string>
</dict></plist>
`;
      fs.mkdirSync(path.dirname(launchAgentPath), { recursive: true });
      fs.writeFileSync(launchAgentPath, plist);
      execFile("launchctl", ["load", "-w", launchAgentPath], () => {});
    } else if (fs.existsSync(launchAgentPath)) {
      execFile("launchctl", ["unload", "-w", launchAgentPath], () => {
        try {
          fs.unlinkSync(launchAgentPath);
        } catch {
          /* ignore */
        }
      });
    }
    return;
  }
  if (isWin) {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [path.join(__dirname, "main.js")] });
  }
}

// ---------- context menu ----------
function buildMenu(s: Snapshot): Menu {
  const L = s.language;
  const langItem = (label: string, value: LanguageSetting): MenuItemConstructorOptions => ({
    label,
    type: "radio",
    checked: s.languageSetting === value,
    click: () => engine?.setLanguage(value),
  });
  const template: MenuItemConstructorOptions[] = [
    { label: `${APP_NAME} ${t(L, "version", { version: APP_VERSION })}`, enabled: false },
    ...(IS_DEV_BUILD ? [{ label: t(L, "devBuildMenu", { url: s.auth.dashboardUrl }), enabled: false }] : []),
    {
      label:
        s.auth.status === "signedIn"
          ? t(L, "signedInAs", { name: s.auth.user?.name || s.auth.user?.email || "?" })
          : t(L, "signedOut"),
      enabled: false,
    },
    { type: "separator" },
    { label: t(L, "openDashboard"), click: () => void shell.openExternal(s.auth.dashboardUrl) },
    s.auth.status === "signedIn"
      ? { label: t(L, "signOut"), click: () => engine?.logout() }
      : s.auth.status === "pending"
        ? { label: t(L, "cancel"), click: () => engine?.cancelLogin() }
        : { label: t(L, "signIn"), click: () => void startLogin() },
    { type: "separator" },
    {
      label: t(L, "language"),
      submenu: [langItem(t(L, "english"), "en"), langItem(t(L, "chinese"), "zh"), langItem(t(L, "system"), "auto")],
    },
    ...(isMac || isWin
      ? [
          {
            label: t(L, "launchAtLogin"),
            type: "checkbox" as const,
            checked: s.launchAtLogin,
            click: (item: { checked: boolean }) => {
              setLaunchAtLogin(item.checked);
              engine?.setConfig({ launchAtLogin: item.checked });
            },
          },
        ]
      : []),
    { label: t(L, "refresh"), click: () => void engine?.refresh(true) },
    {
      label: s.sync.status === "running" ? t(L, "syncing") : t(L, "syncNow"),
      enabled: s.sync.status !== "running",
      click: () => void engine?.syncNow(),
    },
    ...(s.update
      ? [
          s.update.available
            ? { label: t(L, "updateAvailable", { version: s.update.latest ?? "?" }), click: () => void engine?.installUpdate() }
            : { label: t(L, "checkForUpdates"), click: () => void engine?.checkUpdate(true) },
        ]
      : []),
    { type: "separator" },
    { label: t(L, "quit"), click: () => app.quit() },
  ];
  return Menu.buildFromTemplate(template);
}

async function startLogin() {
  if (!engine) return;
  try {
    await engine.login(true);
  } catch (err) {
    log("login failed", errorMessage(err));
  }
}

// ---------- app ----------
// Name first: the single-instance lock is keyed on the userData directory, which is derived from
// the app name. Setting it after would make a dev build and a released one share one lock, so
// whichever started second would quit instead of running alongside.
app.setName(APP_NAME);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => mb?.showWindow());
  // keep running in the tray when the popover window is closed
  app.on("window-all-closed", () => {});

  mb = menubar({
    index: `file://${rendererIndex}`,
    icon: trayIcon(),
    tooltip: APP_NAME,
    preloadWindow: true,
    showDockIcon: false,
    browserWindow: {
      width: 380,
      height: 620,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#141416" : "#ffffff",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    },
  });

  // IPC handlers are registered before any window exists; they tolerate a not-yet-started engine.
  ipcMain.handle("snapshot:get", () => lastSnapshot ?? engine?.snapshot() ?? null);
  ipcMain.handle("language:set", (_e, lang: LanguageSetting) => engine?.setLanguage(lang));
  ipcMain.handle("dashboard:open", () => shell.openExternal(engine?.config.dashboardUrl ?? ""));
  ipcMain.handle("external:open", (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
    return undefined;
  });
  ipcMain.handle("auth:login", () => startLogin());
  ipcMain.handle("auth:cancel", () => engine?.cancelLogin());
  ipcMain.handle("auth:logout", () => engine?.logout());
  ipcMain.handle("refresh", () => engine?.refresh(true).then(() => undefined));
  ipcMain.handle("sync:now", () => engine?.syncNow().then(() => undefined));
  ipcMain.handle("update:check", () => engine?.checkUpdate(true).then(() => undefined));
  ipcMain.handle("update:install", () => engine?.installUpdate().then(() => undefined));
  ipcMain.handle("quit", () => app.quit());

  mb.on("ready", async () => {
    if (isMac) app.dock?.hide();
    engine = new Engine({ upload: true, systemLocale: app.getLocale(), log: DEBUG ? (m) => log(m) : undefined });
    engine.on("snapshot", (s: Snapshot) => {
      lastSnapshot = s;
      updateTray(s);
      mb?.window?.webContents.send("snapshot", s);
    });
    mb!.tray.on("right-click", () => mb!.tray.popUpContextMenu(buildMenu(lastSnapshot ?? engine!.snapshot())));
    nativeTheme.on("updated", () => {
      if (!isMac) mb!.tray.setImage(trayIcon());
    });

    try {
      await engine.start();
    } catch (err) {
      log("engine start failed", errorMessage(err));
    }
    log("ready", { sessions: engine.snapshot().counts });

    // Debug/docs helper: CODEX_TRACKER_SCREENSHOT=/path/out.png captures the popover and quits.
    const shot = process.env.CODEX_TRACKER_SCREENSHOT;
    if (shot) {
      mb!.showWindow();
      setTimeout(async () => {
        try {
          const img = await mb!.window!.webContents.capturePage();
          fs.writeFileSync(shot, img.toPNG());
          log("screenshot written", shot);
        } catch (err) {
          log("screenshot failed", errorMessage(err));
        }
        app.quit();
      }, 2500);
    }
  });

  mb.on("after-create-window", () => {
    const win = mb!.window!;
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
      if (DEBUG || level >= 2) console.error(`[renderer:${level}] ${message} (${path.basename(sourceId)}:${line})`);
    });
    win.webContents.on("render-process-gone", (_e, details) => log("renderer gone", details));
    if (process.env.CODEX_TRACKER_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
  });

  mb.on("show", () => {
    void engine?.refresh(false);
    if (lastSnapshot) mb?.window?.webContents.send("snapshot", lastSnapshot);
  });
}
