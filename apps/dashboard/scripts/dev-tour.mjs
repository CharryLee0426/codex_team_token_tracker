// `pnpm dev:tour` — the dev server with the guided tour forced open on every dashboard load, for
// working on the tour itself (`NEXT_PUBLIC_ONBOARDING_TOUR=force`). A script rather than an inline
// `VAR=… next dev` so it behaves the same in PowerShell. Extra arguments go to `next dev`.
import { spawnSync } from "node:child_process";

const res = spawnSync("next", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NEXT_PUBLIC_ONBOARDING_TOUR: "force" },
});
if (res.error) throw res.error;
process.exit(res.status ?? 1);
