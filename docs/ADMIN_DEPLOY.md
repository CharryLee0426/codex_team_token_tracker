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

1. https://dashboard.convex.dev → your project (dev deployment `majestic-lynx-360` already exists) → **Settings → Deploy keys → Generate production deploy key**. Copy it: this is `CONVEX_DEPLOY_KEY` for Vercel. The production deployment is created on the first deploy.
2. Note the production URLs after the first Vercel build (Convex dashboard → Production): `https://<prod-name>.convex.cloud` (API) and `https://<prod-name>.convex.site` (webhook host).
3. Production environment variables are set in **section 3.6** once Clerk production exists:
   ```bash
   cd apps/dashboard
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.chenli.dev --prod
   npx convex env set CLERK_WEBHOOK_SECRET whsec_xxx --prod
   ```
   (or Convex dashboard → Production → Settings → Environment Variables).

## 2. Vercel — dashboard

1. **Add New Project → Import** `CharryLee0426/codex_team_token_tracker`.
2. **Root Directory**: `apps/dashboard` (keep *Include source files outside of the Root Directory* enabled — it is a pnpm workspace). Framework: Next.js. Build command is read from `apps/dashboard/vercel.json` (`pnpm build:vercel` = `convex deploy --cmd 'next build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`).
3. **Environment variables** (Production):

   | Name | Value |
   |---|---|
   | `CONVEX_DEPLOY_KEY` | production deploy key from step 1 |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` (section 3.5) |
   | `CLERK_SECRET_KEY` | `sk_live_…` (section 3.5) |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/dashboard` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/dashboard` |
   | `NEXT_PUBLIC_APP_URL` | `https://codex.chenli.dev` |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` — makes Vercel honour `packageManager: pnpm@11` (the lockfile needs pnpm ≥ 10 settings) |
   | `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` — skips the 100 MB Electron download of the menubar workspace during install |

   `NEXT_PUBLIC_CONVEX_URL` is **not** set by hand — `convex deploy` injects it at build time.
4. **Domains** → add `codex.chenli.dev`. In your DNS add `CNAME codex → cname.vercel-dns.com` (Vercel shows the exact record). Wait for the certificate.
5. Deploy (first build can run before Clerk production exists; sign-in will work once section 3 is done and you redeploy).
6. Verify: `https://codex.chenli.dev/api/config` returns `{ "convexUrl": "https://<prod>.convex.cloud", "dashboardUrl": "https://codex.chenli.dev", … }`.

## 3. Clerk — production instance

Development keys (`pk_test_`) must not be used in production; Clerk requires a production instance on your own domain.

1. **Create production instance**: Clerk Dashboard → instance switcher (top) → **Create production instance** → *Clone development settings*. Home URL: `https://codex.chenli.dev`.
2. **DNS**: Clerk lists records to add on `chenli.dev` — typically `CNAME clerk → frontend-api.clerk.services`, `CNAME accounts → accounts.clerk.services`, plus `clkmail`, `clk._domainkey`, `clk2._domainkey` for e-mails. Add them and click **Verify**. The Frontend API becomes `https://clerk.chenli.dev` — this is also the **JWT issuer** used below.
3. **Social connections (production needs your own OAuth apps)**:
   - Google: Google Cloud Console → *APIs & Services → Credentials → OAuth client (Web)*; authorized redirect URI = the one Clerk shows (`https://clerk.chenli.dev/v1/oauth_callback`). Paste client id/secret into Clerk → *User & Authentication → Social connections → Google → Use custom credentials*.
   - GitHub: GitHub → *Settings → Developer settings → OAuth Apps → New*; callback URL = the same Clerk callback. Paste into Clerk → GitHub → custom credentials.
4. **Organizations**: *Organizations → Enable* (or `clerk enable orgs --instance prod`). Optionally raise *max members* and turn on *verified domains* so `@yourcompany` e-mails auto-join.
5. **API keys** (production instance): copy `pk_live_…` and `sk_live_…` into Vercel (section 2.3) and **redeploy**.
6. **JWT template** named exactly `convex` — Clerk Dashboard → *Configure → JWT templates → New → Convex*, then replace the claims with `docs/clerk-jwt-template.json`; or with the CLI:
   ```bash
   clerk api /jwt_templates --instance prod -X POST --file docs/clerk-jwt-template.json --yes
   ```
   Then set the issuer on Convex production (section 1.3): `CLERK_JWT_ISSUER_DOMAIN=https://clerk.chenli.dev` (the *Issuer* shown on the template page).
7. **Webhook** (keeps the team roster in sync even for members who never open the dashboard): *Webhooks → Add endpoint* → `https://<prod-name>.convex.site/clerk-webhook`, events `user.*`, `organization.*`, `organizationMembership.*` → copy the signing secret → `npx convex env set CLERK_WEBHOOK_SECRET whsec_… --prod`.

## 4. Post-deploy checklist

1. Open https://codex.chenli.dev → sign in with Google/GitHub → **Create organization** (this is the team) → invite members (they can also self-serve via the organization switcher).
2. On your machine: `npm i -g codex-token-tracker && codex-tracker login` → approve → `codex-tracker agent --once` → data appears on **Personal**, then **Team**.
3. Convex dashboard → Production → Data: `users`, `orgs`, `memberships`, `devices`, `hourlyUsage`, `sessions` fill up. Logs show any `ConvexError`.
4. Clerk → Webhooks → check deliveries return 200.

## 5. Publishing the menu bar tool to npm

The package name is `codex-token-tracker` (default dashboard baked in: `https://codex.chenli.dev`, changeable per user with `--dashboard`).

```bash
npm login                                  # once, on the publishing machine (npm account with 2FA recommended)
pnpm --filter codex-token-tracker version patch   # or minor / major
pnpm release:menubar                       # = pnpm --filter codex-token-tracker publish --access public (runs build + typecheck first)
git push origin main --tags
```

Users upgrade with `npm i -g codex-token-tracker@latest`. Electron is an *optional* dependency, so headless/WSL installs succeed even if its binary download is blocked.

## 6. Operations

- **Updating the dashboard/backend**: push to `main` → Vercel builds → `convex deploy` pushes functions and schema to production in the same build. Schema changes are validated against existing data; keep new fields optional (as done for `agent`).
- **Preview deployments**: they run `convex deploy` against production too. Either disable previews on Vercel or set `CONVEX_DEPLOY_KEY` only for the Production environment.
- **Pricing table**: `packages/shared/src/pricing.ts` (USD per 1M tokens). Unknown models fall back to their family and are flagged *est.*; users can override locally in `~/.codex-tracker/pricing.json`.
- **Revoking a device**: the user does it in Dashboard → Devices; admins can set `revokedAt` on the `devices` row in the Convex dashboard.
- **Removing a member**: remove them from the Clerk organization; the webhook deletes the membership and the team view stops including them (their rows stay attached to their user).
- **Backups / export**: Convex dashboard → Settings → Export, or `npx convex export --prod`.
- **Rotating secrets**: regenerate the Convex deploy key or Clerk keys and update Vercel → redeploy; changing the webhook secret needs the Convex env var updated.
- **Local development** stays on the dev deployment: `cd apps/dashboard && npx convex dev` + `pnpm dev`; `codex-tracker login --dashboard http://localhost:3000`.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Vercel build: `Unknown option allowBuilds` or lockfile errors | pnpm < 10 used; set `ENABLE_EXPERIMENTAL_COREPACK=1` |
| Build hangs downloading Electron | set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` |
| Dashboard banner about `org_id` claim | JWT template not named `convex` or missing the org claims (section 3.6) |
| `Unauthenticated` in Convex logs | `CLERK_JWT_ISSUER_DOMAIN` wrong/missing on production, or set after the last deploy — redeploy once |
| Sign-in loops / cookies | Clerk DNS not verified, or dev keys used on the production domain |
| Webhook 400 | wrong `CLERK_WEBHOOK_SECRET`; 500 → variable missing |
| Members missing on Team | they have not opened the dashboard yet and the webhook is not configured |
| `/api/config` has `convexUrl: null` | the build did not run through `convex deploy` (check the build command / deploy key) |
