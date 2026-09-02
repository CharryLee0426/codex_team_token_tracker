// Keeps codex-token-tracker-nodejs16's version identical to codex-token-tracker's.
//
// The two packages are the same application built for two Node baselines, so a user comparing
// `codex-tracker --version` across machines should see the same number. `build.mjs` calls this on
// every build, and `prepack` runs the build — so a publish can never go out with a stale version.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstreamPkgPath = path.join(here, "..", "menubar", "package.json");
const ownPkgPath = path.join(here, "package.json");

export function syncVersion({ quiet = false } = {}) {
  const upstream = JSON.parse(fs.readFileSync(upstreamPkgPath, "utf8"));
  const raw = fs.readFileSync(ownPkgPath, "utf8");
  const own = JSON.parse(raw);
  if (own.version === upstream.version) return upstream.version;
  // Rewrite just the version line so the file's formatting and key order survive untouched.
  const next = raw.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1${JSON.stringify(upstream.version)}`);
  if (JSON.parse(next).version !== upstream.version) {
    throw new Error(`sync-version: could not rewrite the version field in ${ownPkgPath}`);
  }
  fs.writeFileSync(ownPkgPath, next);
  if (!quiet) console.log(`[sync-version] ${own.version} → ${upstream.version} (matching codex-token-tracker)`);
  return upstream.version;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(syncVersion());
}
