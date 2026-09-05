# Codex Token Tracker — Admin Deployment Guide

*中文版：[ADMIN_DEPLOY.zh-CN.md](./ADMIN_DEPLOY.zh-CN.md)*

Production topology:

```
GitHub (main) ──push──▶ Vercel  ──builds──▶ Next.js dashboard  https://codex.chenli.dev
                          │  `convex deploy --cmd 'next build'`
                          └──deploys──▶ Convex production deployment (realtime DB + functions)
Clerk production instance (Google/GitHub login, Organizations, JWT template "convex", webhook → Convex)
npm: codex-token-tracker (menu bar app; default dashboard = https://codex.chenli.dev)
```

Do the sections in order; each one needs values from the previous one.

## 0. Prerequisites

- Accounts: GitHub (repo `CharryLee0426/codex_team_token_tracker`), Vercel, Convex, Clerk, npm; DNS control of `chenli.dev`.
- Local: Node ≥ 20, pnpm 11 (`corepack enable`), the Clerk CLI (`npm i -g clerk`), Convex CLI (`npx convex`).
- The repo already contains everything: Convex functions in `packages/backend/convex`, dashboard in `apps/dashboard` (`vercel.json` sets the build command), menubar in `packages/menubar`.

## 1. Convex — production deployment

Current state: project **codex-token-tracker**, dev deployment `majestic-lynx-360`, production deployment **`grandiose-seal-712`** → API `https://grandiose-seal-712.convex.cloud`, HTTP/webhook host `https://grandiose-seal-712.convex.site` (`/health` returns `{"ok":true}`).

1. **Deploy key** for Vercel (already created as `vercel-production`; recreate if rotated):
   ```bash
   cd apps/dashboard
   npx convex deployment token create vercel-production --deployment prod   # prints prod:… → CONVEX_DEPLOY_KEY on Vercel
   ```
   (or Convex dashboard → Settings → Deploy keys → *Generate production deploy key*).
2. **Environment variables** on the production deployment (`CLERK_JWT_ISSUER_DOMAIN` is set; the webhook secret is optional, see 3.6):
   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.codex.chenli.dev --prod
   npx convex env set CLERK_WEBHOOK_SECRET whsec_xxx --prod
   npx convex env list --prod --names-only
   ```
3. **Manual deploy** (Vercel does this on every build, so this is only for emergencies): `CONVEX_DEPLOY_KEY=prod:… npx convex deploy --yes`.

## 2. Vercel — dashboard

Current state: project **`codex-token-tracker`** in team *CharryLee's projects*, linked to GitHub `CharryLee0426/codex_team_token_tracker` (production branch `main`), Root Directory `apps/dashboard`, *Include source files outside of the Root Directory* on, Node 24, domain `codex.chenli.dev` attached.

1. If recreating: **Add New Project → Import** the repo, Root Directory `apps/dashboard`, keep *Include source files outside of the Root Directory* (pnpm workspace). Framework Next.js; the build command comes from `apps/dashboard/vercel.json` → `pnpm build:vercel` (`scripts/build-vercel.mjs`: with `CONVEX_DEPLOY_KEY` it runs `convex deploy --cmd 'next build'`, without it a plain `next build`).
2. **Environment variables** (all set):

   | Name | Production | Preview / Development |
   |---|---|---|
   | `CONVEX_DEPLOY_KEY` | prod deploy key (section 1) | — (previews do not touch production) |
   | `NEXT_PUBLIC_CONVEX_URL` | *not set* — injected by `convex deploy` | `https://majestic-lynx-360.convex.cloud` (dev) |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | `pk_live_…` / `sk_live_…` | `pk_test_…` / `sk_test_…` (dev instance) |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `…_SIGN_UP_URL` | `/sign-in` / `/sign-up` | same |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` / `…_SIGN_UP_…` | `/dashboard` | same |
   | `NEXT_PUBLIC_APP_URL` | `https://codex.chenli.dev` | — |
   | `NEXT_PUBLIC_TEAM_PLAN_START` | optional — when the team's Codex plan began, for the **Since team plan starts** range (ISO 8601 with offset; default `2026-08-25T00:00:00-07:00`) | same |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` — Vercel honours `packageManager: pnpm@11` | same |
   | `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` — skips the Electron download during install | same |

   CLI equivalent: `vercel env add NAME production --value '…'` (Clerk keys come from `clerk env pull --instance prod --file <tmp>`).
3. **Domain**: `codex.chenli.dev` is attached to the project. In Cloudflare (DNS for `chenli.dev`) add **`CNAME codex → f5cb3d497ca8d963.vercel-dns-017.com`** (Vercel's recommended target for this domain; `cname.vercel-dns.com` also works), **Proxy status = DNS only** (grey cloud). Vercel issues the certificate automatically once the record resolves.
4. **Deploy**: every push to `main` builds and deploys; `vercel --prod` from the repo root does the same from a machine that ran `vercel login`.
5. Verify: `https://codex.chenli.dev/api/config` returns `{ "convexUrl": "https://grandiose-seal-712.convex.cloud", "dashboardUrl": "https://codex.chenli.dev", … }`.

## 3. Clerk — production instance

Development keys (`pk_test_`) cannot be used in production. The production instance was created with the Clerk CLI (`cd apps/dashboard && clerk deploy`), which clones the development settings (Organizations, JWT template `convex`) into a new instance on the domain **`codex.chenli.dev`**:

| Purpose | Host |
|---|---|
| Frontend API / **JWT issuer** | `https://clerk.codex.chenli.dev` |
| Account portal | `https://accounts.codex.chenli.dev` |
| E-mail | `clkmail.codex.chenli.dev` + DKIM |

1. **DNS** (Cloudflare, zone `chenli.dev`, all **DNS only** — proxied records fail verification):

   | Type | Name | Target |
   |---|---|---|
   | CNAME | `clerk.codex` | `frontend-api.clerk.services` |
   | CNAME | `accounts.codex` | `accounts.clerk.services` |
   | CNAME | `clkmail.codex` | `mail.waptkkq0u2cr.clerk.services` |
   | CNAME | `clk._domainkey.codex` | `dkim1.waptkkq0u2cr.clerk.services` |
   | CNAME | `clk2._domainkey.codex` | `dkim2.waptkkq0u2cr.clerk.services` |

   `clerk deploy` can export these as a BIND zone file (Cloudflare → DNS → *Import and Export*). Check status with `clerk deploy status --wait` or Clerk Dashboard → Domains.
2. **Social connections — production needs your own OAuth apps** (the shared dev credentials are refused). Create both, then run `clerk deploy` again and paste the client id/secret when asked (or Clerk Dashboard → *User & Authentication → Social connections → provider → Use custom credentials*):
   - **GitHub**: github.com → *Settings → Developer settings → OAuth Apps → New OAuth App*. Homepage `https://codex.chenli.dev`, Authorization callback URL **`https://clerk.codex.chenli.dev/v1/oauth_callback`**. Generate a client secret.
   - **Google**: Google Cloud Console → *APIs & Services → OAuth consent screen* (External, add the app name/support e-mail; publish it so any Google account can sign in) → *Credentials → Create credentials → OAuth client ID → Web application*. Authorized JavaScript origins `https://codex.chenli.dev`; Authorized redirect URI **`https://clerk.codex.chenli.dev/v1/oauth_callback`**.
3. **Organizations**: enabled (cloned from dev). Free Clerk plans cap an organization at 5 members — raise the limit in Clerk → *Organizations → Settings* (paid plan) if the team is larger. Optional: *verified domains* so `@yourcompany` e-mails auto-join.

   **Invite links.** Clerk's own invitations are bound to one e-mail address, so the dashboard adds reusable links on top: *Members → Invite links* (admins only) mints `https://codex.chenli.dev/j/<code>` with an expiry of 1/3/5/7 days and an optional seat limit. The invite ledger lives in Convex (`orgInvites`); redeeming one calls the Clerk Backend API with `CLERK_SECRET_KEY` from the Next.js server, so that key must be set in Vercel for `/api/join` to work. Revoking a link in the panel kills it immediately. Links inherit the origin they were copied from — `localhost:3000` in development, `codex.chenli.dev` in production.
4. **API keys**: `pk_live_…` / `sk_live_…` are already in Vercel's Production environment (`clerk env pull --instance prod --file <tmp>` shows them again). Redeploy after changing them.
5. **JWT template** `convex` exists on production (cloned); claims must match `docs/clerk-jwt-template.json`. Check: `clerk api /jwt_templates --instance prod`. The issuer `https://clerk.codex.chenli.dev` is already set on Convex production (section 1.2).
6. **Webhook** (optional — keeps the roster in sync for members who never open the dashboard): Clerk Dashboard → *Webhooks → Add endpoint* → `https://grandiose-seal-712.convex.site/clerk-webhook`, events `user.*`, `organization.*`, `organizationMembership.*` → copy the signing secret → `npx convex env set CLERK_WEBHOOK_SECRET whsec_… --prod`. Webhooks maintain roster freshness; they are not the sole authorization gate. Team reads require both the mirrored membership and a matching Clerk-signed active `org_id`, which bounds access after removal by the JWT lifetime even if a deletion webhook is delayed or missed.
7. **Finish**: once DNS resolves and the OAuth apps are entered, `clerk deploy status` reports `complete: true`; the Clerk Dashboard shows the SSL certificate for `clerk.codex.chenli.dev` as issued. Sign-in at `https://codex.chenli.dev/sign-in` then works.

## 4. Post-deploy checklist

1. Open https://codex.chenli.dev → sign in with Google/GitHub → **Create organization** (this is the team) → invite members (they can also self-serve via the organization switcher).
2. On your machine: `npx codex-token-tracker login` → approve → `npx codex-token-tracker agent --once` → data appears on **Personal**, then **Team**. Signing in for the first time also runs the dashboard's guided tour (skip it, or replay it from **Settings**).
3. Convex dashboard → Production → Data: `users`, `orgs`, `memberships`, `devices`, `hourlyUsage`, `sessions` fill up. Logs show any `ConvexError`.
4. Clerk → Webhooks → check deliveries return 200.

## 5. Publishing the menu bar tool to npm

The package name is `codex-token-tracker`. The dashboard baked into a **published** build is
`https://codex.chenli.dev` (changeable per user with `--dashboard`); a **local** build points at
`http://localhost:3000` instead — see *Build channels* below.

```bash
npm login                                  # once, on the publishing machine (npm account with 2FA recommended)
pnpm --filter codex-token-tracker version patch   # or minor / major
pnpm release:menubar                       # = pnpm --filter codex-token-tracker publish --access public
git push origin main --tags
```

`pnpm release:menubar` runs `prepublishOnly` (typecheck) and then `prepack`, which rebuilds `dist/`
with `--release`. That stamp is what makes the published bundle point at production, so **never publish
a hand-built `dist/`** — always let the lifecycle scripts do it. `postpack` puts the dev build back
afterwards, so the working copy keeps pointing at localhost.

### Build channels

`packages/menubar/scripts/build.mjs` stamps `__APP_CHANNEL__` at bundle time: `--release` → `prod`,
anything else → `dev`. The channel decides:

| | dev build (`pnpm build`, `pnpm dev`) | published build (`prepack` → npm) |
| --- | --- | --- |
| Dashboard default | `http://localhost:3000` | `https://codex.chenli.dev` |
| Convex deployment | the dev one, via the local dashboard's `/api/config` | production |
| Config / device token / upload state | `~/.codex-tracker-dev` | `~/.codex-tracker` |
| Self-update | disabled; `update` refuses | enabled |
| App name, LaunchAgent | `Codex Tracker (dev)`, `…menubar.dev` | `Codex Tracker`, `…menubar` |

So a developer testing locally uploads to the dev deployment with a dev device token, and can run that
build **at the same time** as their installed production copy. The popover marks a dev build with an
orange **DEV** badge.

Users who run the tool with `npx codex-token-tracker` (the documented way) get the new version automatically the next time it starts; global installs upgrade with `codex-tracker update` or `npm i -g codex-token-tracker@latest`. Electron is downloaded on first launch, never during install, so headless/WSL installs succeed even if its binary download is blocked.

## 6. Operations

- **Updating the dashboard/backend**: push to `main` → Vercel builds → `convex deploy` pushes functions and schema to production in the same build. Schema changes are validated against existing data; keep new fields optional (as done for `agent`, and for `machineId` / `mergedInto` on `devices` in 0.3.0).
- **Deploy the dashboard/backend before publishing a tracker that needs it.** The tracker reads `wireVersion` from `/api/config` and only sends newer fields to a backend that advertises them (0.3.0 sends `machineId`, wire version 2). Session identity is also enforced server-side: deploy the `(device, agent, sessionId)` upsert logic before clients with the expanded agent set, or two agents that reuse a session id can overwrite one another until the backend catches up.
- **Preview deployments** (any non-`main` branch / PR): `CONVEX_DEPLOY_KEY` is only set for Production, so previews run a plain `next build` against the **dev** Convex deployment and the **dev** Clerk instance (Preview env vars) — a safe staging environment that never touches production data.
- **One-time cleanup after older `trackAllProviders` use:** previous clients could upload API-key OpenAI rows. The current client will never upload them, but the v2 upsert protocol cannot infer that an absent local row should be deleted. Back up the deployment, delete that device's `hourlyUsage` and `sessions` rows in the Convex dashboard (whole-device cleanup is safest), then run `codex-tracker sync` on that device. Revoking a device does not delete its usage.
- **Pricing table**: `packages/shared/src/pricing.ts` (USD per 1M tokens), mirroring <https://developers.openai.com/api/docs/pricing>, including cache-write rates and the long-context tiers billed above 272K input tokens. Unknown models fall back to their family and are flagged *est.*; users can override locally in `~/.codex-tracker/pricing.json`. Only OpenAI models with exact Codex-OAuth attribution are counted — API-key and non-OpenAI usage is dropped on the device.
- **Revoking a device**: the user does it in Dashboard → Devices; admins can set `revokedAt` on the `devices` row in the Convex dashboard.
- **Removing a member**: remove them from the Clerk organization; the webhook deletes the membership and the team view stops including them (their rows stay attached to their user).
- **Backups / export**: Convex dashboard → Settings → Export, or `npx convex export --prod`.
- **Rotating secrets**: regenerate the Convex deploy key or Clerk keys and update Vercel → redeploy; changing the webhook secret needs the Convex env var updated.
- **Local development** stays on the dev deployment: `cd apps/dashboard && npx convex dev` + `pnpm dev`, then `pnpm --filter codex-token-tracker build` and `node packages/menubar/bin/codex-tracker.js login` — a local build already defaults to `http://localhost:3000` and its own `~/.codex-tracker-dev`, so no `--dashboard` flag and no risk to production data.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Vercel build: `Unknown option allowBuilds` or lockfile errors | pnpm < 10 used; set `ENABLE_EXPERIMENTAL_COREPACK=1` |
| Build hangs downloading Electron | set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` |
| Dashboard banner about `org_id` claim | JWT template not named `convex` or missing the org claims (section 3.5) |
| `Unauthenticated` in Convex logs | `CLERK_JWT_ISSUER_DOMAIN` wrong/missing on production, or set after the last deploy — redeploy once |
| Sign-in loops / cookies / `clerk.codex.chenli.dev` unreachable | Clerk DNS records missing, proxied (orange cloud) or not yet verified; or dev keys used on the production domain |
| Google/GitHub button errors in production | OAuth app credentials not entered yet — finish `clerk deploy` (section 3.2) |
| Webhook 400 | wrong `CLERK_WEBHOOK_SECRET`; 500 → variable missing |
| Members missing on Team | they have not opened the dashboard yet and the webhook is not configured |
| `/api/config` has `convexUrl: null` | the build did not run through `convex deploy` (check the build command / deploy key) |
