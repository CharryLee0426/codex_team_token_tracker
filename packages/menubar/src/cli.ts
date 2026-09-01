import path from "node:path";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { installElectronBinary } from "./core/electron-install";
import { formatPercent, formatTokens, formatUSD, machineTimeZone } from "@codex-tracker/shared";
import {
  EDITABLE_KEYS,
  coerceConfigValue,
  parseBool,
  configDir,
  loadConfig,
  updateConfig,
  type TrackerConfig,
} from "./core/config";
import { Engine } from "./core/engine";
import { hasDisplay, platformKind, systemLocale } from "./core/platform";
import { describeRoot, discoverSessionRoots } from "./core/sources";
import { SOURCE_IDS, normalizeSources, type SourcesConfig } from "./core/config";
import { errorMessage } from "./core/uploader";
import { checkForUpdate, runUpdate as installUpdate } from "./core/update";
import { durationShort, localeTag, makeT, relativeTime, resolveLanguage, windowLabel, type LanguageSetting } from "./i18n";
import { APP_VERSION } from "./version";

interface Args {
  command: string | null;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { command: null, positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-v") out.flags.version = true;
    else if (a === "-h") out.flags.help = true;
    else if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) out.flags[k] = inline;
      else if (["dashboard", "interval"].includes(k) && argv[i + 1] && !argv[i + 1].startsWith("-")) out.flags[k] = argv[++i];
      else out.flags[k] = true;
    } else if (!out.command) out.command = a;
    else out.positional.push(a);
  }
  return out;
}

function lang(cfg: TrackerConfig = loadConfig()) {
  return resolveLanguage(cfg.language, systemLocale());
}

function applyDashboardFlag(flags: Args["flags"]): TrackerConfig {
  const cfg = loadConfig();
  const d = flags.dashboard;
  if (typeof d === "string" && d) {
    const url = coerceConfigValue("dashboardUrl", d) as string;
    if (url !== cfg.dashboardUrl) return updateConfig({ dashboardUrl: url, convexUrl: null });
  }
  return cfg;
}

function electronBinary(): string | null {
  try {
    // Under plain Node, require("electron") resolves to the binary path (string).
    const p = require("electron") as unknown;
    return typeof p === "string" && p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function electronPackageDir(): string | null {
  try {
    return path.dirname(require.resolve("electron/package.json"));
  } catch {
    return null;
  }
}

/**
 * The `electron` npm package is installed but its binary was never downloaded — npm ≥ 11 and pnpm ≥ 10
 * block dependency install scripts by default (`npm warn allow-scripts electron`). Install it now with our
 * own downloader/extractor (≈100 MB once; honours ELECTRON_MIRROR / HTTPS_PROXY), falling back to Electron's
 * install.js.
 */
async function ensureElectron(): Promise<string | null> {
  const existing = electronBinary();
  if (existing) return existing;
  const dir = electronPackageDir();
  if (!dir) return null; // package itself is missing (optional dependency skipped)
  const t = makeT(lang());
  console.log(t("cliDownloadingElectron"));
  const log = { info: (m: string) => console.log(m), error: (m: string) => console.error(m) };
  let bin: string | null = null;
  try {
    bin = await installElectronBinary(dir, log);
  } catch (err) {
    log.error(`  ${(err as Error).message}`);
  }
  if (!bin) {
    const installer = path.join(dir, "install.js");
    if (fs.existsSync(installer)) {
      const env = { ...process.env };
      delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
      spawnSync(process.execPath, [installer], { stdio: "inherit", cwd: dir, env });
    }
  }
  try {
    delete require.cache[require.resolve("electron")];
  } catch {
    /* ignore */
  }
  const found = electronBinary();
  if (!found) console.error(t("cliElectronDownloadFailed"));
  return found;
}

async function startMenubar(background: boolean): Promise<number> {
  const t = makeT(lang());
  const bin = await ensureElectron();
  if (!bin) {
    console.error(t("cliNoElectron"));
    return 2;
  }
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_TRACKER_HOME: configDir() };
  delete env.ELECTRON_RUN_AS_NODE;
  const mainPath = path.join(__dirname, "main.js");
  console.log(t("cliStartingMenubar"));
  const child = spawn(bin, [mainPath], {
    stdio: background ? "ignore" : "inherit",
    detached: background,
    env,
    windowsHide: true,
  });
  if (background) {
    child.unref();
    return 0;
  }
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }
  return -1; // keep running
}

async function runStatus(json: boolean): Promise<number> {
  const cfg = loadConfig();
  const L = lang(cfg);
  const t = makeT(L);
  const engine = new Engine({ upload: false, watch: false, systemLocale: systemLocale() });
  await engine.start();
  const s = engine.snapshot();
  if (json) {
    console.log(JSON.stringify(s, null, 2));
    return 0;
  }
  const tag = localeTag(L);
  const date = new Intl.DateTimeFormat(tag, { dateStyle: "full" }).format(new Date());
  const line = (label: string, value: string) => console.log(`${label.padEnd(14)} ${value}`);
  const period = (p: { usage: typeof s.today.usage; cost: number; cacheHitRate: number }) =>
    `${formatTokens(p.usage.total)} tok · ${formatUSD(p.cost)} · ${t("cacheHit").toLowerCase()} ${formatPercent(p.cacheHitRate)} · ${formatTokens(p.usage.input)} ${t("input").toLowerCase()} / ${formatTokens(p.usage.output)} ${t("output").toLowerCase()} · ${p.usage.requests} ${t("requests").toLowerCase()}`;
  console.log(t("cliStatusTitle", { date }) + ` (${machineTimeZone()})`);
  console.log("");
  line(t("cliStatusToday"), period(s.today));
  line(t("cliStatusWeek"), period(s.week));
  line(t("cliStatusMonth"), period(s.month));
  console.log("");
  if (s.live) {
    const ctx = s.live.contextWindow ? ` · ${t("context").toLowerCase()} ${formatPercent(s.live.contextUsed / s.live.contextWindow)}` : "";
    line(t("cliStatusLive"), `${s.live.projectName ?? s.live.sessionId} · ${s.live.model} · ${s.live.tokensPerSecond.toFixed(1)} ${t("tokensPerSec")}${ctx}`);
  } else {
    line(t("cliStatusLive"), t("cliStatusNoLive"));
  }
  if (s.rateLimits) {
    const rl = s.rateLimits;
    const parts: string[] = [];
    for (const w of [rl.primary, rl.secondary]) {
      if (!w) continue;
      const reset = w.resetsAt ? ` (${t("resetsIn", { time: durationShort(L, w.resetsAt - Date.now()) })})` : "";
      parts.push(`${windowLabel(L, w.windowMinutes)}: ${w.usedPercent.toFixed(0)}%${reset}`);
    }
    if (rl.limitReached) parts.push(t("limitReached"));
    if (rl.planType) parts.push(`${t("plan").toLowerCase()} ${rl.planType}`);
    if (rl.credits?.hasCredits) parts.push(`${t("credits").toLowerCase()} ${rl.credits.balance ?? ""}`.trim());
    const when = s.rateLimitsUpdatedAt ? relativeTime(L, s.rateLimitsUpdatedAt) : "";
    parts.push(rl.source === "live" ? `${t("liveTag").toLowerCase()} ${when}`.trim() : `${t("fromLogs").toLowerCase()} ${when}`.trim());
    line(t("cliStatusLimits"), parts.join(" · "));
    for (const a of rl.additional) {
      const bits = [a.primary, a.secondary].filter(Boolean).map((w) => `${windowLabel(L, w!.windowMinutes)} ${w!.usedPercent.toFixed(0)}%`);
      if (bits.length) console.log(`  ${a.name.padEnd(26)} ${bits.join(" · ")}`);
    }
    if (s.rateLimitsError) console.log(`  ${t("liveLimitsError", { message: s.rateLimitsError })}`);
  }
  if (s.byAgentMonth.length) {
    line(t("cliStatusSources"), s.byAgentMonth.map((a) => `${a.agent} ${formatTokens(a.usage.total)} (${formatPercent(a.share)})`).join(" · "));
  }
  console.log("");
  console.log(t("cliStatusModels"));
  for (const m of s.modelsMonth.slice(0, 8)) {
    console.log(
      `  ${m.model.padEnd(24)} ${formatPercent(m.share).padStart(4)}  ${formatTokens(m.usage.total).padStart(8)}  ${formatUSD(m.cost).padStart(9)}${m.estimated ? `  (${t("estimated")})` : ""}${m.agents.some((a) => a !== "codex") ? `  [${m.agents.join(", ")}]` : ""}`,
    );
  }
  console.log("");
  line(
    t("cliStatusAccount"),
    s.auth.status === "signedIn"
      ? `${t("signedInAs", { name: s.auth.user?.name || s.auth.user?.email || "?" })} · ${s.auth.dashboardUrl}`
      : t("cliNotSignedIn"),
  );
  line(t("cliStatusDirs"), s.sessionDirs.join("\n" + " ".repeat(15)) || "-");
  const byAgent = Object.entries(s.counts.byAgent)
    .sort((a, b) => b[1].sessions - a[1].sessions)
    .map(([agent, c]) => `${agent} ${c.sessions}`)
    .join(", ");
  console.log(t("sessions", { n: s.counts.sessions }) + " · " + t("files", { n: s.counts.files }) + (byAgent ? ` (${byAgent})` : ""));
  if (cfg.checkUpdates) {
    const u = await checkForUpdate();
    if (u.available) console.log("\n" + t("cliUpdateAvailable", { current: u.current, latest: u.latest ?? "?" }) + ` — ${u.command}`);
  }
  return 0;
}

/**
 * `codex-tracker sync` — the CLI twin of the popover's Sync button: re-discover every agent on this
 * device, re-parse every transcript and re-upload the whole history so the dashboard's numbers for
 * this device are recalibrated.
 */
async function runSync(flags: Args["flags"]): Promise<number> {
  const cfg = applyDashboardFlag(flags);
  const L = lang(cfg);
  const t = makeT(L);
  const engine = new Engine({
    upload: true,
    watch: false,
    systemLocale: systemLocale(),
    log: process.env.CODEX_TRACKER_DEBUG ? (m) => console.error("[sync]", m) : undefined,
  });
  console.log(t("cliSyncStart"));
  const result = await engine.syncNow();
  if (!result) {
    console.error(t("cliSyncFailed", { message: engine.snapshot().sync.error ?? "?" }));
    return 1;
  }
  console.log(t("cliSyncScanned", { files: result.files, roots: result.roots, agents: result.agents.join(", ") || "-" }));
  if (result.uploaded) console.log(t("cliSyncUploaded", { buckets: result.uploadedBuckets, sessions: result.uploadedSessions }));
  else console.log(t("cliSyncLocal"));
  const s = engine.snapshot();
  console.log(
    t("cliSyncDone", {
      seconds: (result.durationMs / 1000).toFixed(1),
      sessions: result.sessions,
      tokens: formatTokens(s.today.usage.total),
      cost: formatUSD(s.today.cost),
    }),
  );
  return 0;
}

async function runLogin(flags: Args["flags"]): Promise<number> {
  const cfg = applyDashboardFlag(flags);
  const L = lang(cfg);
  const t = makeT(L);
  console.log(t("cliLoginStart", { dashboard: cfg.dashboardUrl }));
  const engine = new Engine({ upload: false, watch: false, systemLocale: systemLocale() });
  try {
    const result = await engine.login(hasDisplay(), (code, url) => {
      console.log("");
      console.log("  " + t("cliLoginCode", { code }));
      console.log("");
      console.log(t("cliLoginOpen", { url }));
      console.log("");
      console.log(t("cliLoginWaiting"));
    });
    if (result.status === "approved") {
      console.log(t("cliLoginSuccess", { name: result.user.name || result.user.email || "?" }));
      return 0;
    }
    console.error(result.status === "denied" ? t("cliLoginDenied") : t("cliLoginExpired"));
    return 1;
  } catch (err) {
    console.error(t("cliLoginFailed", { message: errorMessage(err) }));
    return 1;
  }
}

async function runAgent(flags: Args["flags"]): Promise<number> {
  const cfg = applyDashboardFlag(flags);
  const L = lang(cfg);
  const t = makeT(L);
  const once = flags.once === true;
  const interval = typeof flags.interval === "string" ? Math.max(10, Number(flags.interval) || cfg.uploadIntervalSec) : cfg.uploadIntervalSec;
  if (interval !== cfg.uploadIntervalSec) updateConfig({ uploadIntervalSec: interval });
  const engine = new Engine({ upload: !once, watch: !once, systemLocale: systemLocale(), log: process.env.CODEX_TRACKER_DEBUG ? (m) => console.error("[agent]", m) : undefined });
  const tag = localeTag(L);
  const printLine = (upload: string) => {
    const s = engine.snapshot();
    const time = new Intl.DateTimeFormat(tag, { timeStyle: "medium" }).format(new Date());
    console.log(
      t("cliAgentLine", {
        time,
        tokens: formatTokens(s.today.usage.total),
        cost: formatUSD(s.today.cost),
        cache: formatPercent(s.today.cacheHitRate),
        tps: s.live ? s.live.tokensPerSecond.toFixed(1) : "0",
        sessions: s.counts.sessions,
        upload,
      }),
    );
  };
  await engine.start();
  if (!engine.signedIn) console.log(t("cliNotSignedIn"));
  if (once) {
    let upload = "";
    if (engine.signedIn) {
      try {
        const r = await engine.uploadNow();
        await engine.heartbeatNow();
        upload = t("cliAgentUploaded", { buckets: r.buckets });
      } catch (err) {
        upload = t("cliAgentUploadError", { message: errorMessage(err) });
      }
    }
    printLine(upload);
    engine.stop();
    return 0;
  }
  console.log(t("cliAgentStarted", { interval }));
  printLine("");
  const tick = setInterval(async () => {
    let upload = "";
    if (engine.signedIn) {
      try {
        const r = await engine.uploadNow();
        upload = r.buckets ? t("cliAgentUploaded", { buckets: r.buckets }) : "";
      } catch (err) {
        upload = t("cliAgentUploadError", { message: errorMessage(err) });
      }
    }
    printLine(upload);
  }, interval * 1000);
  const stop = () => {
    clearInterval(tick);
    engine.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return -1;
}

function runPaths(): number {
  const cfg = loadConfig();
  const t = makeT(lang(cfg));
  const roots = discoverSessionRoots({ extraSessionDirs: cfg.extraSessionDirs, sources: cfg.sources });
  if (!roots.length) {
    console.log(t("cliPathsNone"));
    return 1;
  }
  console.log(t("cliPathsTitle"));
  for (const r of roots) console.log("  " + describeRoot(r));
  const off = SOURCE_IDS.filter((id) => !cfg.sources[id]);
  if (off.length) console.log(`  (disabled: ${off.join(", ")})`);
  console.log(t("cliConfigDir", { dir: configDir() }));
  return 0;
}

function runConfig(positional: string[]): number {
  const cfg = loadConfig();
  const t = makeT(lang(cfg));
  const [action, key, ...rest] = positional;
  if (action === "set" && key && key.startsWith("sources.")) {
    const id = key.slice("sources.".length) as keyof SourcesConfig;
    if (!SOURCE_IDS.includes(id)) {
      console.error(t("cliConfigUnknownKey", { key, keys: SOURCE_IDS.map((s) => `sources.${s}`).join(", ") }));
      return 1;
    }
    const sources = normalizeSources({ ...cfg.sources, [id]: parseBool(rest.join(" ")) });
    updateConfig({ sources });
    console.log(t("cliConfigSet", { key, value: JSON.stringify(sources[id]) }));
    return 0;
  }
  if (action === "set" && key) {
    if (!EDITABLE_KEYS.includes(key as keyof TrackerConfig)) {
      console.error(t("cliConfigUnknownKey", { key, keys: EDITABLE_KEYS.join(", ") }));
      return 1;
    }
    const value = rest.join(" ");
    try {
      const coerced = coerceConfigValue(key as keyof TrackerConfig, value);
      const patch: Partial<TrackerConfig> = { [key]: coerced } as Partial<TrackerConfig>;
      if (key === "dashboardUrl") patch.convexUrl = null;
      updateConfig(patch);
      console.log(t("cliConfigSet", { key, value: JSON.stringify(coerced) }));
      return 0;
    } catch (err) {
      console.error(errorMessage(err));
      return 1;
    }
  }
  const redacted = { ...cfg, deviceToken: cfg.deviceToken ? cfg.deviceToken.slice(0, 8) + "…" : null };
  if (action === "get" && key) {
    console.log(JSON.stringify((redacted as unknown as Record<string, unknown>)[key] ?? null, null, 2));
    return 0;
  }
  console.log(JSON.stringify(redacted, null, 2));
  console.log(t("cliConfigDir", { dir: configDir() }));
  return 0;
}

/**
 * `update` — report the newest published version and, unless `--check`, install it globally with
 * the package manager this copy came from. The installer's output is streamed through so a failure
 * (root-owned prefix, proxy, offline) is visible rather than swallowed.
 */
async function runUpdateCommand(flags: Args["flags"]): Promise<number> {
  const t = makeT(lang());
  const info = await checkForUpdate({ force: true });
  if (info.error && !info.latest) {
    console.error(t("cliUpdateCheckFailed", { message: info.error }));
    return 1;
  }
  if (!info.available) {
    console.log(t("cliUpdateLatest", { version: info.current }));
    return 0;
  }
  console.log(t("cliUpdateAvailable", { current: info.current, latest: info.latest ?? "?" }));
  if (flags.check === true) {
    console.log(`  ${info.command}`);
    return 0;
  }
  console.log(t("cliUpdateRunning", { command: info.command }));
  const r = await installUpdate({ version: info.latest ?? undefined, onOutput: (c) => process.stdout.write(c) });
  if (!r.ok) {
    console.error(t("cliUpdateFailed", { code: r.code ?? "?", command: r.command }));
    return 1;
  }
  console.log(t("cliUpdateDone", { version: info.latest ?? "?" }));
  return 0;
}

function runLang(positional: string[]): number {
  const value = positional[0];
  if (!value || !["en", "zh", "auto"].includes(value)) {
    console.error("usage: codex-tracker lang <en|zh|auto>");
    return 1;
  }
  updateConfig({ language: value as LanguageSetting });
  console.log(makeT(lang()).call(null, "cliLangSet", { lang: value }));
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const t = makeT(lang());
  if (args.flags.version) {
    console.log(t("cliVersion", { version: APP_VERSION }));
    return 0;
  }
  if (args.flags.help || args.command === "help") {
    console.log(t("cliUsage"));
    return 0;
  }
  switch (args.command) {
    case null: {
      applyDashboardFlag(args.flags);
      if (!hasDisplay()) {
        console.log(t("cliNoDisplay"));
        return runAgent(args.flags);
      }
      if (!(await ensureElectron())) {
        console.log(t("cliNoElectron"));
        return runAgent(args.flags);
      }
      return startMenubar(args.flags.background === true);
    }
    case "menubar":
    case "tray":
      applyDashboardFlag(args.flags);
      return startMenubar(args.flags.background === true);
    case "agent":
    case "daemon":
      return runAgent(args.flags);
    case "login":
      return runLogin(args.flags);
    case "logout": {
      const { logoutDevice } = await import("./core/auth");
      logoutDevice();
      console.log(t("cliLogoutDone"));
      return 0;
    }
    case "status":
      return runStatus(args.flags.json === true);
    case "sync":
      return runSync(args.flags);
    case "paths":
      return runPaths();
    case "config":
      return runConfig(args.positional);
    case "lang":
      return runLang(args.positional);
    case "update":
    case "upgrade":
      return runUpdateCommand(args.flags);
    default:
      console.error(t("cliUnknownCommand", { command: args.command }));
      console.log(t("cliUsage"));
      return 1;
  }
}

main()
  .then((code) => {
    if (code >= 0) process.exit(code);
  })
  .catch((err) => {
    console.error(errorMessage(err));
    process.exit(1);
  });

// platform is imported for side-effect-free typing in some builds
void platformKind;
