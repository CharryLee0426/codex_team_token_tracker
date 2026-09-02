// Bundles src/**/__tests__/*.test.ts with esbuild (so extensionless TS imports resolve) and runs `node --test`.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, "dist-test");
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
const entries = globSync("src/**/__tests__/*.test.ts", { cwd: root }).map((p) => path.join(root, p));
if (!entries.length) {
  console.log("no tests");
  process.exit(0);
}
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
await build({
  entryPoints: entries,
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: "inline",
  external: ["electron", "menubar", "node:*"],
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __NPM_PACKAGE__: JSON.stringify(pkg.name) },
  logLevel: "warning",
});
const built = globSync("**/*.js", { cwd: outdir }).map((p) => path.join(outdir, p));
const r = spawnSync(process.execPath, ["--test", ...built], { stdio: "inherit" });
process.exit(r.status ?? 1);
