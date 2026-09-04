> Production deployment steps (Vercel + Convex prod + Clerk prod): see [docs/ADMIN_DEPLOY.md](../../docs/ADMIN_DEPLOY.md).

# Codex Tracker – Dashboard

Next.js 15 (App Router) dashboard for team Codex token usage. Auth by Clerk (Google / GitHub, Organizations), realtime data from Convex, English + Chinese, light / dark / system theme. Mission-control style UI: a dark-first "deep space" design system with a persistent particle scene behind the landing page and the dashboard.

## Local development

```bash
pnpm install                       # from the repo root
cd apps/dashboard
cp .env.example .env.local         # fill in the Clerk keys
pnpm dev:convex                    # terminal 1: creates/links a Convex dev deployment and writes NEXT_PUBLIC_CONVEX_URL
pnpm dev                           # terminal 2: http://localhost:3000
```

`convex.json` points the Convex CLI at `../../packages/backend/convex`, so `pnpm dev:convex` deploys the shared backend and regenerates `packages/backend/convex/_generated`.

## Clerk setup

1. Create a Clerk application. Under **User & Authentication → Social connections** enable **Google** and **GitHub**.
2. **Organizations → Enable organizations** (teams in the dashboard are Clerk organizations).
3. **JWT templates → New template → Convex**. Name it exactly `convex` and add these claims:
   ```json
   {
     "org_id": "{{org.id}}",
     "org_role": "{{org.role}}",
     "org_slug": "{{org.slug}}",
     "org_name": "{{org.name}}",
     "email": "{{user.primary_email_address}}",
     "name": "{{user.full_name}}",
     "picture": "{{user.image_url}}"
   }
   ```
   Copy the template's **Issuer** (e.g. `https://your-app.clerk.accounts.dev`).
4. **Webhooks → Add endpoint**: `https://<your-convex-deployment>.convex.site/clerk-webhook`, subscribe to `user.*`, `organization.*`, `organizationMembership.*`. Copy the signing secret.
5. Copy the publishable + secret keys into `.env.local` (and later into Vercel).

## Convex environment variables

In the Convex dashboard (Settings → Environment Variables) for each deployment:

| Variable | Value |
| --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | the JWT template issuer from step 3 |
| `CLERK_WEBHOOK_SECRET` | the webhook signing secret from step 4 |

## Deploy to Vercel

1. Import the repository; set **Root Directory** to `apps/dashboard` (keep "Include source files outside of the Root Directory" enabled). Vercel detects pnpm workspaces automatically.
2. Build command is taken from `vercel.json` → `pnpm build:vercel`, which runs `convex deploy --cmd 'next build'` (pushes the backend, then builds Next with the production `NEXT_PUBLIC_CONVEX_URL`).
3. Environment variables on Vercel:
   - `CONVEX_DEPLOY_KEY` – production deploy key from the Convex dashboard
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
   - `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard`
   - `NEXT_PUBLIC_APP_URL=https://<your-domain>`
4. Point the menu bar app at the deployed URL: `codex-tracker login --dashboard https://<your-domain>`. The app discovers the Convex URL through `GET /api/config`.

## Structure

- `src/app` – routes: `/` landing, `/dashboard/{personal,team,members,devices}`, `/cli-auth` (device approval), `/settings`, `/sign-in`, `/sign-up`, `/preview/*` (design harness, dev only), `/api/config`, `/api/health`
- `src/components/onboarding` – the guided tour (see below)
- `src/app/globals.css` + `src/lib/theme.ts` – design tokens (dark-first palette with a light variant); the TS copy feeds charts, the canvas scene and Clerk's appearance
- `src/components/scene` – the canvas particle engine (starfield, landing constellation, warp transition) mounted once in the root layout so it persists across navigation
- `src/components/landing` – hero, telemetry strip, feature cards, how-it-works, product preview (the real board on sample data)
- `src/components/providers.tsx` – Clerk + Convex providers; token fetches retry and an auth watchdog re-arms Convex auth when a refresh failed (sleep/wake, network blip), so subscriptions never silently freeze
- `src/components/shell` – dashboard chrome: desktop rail, glass top bar, phone tab bar, realtime-link indicator (reads *Reconnecting…* while auth is being re-armed)
- `src/components/charts` – recharts + SVG charts using the shared, CVD-validated palette; every chart sits in `ChartCard` (skeleton → chart, stale dimming, optional table twin)
- `src/components/dashboard` – `usage-dashboard.tsx` (container: Convex subscriptions + preferences) and `usage-dashboard-view.tsx` (pure view), KPI tiles, leaderboard, sessions, devices, members
- `src/components/ui` – primitives (button, card, stat tile with sparkline / ring meter, segmented control, responsive table that collapses into cards below `md`)
- `src/hooks/use-usage-data.ts` – live usage → render model (`src/lib/usage-model.ts`); `use-hourly-range.ts` – chunked subscription to `usage.hourly` (UTC hour buckets → local time on the client)
- `src/lib/demo-data.ts` – deterministic sample data for the landing preview and the `/preview` harness
- `src/i18n` + `src/messages` – next-intl (cookie `NEXT_LOCALE`, defaults to the browser language)

## Guided tour (onboarding)

The first time an account opens `/dashboard/*` a guided tour runs: three briefing stages (what the
tracker does, `npx codex-token-tracker login`, keeping it running) and then spotlights over the real
rail — Personal, Team, Members, Devices, the range picker, Settings — ending in a systems check. Finishing
or skipping it sets `users.onboardedAt`, so it never opens by itself again on that account (any browser,
any device). It can be replayed from **Settings → Guided tour**, or by opening any dashboard page with
`?tour=1`.

Working on it:

| | |
| --- | --- |
| `pnpm dev:tour` | dev server with `NEXT_PUBLIC_ONBOARDING_TOUR=force`: the tour opens on every dashboard load |
| `NEXT_PUBLIC_ONBOARDING_TOUR=off` | never opens by itself (Settings and `?tour=1` still work) |
| `/dashboard/personal?tour=1` | replay once, no restart needed |
| `/preview/personal?tour=1` | the tour over the sample board, without an account |

Code: `src/components/onboarding` — `steps.ts` (the stages and their `data-tour` targets), `onboarding-tour.tsx`
(overlay, spotlight geometry, keyboard and focus handling), `tour-art.tsx` (illustrations), and
`onboarding-controller.tsx` (when it opens; `users.completeOnboarding`). Copy lives under `onboarding` in
`src/messages/*.json`.

## Design preview harness

`/preview/{personal,team,members,devices,settings}` renders the full dashboard chrome and views from sample data, without a session — handy for reviewing the UI on phones and tablets. It is available in development only; set `NEXT_PUBLIC_DESIGN_PREVIEW=1` to expose it on a deployed build.

## Motion & performance notes

- The scene respects `prefers-reduced-motion` (static frame, plain navigation instead of the warp), pauses when the tab is hidden, caps the frame rate at 30 fps inside the app, and scales particle counts by a coarse device tier (`src/hooks/use-perf-tier.ts`).
- Charts animate only on first render; live updates never replay transitions. Range changes keep the previous render dimmed instead of flashing skeletons.
