# Codex Tracker – Dashboard

Next.js 15 (App Router) dashboard for team Codex token usage. Auth by Clerk (Google / GitHub, Organizations), realtime data from Convex, English + Chinese, light / dark / system theme, OpenRouter-style UI.

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

- `src/app` – routes: `/` landing, `/dashboard/{personal,team,members,devices}`, `/cli-auth` (device approval), `/settings`, `/sign-in`, `/sign-up`, `/api/config`, `/api/health`
- `src/components/charts` – recharts + SVG charts using the shared, CVD-validated palette
- `src/components/dashboard` – KPI tiles, usage dashboard composition, leaderboard, sessions, devices
- `src/hooks/use-hourly-range.ts` – chunked live subscription to `usage.hourly` (UTC hour buckets → local time on the client)
- `src/i18n` + `src/messages` – next-intl (cookie `NEXT_LOCALE`, defaults to the browser language)
