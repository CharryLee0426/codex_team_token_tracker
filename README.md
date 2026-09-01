# Codex Token Tracker

Team-wide token tracking for an OpenAI **Codex** subscription: a menu bar / tray app that reads Codex CLI session logs on each developer's machine, and a Next.js dashboard that shows team and personal usage in real time.

```
┌──────────────────────────────┐        ┌──────────────────────┐        ┌───────────────────────────┐
│  codex-token-tracker (npm)   │ upload │  Convex (realtime)   │ live   │  Dashboard (Next.js)      │
│  macOS / Windows tray app    │ ─────▶ │  hourly UTC buckets  │ ─────▶ │  Team + Personal views    │
│  or headless agent (WSL2)    │        │  sessions, devices   │        │  Clerk login (Google/GH)  │
│  reads ~/.codex/sessions     │ ◀───── │  device auth flow    │ ◀───── │  Organizations = teams    │
└──────────────────────────────┘ remote └──────────────────────┘ approve└───────────────────────────┘
```

**Tracked metrics** – input / cached / output / reasoning tokens, requests, cache-hit rate, model distribution, API-equivalent cost (standard API list prices), tokens-per-second of the running session, Codex rate-limit windows, daily heatmaps, hour-of-day × weekday activity, Mon–Sun comparison, per-member leaderboard, live "who is coding now".

## Repository layout (single repo, single remote)

| Path | What | Publish target |
|---|---|---|
| `apps/dashboard` | Next.js 15 dashboard (Clerk auth, Convex, next-intl, next-themes, Tailwind v4, recharts) | Vercel |
| `packages/menubar` | `codex-token-tracker` – Electron tray app + headless agent + CLI | npm |
| `packages/backend` | Convex schema & functions (deployed from `apps/dashboard`) | Convex |
| `packages/shared` | Codex JSONL parser, pricing table, aggregation, time & palette helpers (tested) | – |

Tech stack: Node ≥ 20, TypeScript, pnpm workspaces, Next.js, Clerk, Convex, Electron.

## How it works

1. Every agent signed in with the Codex subscription keeps a local transcript with per-request token usage. The tracker reads all of them (see *Sources* below): Codex CLI / Desktop rollouts under `~/.codex/sessions/YYYY/MM/DD/` (`event_msg/token_count` lines with cumulative `total_token_usage`, model from `turn_context`), pi sessions under `~/.pi/agent/sessions`, and best-effort readers for OpenCode, Cline/Roo/Kilo and Hermes.
2. The tracker tails those files, turns cumulative counters into per-request deltas (`packages/shared/src/codex-parser.ts`), buckets them by **UTC hour × model**, prices them with the standard API table and uploads changed buckets to Convex (idempotent upserts – re-scanning never double counts).
3. Every 15 s the device sends a heartbeat with its live snapshot (current session, tokens/sec, today's total) so the dashboard can show who is active right now.
4. The dashboard subscribes to Convex queries (real time) and converts UTC buckets to the **viewer's machine time** for all day / hour / weekday views. The database only ever stores UTC.
5. Teams are Clerk **Organizations**. Membership is synced from the JWT on dashboard load and from Clerk webhooks, so the team view aggregates every member who has connected a device.

Privacy: only token counts, model names, the agent name, the project folder *name* and a SHA-256 of the working directory leave the machine. Prompts, code and file contents never do.

### Sources (agents that use the Codex subscription OAuth)

| Agent | Where the tracker reads | Notes |
|---|---|---|
| Codex CLI / Codex Desktop | `$CODEX_HOME/sessions`, `archived_sessions` | Exact per-request deltas from cumulative counters; verified against real logs |
| pi | `~/.pi/agent/sessions/**/*.jsonl` | Only `openai-codex` (subscription) calls count by default; API-key providers are ignored unless `trackAllProviders` is on |
| OpenCode | `~/.local/share/opencode/storage` (message JSON files) | `openai` counts as Codex auth when its `auth.json` entry is OAuth; best-effort |
| Cline / Roo Code / Kilo Code | VS Code-family `globalStorage/<ext>/tasks/*/ui_messages.json` | Best-effort; provider detected from `task_metadata.json` |
| Hermes | `~/.hermes/sessions` (+ `state.db` when readable) | Best-effort generic reader |
| Anything else | `extraSessionDirs: [{ "path": "...", "agent": "name", "format": "codex" \| "pi" \| "generic" }]` | Generic reader accepts JSON/JSONL records with `usage` objects |

Usage is tagged with the agent name end-to-end (menubar "Sources" row, dashboard "Sources" card, agent tag on sessions).

### Rate limits

The menubar shows the **live** account limits (5-hour / weekly windows, additional per-model limits, plan, credits) by calling the same endpoint the official Codex client uses (`https://chatgpt.com/backend-api/wham/usage`) with the local Codex login from `~/.codex/auth.json`. That token is only ever sent to chatgpt.com — never to the dashboard. When offline (or `liveRateLimits: false`) it falls back to the last values seen in Codex logs and labels them *From logs · as of …*.

## Quick start (local development)

```bash
pnpm install

# 1. Convex – creates a dev deployment and writes apps/dashboard/.env.local (NEXT_PUBLIC_CONVEX_URL)
cd apps/dashboard && npx convex dev        # keep running; it also regenerates packages/backend/convex/_generated

# 2. Clerk – copy keys into apps/dashboard/.env.local (see apps/dashboard/.env.example) and configure Clerk (below)

# 3. Dashboard
pnpm dev                                   # http://localhost:3000

# 4. Menu bar app (from the repo root, in another terminal)
pnpm --filter codex-token-tracker build
node packages/menubar/bin/codex-tracker.js login --dashboard http://localhost:3000
node packages/menubar/bin/codex-tracker.js          # tray app (or `agent` for headless)
```

### Clerk configuration (once)

1. Create a Clerk application. Enable **Google** and **GitHub** under *User & Authentication → Social connections*.
2. Enable **Organizations** (*Organizations → Enable*). Every team creates an organization and invites members.
3. Create a **JWT template** named `convex` with these claims (Convex reads them to scope teams):
   ```json
   {
     "org_id": "{{org.id}}", "org_role": "{{org.role}}", "org_slug": "{{org.slug}}", "org_name": "{{org.name}}",
     "email": "{{user.primary_email_address}}", "name": "{{user.full_name}}", "picture": "{{user.image_url}}"
   }
   ```
4. In the **Convex dashboard** set environment variables:
   - `CLERK_JWT_ISSUER_DOMAIN` – the *Issuer* shown on the JWT template page (e.g. `https://your-app.clerk.accounts.dev`)
   - `CLERK_WEBHOOK_SECRET` – from the webhook below
5. Add a Clerk **webhook** pointing at `https://<your-deployment>.convex.site/clerk-webhook` subscribed to `user.*`, `organization.*`, `organizationMembership.*`.

### Environment variables

`apps/dashboard/.env.local` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL (written by `convex dev`, set by `convex deploy` on Vercel) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk keys |
| `NEXT_PUBLIC_APP_URL` | Public dashboard URL (returned to the menubar via `/api/config`) |

## Deploy

### Dashboard → Vercel

1. Import the repo in Vercel, set **Root Directory** to `apps/dashboard` (keep "Include source files outside of the Root Directory" enabled – it is a pnpm workspace).
2. Build command is taken from `apps/dashboard/vercel.json`: `pnpm build:vercel` → `convex deploy --cmd 'next build'`, which deploys the backend and injects `NEXT_PUBLIC_CONVEX_URL`.
3. Environment variables: `CONVEX_DEPLOY_KEY` (Convex dashboard → *Deploy keys*, production), the Clerk keys, `NEXT_PUBLIC_APP_URL`.
4. Point the Clerk webhook and `CLERK_JWT_ISSUER_DOMAIN` at the **production** Convex deployment as well.

### Menu bar tool → npm

```bash
# set DEFAULT_DASHBOARD_URL in packages/menubar/src/core/config.ts to your deployed dashboard first
pnpm --filter codex-token-tracker version patch
pnpm release:menubar          # = pnpm --filter codex-token-tracker publish --access public
```

Users then run:

```bash
npm install -g codex-token-tracker
codex-tracker login           # opens <dashboard>/cli-auth, sign in with Google/GitHub, approve the device
codex-tracker                 # tray app on macOS/Windows; falls back to the headless agent without a display
```

The package bundles everything except Electron (an optional dependency, so headless installs still succeed) – see `packages/menubar/README.md` for all CLI commands, config keys and pricing overrides.

### Windows & WSL2

- **Native Windows**: the tray app works as-is and additionally discovers Codex session logs inside WSL distros (`\\wsl$\<distro>\home\<user>\.codex\sessions`), so one Windows tray app can cover a WSL2 workflow.
- **Inside WSL2**: run `codex-tracker agent` (headless uploader with a status line; add it to your shell profile or a `systemd --user` unit). `codex-tracker status` prints today's usage in the terminal. Under WSLg the Electron tray may or may not be reachable depending on the distro's tray support – the agent mode is the supported path.

## Time zones, languages, themes

- **Storage is UTC** (hourly buckets keyed by UTC hour start). The dashboard and the menubar convert to the viewer's machine time zone for "today", heatmaps, hour-of-day and weekday views.
- **Languages**: English and Simplified Chinese. Both apps default to the machine language and let the user switch; the choice is persisted (dashboard cookie `NEXT_LOCALE`; menubar `~/.codex-tracker/config.json`).
- **Theme**: dashboard supports light / dark / system (persisted); the menubar follows the system theme.

## Pricing

`packages/shared/src/pricing.ts` holds standard OpenAI API list prices (USD per 1M tokens). Unknown or newer models are priced by family fallback and flagged *estimated* in the UI. Override on a device with `~/.codex-tracker/pricing.json`:

```json
{ "gpt-5.6-sol": { "input": 1.75, "cachedInput": 0.175, "output": 14 } }
```

## Scripts

| Command | What |
|---|---|
| `pnpm dev` / `pnpm dev:convex` | dashboard / Convex dev server |
| `pnpm dev:menubar` | rebuild the menubar bundle on change |
| `pnpm build` | build packages then the dashboard |
| `pnpm typecheck` / `pnpm test` | all workspaces / shared unit tests |
| `pnpm release:menubar` | publish `codex-token-tracker` |

## Notes on versions

Dependencies are pinned to well-established major lines (Next 15, Clerk 6, Convex 1.x, TypeScript 5.9, Electron 38, recharts 2). pnpm ≥ 10 requires the `allowBuilds` allow-list in `pnpm-workspace.yaml` for packages with install scripts (esbuild, electron, sharp…).

License: MIT.
