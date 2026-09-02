// Runs the upstream test suites against the Node 16 build.
//
// Two things differ from ../menubar/scripts/test.mjs:
//   * the bundle is produced at target=node16 with the polyfill banner, i.e. the artifact this
//     package actually publishes, not a node20 one;
//   * `node:test` is redirected to scripts/node-test-shim.cjs, because Node 16 has no test runner.
//
// By default it runs on whatever Node invoked it. Pass --node16 (or set NODE16_BIN) to execute the
// suites on a real Node 16 binary, which is the run that actually proves the port.
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstream = path.join(root, "..", "menubar");
const outdir = path.join(root, "dist-test");

/** Recursive walk instead of fs.globSync, which only exists on Node 22+. */
function findTests(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findTests(p, acc);
    else if (/\.test\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Newest locally installed Node 16, for --node16. */
function findNode16() {
  if (process.env.NODE16_BIN) return process.env.NODE16_BIN;
  const nvm = path.join(os.homedir(), ".nvm", "versions", "node");
  if (!fs.existsSync(nvm)) return null;
  const versions = fs
    .readdirSync(nvm)
    .filter((v) => /^v16\./.test(v))
    .sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]));
  const newest = versions[versions.length - 1];
  if (!newest) return null;
  const bin = path.join(nvm, newest, "bin", "node");
  return fs.existsSync(bin) ? bin : null;
}

const entries = findTests(path.join(upstream, "src"));
if (!entries.length) {
  console.log("no tests");
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });
const polyfill = path.join(outdir, "node16-polyfill.js");
fs.copyFileSync(path.join(root, "src", "node16-polyfill.cjs"), polyfill);

/** Redirect `node:test` to the Node 16 shim; leave every other builtin alone. */
const nodeTestShim = {
  name: "node-test-shim",
  setup(build) {
    build.onResolve({ filter: /^node:test$/ }, () => ({ path: path.join(root, "scripts", "node-test-shim.cjs") }));
  },
};

await esbuild.build({
  entryPoints: entries,
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node16",
  sourcemap: "inline",
  external: ["electron", "menubar", "undici", "node:*"],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_CHANNEL__: JSON.stringify("prod"),
    __NPM_PACKAGE__: JSON.stringify(pkg.name),
  },
  // Absolute, unlike the published build's relative banner: suites are emitted into nested
  // directories mirroring their source paths, so they are not all siblings of the polyfill.
  banner: { js: `require(${JSON.stringify(polyfill)});` },
  plugins: [nodeTestShim],
  logLevel: "warning",
});

const built = [];
(function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (e.name.endsWith(".js") && e.name !== "node16-polyfill.js") built.push(p);
  }
})(outdir);

let exe = process.execPath;
if (process.argv.includes("--node16")) {
  const n16 = findNode16();
  if (!n16) {
    console.error("--node16: no Node 16 found. Install one (`nvm install 16`) or set NODE16_BIN=/path/to/node.");
    process.exit(1);
  }
  exe = n16;
}
const version = spawnSync(exe, ["-v"], { encoding: "utf8" }).stdout.trim();
console.log(`[test] ${pkg.name} v${pkg.version} — ${built.length} suite(s) on ${exe} (${version})\n`);

let failed = 0;
for (const file of built) {
  console.log(`--- ${path.relative(outdir, file)} ---`);
  const r = spawnSync(exe, [file], { stdio: "inherit" });
  if (r.status !== 0) failed++;
  console.log("");
}
if (failed) {
  console.error(`[test] ${failed} suite(s) failed`);
  process.exit(1);
}
console.log("[test] all suites passed");
