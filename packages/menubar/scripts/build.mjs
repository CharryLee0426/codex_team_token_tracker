// esbuild pipeline: CLI + Electron main/preload (node, cjs) and the popover renderer (browser, iife).
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const watch = process.argv.includes("--watch");
// Only an explicit --release (what `prepack` runs) produces a production build; everything else —
// `pnpm build`, `pnpm dev`, watch mode — is a dev build pointed at the local dashboard.
const channel = process.argv.includes("--release") ? "prod" : "dev";
const src = (p) => path.join(root, "src", p);
const out = (p) => path.join(root, "dist", p);

// The Electron release the CLI downloads itself when no `electron` npm package is around. Taken from
// codex-token-tracker's devDependency range so the self-managed runtime tracks the one developers run.
const electronVersion = String(pkg.devDependencies?.electron ?? pkg.optionalDependencies?.electron ?? "").replace(/^[^\d]*/, "");
if (!electronVersion) throw new Error("[build] cannot determine the Electron version to stamp into __ELECTRON_VERSION__");
const define = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __APP_CHANNEL__: JSON.stringify(channel),
  __NPM_PACKAGE__: JSON.stringify(pkg.name),
  __ELECTRON_VERSION__: JSON.stringify(electronVersion),
};
const common = { bundle: true, sourcemap: false, logLevel: "info", legalComments: "none", define };

// `menubar` is bundled rather than depended on: it declares a hard peer dependency on `electron`, which npm ≥ 7
// would otherwise auto-install (and run the install script of) on every user's machine. `electron` itself is
// only ever resolved at runtime — inside Electron it is the built-in module, under plain Node the CLI
// resolves it (or downloads a runtime) itself.
const nodeCommon = { ...common, platform: "node", format: "cjs", target: "node20", external: ["electron"] };
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
    target: "chrome128",
    jsx: "automatic",
    define: { ...define, "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  },
];

function copyStatic() {
  fs.mkdirSync(out("renderer"), { recursive: true });
  for (const f of ["index.html", "styles.css"]) fs.copyFileSync(src(`renderer/${f}`), out(`renderer/${f}`));
}

fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
copyStatic();

if (watch) {
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  fs.watch(src("renderer"), { persistent: true }, (_e, file) => {
    if (file && /\.(html|css)$/.test(file)) copyStatic();
  });
  console.log(`[build] watching… (${channel} build)`);
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  console.log(`[build] codex-token-tracker v${pkg.version} (${channel}) built → dist/`);
}
