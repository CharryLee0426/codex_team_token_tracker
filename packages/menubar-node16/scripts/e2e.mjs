// End-to-end test for the Node 16 build.
//
// Unit tests run the sources through a bundler. This does what a user actually does: builds a
// release, packs a tarball, installs it with Node 16's own npm, and drives the installed binary on a
// real Node 16 — then checks the answers.
//
// The interesting assertion is differential. The same synthetic session fixtures are fed to both the
// installed Node 16 build (on Node 16) and the Node 20 build (on whatever Node you are running), and
// the two `status --json` reports must be byte-identical once timestamps are masked. A port that
// silently loses a source, mis-parses a number or takes a different branch cannot pass that.
//
// The run is hermetic:
//   * CODEX_TRACKER_HOME points config, state and the update cache at a temp dir, so your real
//     ~/.codex-tracker is never read or written and the run is signed out — nothing can upload;
//   * CODEX_HOME and friends point the scanner at fixtures, not your real sessions;
//   * CODEX_TRACKER_REGISTRY points the updater at a local stub, so `update --check` never hits npm;
//   * a local stub stands in for the dashboard.
//
// Child processes are spawned asynchronously on purpose: the stub servers live in this process, and
// spawnSync would block the event loop so they could never answer.
//
// Usage:
//   node scripts/e2e.mjs               # hermetic run (default)
//   node scripts/e2e.mjs --gui         # also download Electron and launch the menu bar app
//   node scripts/e2e.mjs --keep        # leave the temp dir behind for inspection
//   NODE16_BIN=/path/to/node node scripts/e2e.mjs
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstream = path.join(root, "..", "menubar");
const GUI = process.argv.includes("--gui");
const KEEP = process.argv.includes("--keep");

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------
const results = [];
let stage = "";
const setStage = (s) => {
  stage = s;
  console.log(`\n\x1b[1m── ${s}\x1b[0m`);
};
function check(name, ok, detail) {
  results.push({ stage, name, ok });
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}`);
  if (!ok && detail) console.log(String(detail).replace(/^/gm, "      "));
}
function fatal(msg) {
  console.error(`\n\x1b[31me2e: ${msg}\x1b[0m`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// locating a real Node 16
// ---------------------------------------------------------------------------
function findNode16() {
  if (process.env.NODE16_BIN) return process.env.NODE16_BIN;
  const nvm = path.join(os.homedir(), ".nvm", "versions", "node");
  if (!fs.existsSync(nvm)) return null;
  const v = fs
    .readdirSync(nvm)
    .filter((n) => /^v16\./.test(n))
    .sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]))
    .pop();
  if (!v) return null;
  const bin = path.join(nvm, v, "bin", "node");
  return fs.existsSync(bin) ? bin : null;
}

const node16 = findNode16();
if (!node16) fatal("no Node 16 found. Install one (`nvm install 16`) or set NODE16_BIN=/path/to/node.");
const npm16 = path.join(path.dirname(node16), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
if (!fs.existsSync(npm16)) fatal(`found Node 16 at ${node16} but not its npm at ${npm16}`);

const n16Version = spawnSync(node16, ["-v"], { encoding: "utf8" }).stdout.trim();
console.log(`\x1b[1me2e: codex-token-tracker-nodejs16\x1b[0m`);
console.log(`  Node 16 under test : ${node16} (${n16Version})`);
console.log(`  host Node          : ${process.execPath} (${process.version})`);

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-e2e-"));
const installDir = path.join(tmp, "install");
const fixtures = path.join(tmp, "fixtures");
const cfg16 = path.join(tmp, "config-node16");
const cfg20 = path.join(tmp, "config-node20");
for (const d of [installDir, fixtures, cfg16, cfg20]) fs.mkdirSync(d, { recursive: true });
console.log(`  scratch            : ${tmp}`);

function cleanup() {
  if (KEEP) {
    console.log(`\n(--keep) scratch left at ${tmp}`);
    return;
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// stub servers: the npm registry and the dashboard
// ---------------------------------------------------------------------------
const registryHits = [];
const dashboardHits = [];

const registry = http.createServer((req, res) => {
  registryHits.push(req.url);
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ latest: "9.9.9" }));
});
const dashboard = http.createServer((req, res) => {
  dashboardHits.push(req.url);
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/api/config")) {
    res.end(JSON.stringify({ convexUrl: "https://e2e.invalid", dashboardUrl: "http://127.0.0.1", appName: "E2E", wireVersion: 1 }));
    return;
  }
  res.end(JSON.stringify({ ok: true }));
});

await new Promise((r) => registry.listen(0, "127.0.0.1", r));
await new Promise((r) => dashboard.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${registry.address().port}`;
const dashboardUrl = `http://127.0.0.1:${dashboard.address().port}`;

// ---------------------------------------------------------------------------
// running the two builds
// ---------------------------------------------------------------------------
/** Env that isolates a run from the real machine: fixtures in, temp config out, stubs for network. */
function isolatedEnv(configHome) {
  const env = {
    ...process.env,
    CODEX_TRACKER_HOME: configHome,
    CODEX_HOME: path.join(fixtures, "codex"),
    PI_CODING_AGENT_DIR: path.join(fixtures, "pi-agent"),
    HERMES_HOME: path.join(fixtures, "hermes"),
    XDG_DATA_HOME: path.join(fixtures, "xdg-data"),
    XDG_CONFIG_HOME: path.join(fixtures, "xdg-config"),
    CODEX_TRACKER_REGISTRY: registryUrl,
  };
  return env;
}

/** Async on purpose — spawnSync would block the stub servers living in this process. */
function run(exe, args, { env, cwd, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { env, cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const done = (status, extra = "") => {
      clearTimeout(timer);
      const all = stdout + stderr + extra + (timedOut ? `\n[e2e] timed out after ${timeout}ms` : "");
      resolve({ status, stdout, stderr, all });
    };
    child.on("close", (status) => done(status));
    child.on("error", (err) => done(-1, String(err)));
  });
}

const pkgDir = path.join(installDir, "node_modules", "codex-token-tracker-nodejs16");
const installedBin = path.join(pkgDir, "bin", "codex-tracker.js");
/** The published Node 16 artifact, on Node 16. */
const run16 = (args, configHome = cfg16) => run(node16, [installedBin, ...args], { env: isolatedEnv(configHome) });
/** The Node 20 build straight out of the workspace, on the host Node. */
const run20 = (args, configHome = cfg20) =>
  run(process.execPath, [path.join(upstream, "bin", "codex-tracker.js"), ...args], { env: isolatedEnv(configHome) });

// ---------------------------------------------------------------------------
// fixtures: one Codex rollout with known token counts, dated today so it lands in "Today"
// ---------------------------------------------------------------------------
function writeFixtures() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const day = path.join(fixtures, "codex", "sessions", String(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate()));
  fs.mkdirSync(day, { recursive: true });
  // Backdated a few minutes so the session is not "live", which would depend on how long the run takes.
  const t = new Date(now.getTime() - 10 * 60 * 1000);
  const iso = (offsetMs) => new Date(t.getTime() + offsetMs).toISOString();
  const id = "01a058dc-c4fa-7972-8ff5-77ccfd3de86f";
  const lines = [
    { timestamp: iso(0), type: "session_meta", payload: { id, timestamp: iso(0), cwd: "/work/e2e-proj", originator: "codex_cli_rs", cli_version: "0.148.0", source: "cli" } },
    { timestamp: iso(1000), type: "turn_context", payload: { cwd: "/work/e2e-proj", model: "gpt-5.6-sol" } },
    {
      timestamp: iso(5000),
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 1100 },
          last_token_usage: { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 1100 },
        },
      },
    },
  ];
  fs.writeFileSync(
    path.join(day, `rollout-${iso(0).replace(/[:.]/g, "-").slice(0, 19)}-${id}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n")
  );
  for (const d of ["pi-agent/sessions", "hermes", "xdg-data", "xdg-config"]) fs.mkdirSync(path.join(fixtures, d), { recursive: true });
}

/** Put a build into a known, comparable configuration. */
async function configure(runner, configHome) {
  await runner(["config", "set", "dashboardUrl", dashboardUrl], configHome);
  await runner(["config", "set", "liveRateLimits", "false"], configHome);
  // Pinned rather than left on "auto": the language test below flips it, and the differential
  // comparison must not depend on which stage ran first.
  await runner(["config", "set", "language", "en"], configHome);
  for (const s of ["pi", "hermes", "opencode", "cline", "roo", "kilo"]) {
    await runner(["config", "set", `sources.${s}`, "false"], configHome);
  }
}

// ===========================================================================
// stages
// ===========================================================================
try {
  // -- 1. build + pack ------------------------------------------------------
  setStage("1. build and pack");
  const b16 = await run(process.execPath, [path.join(root, "scripts", "build.mjs"), "--release"], { cwd: root });
  check("node16 release build", b16.status === 0, b16.all);
  const b20 = await run(process.execPath, [path.join(upstream, "scripts", "build.mjs"), "--release"], { cwd: upstream });
  check("node20 release build (for the differential comparison)", b20.status === 0, b20.all);

  const pack = await run(process.execPath, [npm16, "pack", "--pack-destination", tmp], { cwd: root });
  check("npm pack under Node 16", pack.status === 0, pack.all);
  const tarball = fs
    .readdirSync(tmp)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => path.join(tmp, f))[0];
  check("tarball produced", Boolean(tarball), `dir listing: ${fs.readdirSync(tmp).join(", ")}`);
  if (!tarball) throw new Error("no tarball");

  // -- 2. install like a user ----------------------------------------------
  setStage("2. install with Node 16's own npm");
  fs.writeFileSync(path.join(installDir, "package.json"), JSON.stringify({ name: "e2e-install", version: "1.0.0", private: true }));
  // No --omit=optional and no ELECTRON_SKIP_BINARY_DOWNLOAD: a plain install must succeed exactly as a
  // user runs it. Electron is not an npm dependency of this package — Node 16's npm 8 aborts the whole
  // install when an optional dependency's install script fails, which is how a machine that cannot reach
  // GitHub ended up unable to install the tracker even for headless use.
  const installArgs = [npm16, "install", tarball, "--no-audit", "--no-fund", "--engine-strict"];
  const inst = await run(process.execPath, installArgs, { cwd: installDir, timeout: 900000 });
  // --engine-strict makes npm fail outright if engines.node excludes this runtime.
  check("installs on Node 16 with --engine-strict", inst.status === 0, inst.all);
  check("binary present", fs.existsSync(installedBin), installedBin);
  check("undici dependency installed", fs.existsSync(path.join(installDir, "node_modules", "undici")));
  check(
    "install pulled in no electron package (nothing that can run a download at install time)",
    !fs.existsSync(path.join(installDir, "node_modules", "electron")) && !fs.existsSync(path.join(installDir, "node_modules", "menubar")),
    fs.readdirSync(path.join(installDir, "node_modules")).join(", ")
  );

  // -- 3. the polyfill actually does HTTP on Node 16 -------------------------
  setStage("3. polyfill");
  const probe = `
    require(${JSON.stringify(path.join(pkgDir, "dist", "node16-polyfill.js"))});
    const out = { node: process.versions.node, fetch: typeof fetch };
    for (const g of ["Headers","Response","Blob","ReadableStream","crypto","structuredClone"]) out[g] = typeof globalThis[g];
    (async () => {
      const r = await fetch(${JSON.stringify(dashboardUrl + "/api/config")});
      out.status = r.status;
      out.json = await r.json();
      const r2 = await fetch(${JSON.stringify(dashboardUrl + "/api/config")});
      out.getReader = typeof r2.body.getReader;
      const rd = r2.body.getReader();
      let n = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.byteLength; }
      out.streamed = n;
    })().catch((e) => { out.error = String((e && e.message) || e); })
      .then(() => console.log("E2E_PROBE " + JSON.stringify(out)));
  `;
  const pr = await run(node16, ["-e", probe], { env: isolatedEnv(cfg16) });
  let probeOut = {};
  const probeLine = pr.stdout.split("\n").find((l) => l.startsWith("E2E_PROBE "));
  if (probeLine) {
    try {
      probeOut = JSON.parse(probeLine.slice("E2E_PROBE ".length));
    } catch {
      /* reported below */
    }
  }
  check("polyfill loads on Node 16", probeOut.node === n16Version.replace(/^v/, ""), pr.all.slice(0, 800));
  check("global fetch installed", probeOut.fetch === "function", JSON.stringify(probeOut));
  check("fetch performs a real HTTP request", probeOut.status === 200 && probeOut.json?.appName === "E2E", JSON.stringify(probeOut));
  check("response body streams via getReader()", probeOut.getReader === "function" && probeOut.streamed > 0, JSON.stringify(probeOut));
  check(
    "companion globals present (Headers/Response/Blob/ReadableStream/crypto/structuredClone)",
    ["Headers", "Response", "Blob", "ReadableStream", "crypto", "structuredClone"].every((g) => probeOut[g] === "function" || probeOut[g] === "object"),
    JSON.stringify(probeOut)
  );

  // -- 4. the differential check (before anything mutates config) -----------
  setStage("4. differential: node16 build vs node20 build, identical fixtures");
  writeFixtures();
  await configure(run16, cfg16);
  await configure(run20, cfg20);
  const j16 = await run16(["status", "--json"]);
  const j20 = await run20(["status", "--json"]);
  check("node16 build produced a report", j16.status === 0 && j16.stdout.trim().startsWith("{"), j16.all.slice(0, 500));
  check("node20 build produced a report", j20.status === 0 && j20.stdout.trim().startsWith("{"), j20.all.slice(0, 500));

  // Mask what legitimately differs between two runs seconds apart.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mask = (s) =>
    s
      .replace(/\d{13}/g, "<TS>")
      .replace(new RegExp(esc(cfg16), "g"), "<CONFIG>")
      .replace(new RegExp(esc(cfg20), "g"), "<CONFIG>");
  const m16 = mask(j16.stdout);
  const m20 = mask(j20.stdout);
  if (m16 === m20) {
    check(`reports are byte-identical (${m16.length} chars)`, true);
  } else {
    const a = m20.split("\n");
    const b = m16.split("\n");
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 20; i++) {
      if (a[i] !== b[i]) diff.push(`  line ${i + 1}:\n    node20: ${a[i]}\n    node16: ${b[i]}`);
    }
    check("reports are byte-identical", false, diff.join("\n"));
  }

  // Absolute assertions too, so a mutually-broken pair cannot pass by agreeing with each other.
  let parsed = null;
  try {
    parsed = JSON.parse(j16.stdout);
  } catch {
    /* handled by the checks below */
  }
  check("fixture tokens landed in today's totals (1100)", parsed?.today?.usage?.total === 1100, JSON.stringify(parsed?.today?.usage));
  check("cached input attributed (500)", parsed?.today?.usage?.cached === 500, JSON.stringify(parsed?.today?.usage));
  check("output + reasoning attributed (100 / 20)", parsed?.today?.usage?.output === 100 && parsed?.today?.usage?.reasoning === 20, JSON.stringify(parsed?.today?.usage));
  check("model attributed to gpt-5.6-sol", JSON.stringify(parsed?.modelsToday ?? []).includes("gpt-5.6-sol"), JSON.stringify(parsed?.modelsToday));
  check("a dollar cost was computed", typeof parsed?.today?.cost === "number" && parsed.today.cost > 0, JSON.stringify(parsed?.today?.cost));
  check("only the codex source is active", JSON.stringify(parsed?.byAgentToday ?? []).includes("codex"), JSON.stringify(parsed?.byAgentToday));
  check("run stayed signed out (nothing could upload)", parsed?.auth?.status === "signedOut", JSON.stringify(parsed?.auth));

  // -- 5. the CLI surface ---------------------------------------------------
  setStage("5. CLI commands on Node 16");
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const v = await run16(["--version"]);
  check(`--version reports ${pkgVersion}`, v.status === 0 && v.stdout.includes(pkgVersion), v.all);

  const h = await run16(["help"]);
  check("help lists the commands", h.status === 0 && /menubar/.test(h.stdout) && /agent/.test(h.stdout), h.all);

  const p = await run16(["paths"]);
  check("paths finds the fixture Codex dir", p.status === 0 && p.stdout.includes(path.join(fixtures, "codex", "sessions")), p.all);

  const st = await run16(["status"]);
  check("status renders the fixture session", st.status === 0 && /1\.1k|1,100|1100/.test(st.stdout), st.all);

  const cg = await run16(["config", "get"]);
  check("config get reads back the dashboard we set", cg.status === 0 && cg.stdout.includes(dashboardUrl), cg.all);

  await run16(["lang", "zh"]);
  const zhStatus = await run16(["status"]);
  check("lang zh switches the output language", /[一-龥]/.test(zhStatus.stdout), zhStatus.stdout.slice(0, 300));
  await run16(["lang", "en"]);

  const logout = await run16(["logout"]);
  check("logout succeeds", logout.status === 0, logout.all);

  // -- 6. self-update identity ---------------------------------------------
  setStage("6. self-update targets the right package");
  registryHits.length = 0;
  const upd = await run16(["update", "--check"]);
  check("update --check succeeds against the stub registry", upd.status === 0, upd.all);
  check(
    "queried codex-token-tracker-nodejs16, not codex-token-tracker",
    registryHits.some((u) => u.includes("/codex-token-tracker-nodejs16/")) && !registryHits.some((u) => /\/codex-token-tracker\//.test(u)),
    `registry hits: ${registryHits.join(", ") || "(none)"}`
  );
  // The install command is pinned to @latest by design, so assert on the package name and the
  // version transition rather than on a pinned spec.
  check(
    "reports 0.2.1 → 9.9.9 and installs codex-token-tracker-nodejs16",
    /9\.9\.9/.test(upd.stdout) && /codex-token-tracker-nodejs16@/.test(upd.stdout) && !/codex-token-tracker@/.test(upd.stdout),
    upd.all
  );
  const cacheFile = path.join(cfg16, "update-codex-token-tracker-nodejs16.json");
  check("update cache is namespaced per package", fs.existsSync(cacheFile), `expected ${cacheFile}; dir has ${fs.readdirSync(cfg16).join(", ")}`);

  // -- 7. headless agent ----------------------------------------------------
  setStage("7. headless agent");
  const ag = await run16(["agent", "--once"]);
  check("agent --once completes a cycle", ag.status === 0, ag.all.slice(0, 400));
  check("the cycle saw the fixture session", /1 session|sessions/.test(ag.all), ag.all.slice(0, 400));

  // -- 8. optional GUI ------------------------------------------------------
  setStage("8. menu bar app (Electron)");
  if (GUI) {
    const ens = await run16(["menubar", "--background"], cfg16);
    check("menubar --background starts (downloads Electron on first run)", ens.status === 0, ens.all.slice(-1500));
    const managed = path.join(cfg16, "electron");
    check("Electron runtime landed in the tracker's own config dir", fs.existsSync(managed), managed);
    await new Promise((r) => setTimeout(r, 8000));
    const ps = spawnSync("pgrep", ["-fl", "Electron"], { encoding: "utf8" });
    const running = /Electron/.test(ps.stdout ?? "");
    check("an Electron process is running", running, ps.stdout);
    spawnSync("pkill", ["-f", "codex-token-tracker-nodejs16"]);
  } else {
    console.log("  skipped — pass --gui to download Electron (~100 MB) and launch the tray app");
  }
} catch (err) {
  console.error(`\n\x1b[31me2e crashed during "${stage}": ${err && err.stack ? err.stack : err}\x1b[0m`);
  results.push({ stage, name: "stage crashed", ok: false });
} finally {
  registry.close();
  dashboard.close();
  // Leave the workspace as we found it: `pnpm build` semantics are a dev build.
  await run(process.execPath, [path.join(root, "scripts", "build.mjs")], { cwd: root });
  await run(process.execPath, [path.join(upstream, "scripts", "build.mjs")], { cwd: upstream });
  cleanup();
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n\x1b[1m── summary\x1b[0m`);
console.log(`  ${results.length - failed.length}/${results.length} checks passed on Node ${n16Version}`);
if (failed.length) {
  for (const f of failed) console.log(`  \x1b[31m✗\x1b[0m ${f.stage} → ${f.name}`);
  process.exit(1);
}
console.log("  \x1b[32me2e passed\x1b[0m");
