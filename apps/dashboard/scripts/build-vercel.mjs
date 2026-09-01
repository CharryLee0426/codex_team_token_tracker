// Vercel build entry (see vercel.json → `pnpm build:vercel`).
//
// Production: CONVEX_DEPLOY_KEY is set → `convex deploy` pushes the functions in
// packages/backend/convex to that deployment, then runs `next build` with
// NEXT_PUBLIC_CONVEX_URL injected.
// Preview / branches: no deploy key → plain `next build` against the
// NEXT_PUBLIC_CONVEX_URL configured for that environment (normally the dev deployment).
import { spawnSync } from "node:child_process";

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (process.env.CONVEX_DEPLOY_KEY) {
  run("convex", ["deploy", "--cmd", "next build", "--cmd-url-env-var-name", "NEXT_PUBLIC_CONVEX_URL"]);
} else if (process.env.NEXT_PUBLIC_CONVEX_URL) {
  console.log(`[build:vercel] CONVEX_DEPLOY_KEY not set – building against ${process.env.NEXT_PUBLIC_CONVEX_URL} without deploying Convex functions.`);
  run("next", ["build"]);
} else {
  console.error("[build:vercel] Set CONVEX_DEPLOY_KEY (production) or NEXT_PUBLIC_CONVEX_URL (preview builds).");
  process.exit(1);
}
