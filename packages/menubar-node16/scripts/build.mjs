// esbuild pipeline for the Node 16 build.
//
// This package deliberately owns no application source: it bundles ../menubar/src, the exact same
// tree the Node 20 package ships, so the two can never drift in features. The differences are all
// in this file:
//
//   1. `target: node16` — esbuild downlevels any syntax Node 16 cannot parse.
//   2. a `banner` that requires dist/node16-polyfill.js first, installing `fetch` and the other
//      web globals Node 16 lacks before any bundled module body runs.
//   3. `__NPM_PACKAGE__` is stamped to this package's name, so the in-app self-updater upgrades
//      codex-token-tracker-nodejs16 rather than pulling in the Node 20 package.
//   4. a lower renderer target, so an older Electron (on an older OS) can still render the popover.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncVersion } from "./sync-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstream = path.join(root, "..", "menubar");

if (!fs.existsSync(path.join(upstream, "src", "cli.ts"))) {
  console.error(`[build] cannot find the shared source at ${path.join(upstream, "src")}.`);
  console.error("[build] codex-token-tracker-nodejs16 builds from the codex-token-tracker sources and must be built inside the monorepo.");
  process.exit(1);
}

syncVersion();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const upstreamPkg = JSON.parse(fs.readFileSync(path.join(upstream, "package.json"), "utf8"));
const watch = process.argv.includes("--watch");
// Mirrors the upstream rule: only an explicit --release (what `prepack` runs) is a production build;
// `pnpm build`, `pnpm dev` and watch mode stay pointed at the local dashboard.
const channel = process.argv.includes("--release") ? "prod" : "dev";

const src = (p) => path.join(upstream, "src", p);
const out = (p) => path.join(root, "dist", p);

// The Electron release the CLI downloads itself when no `electron` npm package is around. Taken from
// codex-token-tracker's devDependency range so the self-managed runtime tracks the one developers run.
const electronVersion = String(upstreamPkg.devDependencies?.electron ?? upstreamPkg.optionalDependencies?.electron ?? "").replace(/^[^\d]*/, "");
if (!electronVersion) throw new Error("[build] cannot determine the Electron version to stamp into __ELECTRON_VERSION__");
const define = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __APP_CHANNEL__: JSON.stringify(channel),
  __NPM_PACKAGE__: JSON.stringify(pkg.name),
  __ELECTRON_VERSION__: JSON.stringify(electronVersion),
};
const common = { bundle: true, sourcemap: false, logLevel: "info", legalComments: "none", define };

// Runs before any bundled module body — see src/node16-polyfill.cjs for why that ordering matters.
const banner = { js: 'require("./node16-polyfill.js");' };

const nodeCommon = {
  ...common,
  platform: "node",
  format: "cjs",
  target: "node16",
  // `menubar` is bundled (it has a hard peer dependency on `electron`, which npm ≥ 7 would auto-install and
  // run the install script of); `electron` is resolved at runtime; `undici` must stay a real require.
  external: ["electron", "undici"],
  banner,
};

const configs = [
  { ...nodeCommon, entryPoints: [src("cli.ts")], outfile: out("cli.js") },
  { ...nodeCommon, entryPoints: [src("main.ts")], outfile: out("main.js") },
  { ...nodeCommon, entryPoints: [src("preload.ts")], outfile: out("preload.js") },
  {
    ...common,
    entryPoints: [src("renderer/index.tsx")],
    outfile: out("renderer/renderer.js"),
    platform: "browser",
    format: "iife",
    // Electron 22 (the last release supporting older Windows and glibc) ships Chromium 108. Targeting
    // it costs nothing on a current Electron and keeps the popover working on an old one.
    target: "chrome108",
    jsx: "automatic",
    define: { ...define, "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  },
];

function copyStatic() {
  fs.mkdirSync(out("renderer"), { recursive: true });
  for (const f of ["index.html", "styles.css"]) fs.copyFileSync(src(`renderer/${f}`), out(`renderer/${f}`));
  // Hand-written CommonJS, copied rather than bundled: it must stay readable for anyone debugging a
  // Node 16 install, and `undici` has to remain a real runtime require (it loads a WASM HTTP parser).
  fs.copyFileSync(path.join(root, "src", "node16-polyfill.cjs"), out("node16-polyfill.js"));
}

/** Tray/app icons live in the upstream package; the published tarball needs its own copy. */
function copyAssets() {
  const from = path.join(upstream, "assets");
  const to = path.join(root, "assets");
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f));
}

fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
copyStatic();
copyAssets();

if (watch) {
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  fs.watch(src("renderer"), { persistent: true }, (_e, file) => {
    if (file && /\.(html|css)$/.test(file)) copyStatic();
  });
  console.log(`[build] watching ../menubar/src… (${channel} build, target node16)`);
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  console.log(`[build] ${pkg.name} v${pkg.version} (${channel}, target node16) built → dist/`);
}
