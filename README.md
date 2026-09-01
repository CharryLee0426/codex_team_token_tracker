# Codex Token Tracker

*中文说明：[README.zh-CN.md](./README.zh-CN.md)*

Team-wide token tracking for an OpenAI **Codex** subscription: a menu bar / tray app that reads the local transcripts of every Codex-OAuth agent on a developer's machine (Codex CLI/Desktop, pi, and best-effort OpenCode, Cline/Roo/Kilo, Hermes), and a Next.js dashboard that shows team and personal usage in real time.

| Audience | Read |
|---|---|
| Team members (install the tool, use the dashboard) | **[User Guide](docs/USER_GUIDE.md)** · [用户指南](docs/USER_GUIDE.zh-CN.md) |
| Admin (deploy dashboard, Convex, Clerk, publish npm) | **[Admin Deployment Guide](docs/ADMIN_DEPLOY.md)** · [管理员部署指南](docs/ADMIN_DEPLOY.zh-CN.md) |
| Developers | this file, `packages/*/README.md`, `apps/dashboard/README.md` |

Production: dashboard **https://codex.chenli.dev** · npm package **`codex-token-tracker`**

```
┌──────────────────────────────┐        ┌──────────────────────┐        ┌───────────────────────────┐
│  codex-token-tracker (npm)   │ upload │  Convex (realtime)   │ live   │  Dashboard (Next.js)      │
│  macOS / Windows tray app    │ ─────▶ │  hourly UTC buckets  │ ─────▶ │  Team + Personal views    │
│  or headless agent (WSL2)    │        │  sessions, devices   │        │  Clerk login (Google/GH)  │
│  reads Codex / pi / … logs   │ ◀───── │  device auth flow    │ ◀───── │  Organizations = teams    │
└──────────────────────────────┘ remote └──────────────────────┘ approve└───────────────────────────┘
```

## Features

- **Metrics** — input / cached / output / reasoning tokens, requests, cache-hit rate, model mix, API-equivalent cost (public API list prices), tokens-per-second of the running session.
- **Live rate limits** — weekly / 5-hour Codex windows straight from the account (same endpoint the Codex app uses), plus per-model limits, plan and credits; falls back to log values when offline.
- **Views** — daily contribution heatmap, hour × weekday activity, Mon–Sun comparison, model distribution, member leaderboard, live "coding now", recent sessions, devices.
- **Sources** — every agent that consumes the Codex subscription is tagged (`codex`, `pi`, `opencode`, `cline`, `roo`, `kilo`, `hermes`, custom dirs); API-key providers inside those agents are excluded by default.
- **Teams** — Clerk Organizations; membership synced from JWT and webhooks; any number of devices per person.
- **Time & language** — database in UTC, all views in the viewer's local time; English / Simplified Chinese, auto-detected and persisted; light / dark / system theme (OpenRouter-style UI).
- **Privacy** — only counts, model/agent names, project folder names and a path hash leave the machine.

## Repository layout

| Path | What | Publish target |
|---|---|---|
| `apps/dashboard` | Next.js 15 dashboard (Clerk, Convex, next-intl, next-themes, Tailwind v4, recharts) | Vercel |
| `packages/menubar` | `codex-token-tracker` – Electron tray app + headless agent + CLI (source registry per agent) | npm |
| `packages/backend` | Convex schema & functions (deployed from `apps/dashboard`) | Convex |
| `packages/shared` | Parsers (Codex, pi, generic), pricing, aggregation, time & palette helpers, `wham/usage` parser — unit-tested | – |
| `docs/` | User guide and admin deployment guide (EN / 中文), Clerk JWT template | – |

Tech stack: Node ≥ 20, TypeScript, pnpm workspaces, Next.js, Clerk, Convex, Electron.

## How it works

1. Every Codex-OAuth agent keeps a local transcript with per-request usage. The tracker's source registry (`packages/menubar/src/core/sources`) discovers and parses them: Codex rollouts (`~/.codex/sessions`, cumulative `token_count` counters turned into per-request deltas), pi (`~/.pi/agent/sessions`), OpenCode storage, Cline-family task folders, Hermes sessions, custom directories.
2. Usage is bucketed by **UTC hour × model × agent**, priced, and upserted to Convex (idempotent — rescans never double count). Sessions are summarized (project folder name + path hash only).
3. A heartbeat every 15 s carries the live snapshot (current session, tokens/sec) for the dashboard's "live now".
4. The dashboard subscribes to Convex queries and converts UTC buckets to the viewer's local time for every day / hour / weekday view.
5. Teams are Clerk Organizations; the team view aggregates all members' devices.

## Development

```bash
pnpm install
cd apps/dashboard && npx convex dev            # dev deployment; writes .env.local (keep running)
# Clerk dev keys → apps/dashboard/.env.local (see .env.example); `clerk init` can do it
pnpm dev                                        # http://localhost:3000

pnpm --filter codex-token-tracker build
node packages/menubar/bin/codex-tracker.js login --dashboard http://localhost:3000
node packages/menubar/bin/codex-tracker.js      # tray app, or `agent` / `status`
```

| Command | What |
|---|---|
| `pnpm test` | unit tests (shared parsers/pricing/aggregation, menubar sources) |
| `pnpm -r typecheck` | all workspaces |
| `pnpm build` | packages, then the dashboard |
| `pnpm release:menubar` | publish `codex-token-tracker` (see the admin guide) |

Pricing lives in `packages/shared/src/pricing.ts`; unknown models fall back to their family and are flagged *estimated*. Versions are pinned to stable major lines (Next 15, Clerk 6, Convex 1.x, TypeScript 5.9, Electron 38, recharts 2); pnpm ≥ 10 needs the `allowBuilds` list in `pnpm-workspace.yaml`.

License: MIT.
