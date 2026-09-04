# Codex Token Tracker

*中文说明：[README.zh-CN.md](./README.zh-CN.md)*

Team-wide token tracking for an OpenAI **Codex** subscription: a menu bar / tray app that reads local usage records from current, audited Codex-OAuth agents (Codex CLI/Desktop, pi, oh-my-pi, Cline, Kilo Code, Hermes Agent, OpenClaw and DeepSeek Harness), plus retained best-effort readers, and web/native dashboards that show team and personal usage in real time.

| Audience | Read |
|---|---|
| Team members (install the tool, use the dashboard) | **[User Guide](docs/USER_GUIDE.md)** · [用户指南](docs/USER_GUIDE.zh-CN.md) |
| Admin (deploy dashboard, Convex, Clerk, publish npm) | **[Admin Deployment Guide](docs/ADMIN_DEPLOY.md)** · [管理员部署指南](docs/ADMIN_DEPLOY.zh-CN.md) |
| Developers | this file, `packages/*/README.md`, `apps/dashboard/README.md`, [native mobile guide](apps/mobile/README.md) |

Production: dashboard **https://codex.chenli.dev** · npm package **`codex-token-tracker`**

Team members need two commands (Node.js 20+; nothing to install — `npx` fetches the newest version each start):

```bash
npx codex-token-tracker login   # the first time on a computer: sign in and approve the device in the browser that opens
npx codex-token-tracker         # every day after: start the menu bar app and leave it running (right-click → Launch at login)
```

Then open the dashboard: **Personal** fills within a minute. The first sign-in starts a short guided tour; replay it from **Settings**.

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
- **Native viewers** — read-only SwiftUI and Kotlin/Compose apps mirror the dashboard on iOS and Android; collection remains on desktop machines.
- **Sources** — current audited integrations are tagged `codex`, `pi`, `omp` (oh-my-pi), `cline`, `kilo`, `hermes`, `openclaw` and `dsh` (DeepSeek Harness); retained OpenCode / Roo readers and custom directories remain available. API-key providers inside multi-provider agents never enter displayed, priced, or uploaded totals.
- **Teams** — Clerk Organizations; membership synced from JWT and webhooks; any number of devices per person — and exactly one device per machine, however often it logs in (tray app + headless agent, re-logins).
- **Headless login** — `npx codex-token-tracker login` prints the approval link and a QR code, so a WSL2 box, a server or an SSH session is approved from a phone or any other computer.
- **Time & language** — database in UTC, all views in the viewer's local time; English / Simplified Chinese, auto-detected and persisted; light / dark / system theme (mission-control style UI with a particle scene behind the landing page and dashboard).
- **Guided tour** — a first sign-in walks through connecting a machine and the board's views; skippable, replayable from Settings, `pnpm dev:tour` to work on it.
- **Privacy** — only counts, model/agent names, project folder names and a path hash leave the machine.

## Repository layout

| Path | What | Publish target |
|---|---|---|
| `apps/dashboard` | Next.js 15 dashboard (Clerk, Convex, next-intl, next-themes, Tailwind v4, recharts) | Vercel |
| `apps/mobile` | Read-only native viewers (SwiftUI on iOS, Kotlin/Compose on Android) | Local/App Store builds |
| `packages/menubar` | `codex-token-tracker` – Electron tray app + headless agent + CLI (source registry per agent) | npm |
| `packages/backend` | Convex schema & functions (deployed from `apps/dashboard`) | Convex |
| `packages/shared` | Parsers (Codex, pi, generic), pricing, aggregation, time & palette helpers, `wham/usage` parser — unit-tested | – |
| `docs/` | User guide and admin deployment guide (EN / 中文), Clerk JWT template | – |

Tech stack: Node ≥ 20, TypeScript, pnpm workspaces, Next.js, Clerk, Convex, Electron, SwiftUI, Kotlin, Jetpack Compose.

## How it works

1. Codex-OAuth agents keep local usage records. The tracker's source registry (`packages/menubar/src/core/sources`) discovers and parses current Codex rollouts, pi / oh-my-pi JSONL, Cline message envelopes, Kilo and Hermes SQLite stores, OpenClaw databases, and DeepSeek Harness JSONL / Zstandard logs. Older OpenCode, Roo, Cline-family and JSON/JSONL layouts remain as compatibility readers. OpenClaw-managed Codex rollouts are discoverable for local diagnostics, but are not counted without durable OAuth attribution.
2. Usage is bucketed by **UTC hour × model × agent**, priced, and upserted to Convex (idempotent — rescans never double count). Sessions are summarized (project folder name + path hash only).
3. A heartbeat every 15 s carries the live snapshot (current session, output tokens/sec) for the dashboard's "live now".
4. The dashboard subscribes to Convex queries and converts UTC buckets to the viewer's local time for every day / hour / weekday view.
5. Teams are Clerk Organizations; the team view aggregates all members' devices.
6. Native mobile apps authenticate with Clerk and subscribe to the same Convex read queries. They do not scan files, collect usage or upload buckets.

## Agent compatibility

The current public releases and repositories of the OpenRouter-ranked agents were audited for a real,
user-facing Codex / ChatGPT OAuth route and durable local usage data.

| Agent | Status | What is tracked / decision |
|---|---|---|
| Codex CLI / Codex Desktop | Supported | Native rollout usage, including current `token_usage_record` entries and legacy counters |
| pi | Supported | Assistant usage attributed to the `openai-codex` OAuth provider |
| oh-my-pi (`omp`) | Supported | pi-compatible messages plus current `model_usage` records |
| Cline | Supported | Current v1 message envelopes and legacy task storage; only exact `openai-codex` usage counts by default |
| Kilo Code | Supported | Current SQLite message store plus legacy VS Code task storage |
| Hermes Agent | Supported | Current `session_model_usage` SQLite aggregates plus legacy JSON / JSONL sessions |
| OpenClaw | Supported | Current per-agent SQLite transcripts and attributable legacy JSON / JSONL; managed Codex rollouts are diagnostic-only because OpenClaw keeps their OAuth tokens in memory rather than in the managed `CODEX_HOME` |
| DeepSeek Harness (`dsh`) | Supported | Direct `openai-codex` usage from `$DSH_HOME/sessions` or `~/.dsh/sessions`, including concatenated `session.jsonl.zstd` logs, when current local route metadata identifies OAuth. Custom session roots can select `format: "dsh"` |
| OpenCode | Retained best-effort | Existing message-store reader remains enabled; not verified as a current-format integration by this audit |
| Roo Code | Retained best-effort | Existing legacy Cline-format task reader remains enabled |
| Claude Code | Audited, not enabled | Claude Code has no public Codex / ChatGPT OAuth provider; its first-party login is for Anthropic services |
| Zazen (Freebuff fork) | Covered through `codex` | Freebuff Desktop can run a locally installed Codex with the existing provider account. Those native rollouts are tracked as `codex`; Freebuff exposes no distinct durable OAuth attribution for a separate source |

Runtime and attribution limits:

- Current Kilo, Hermes and OpenClaw SQLite stores use `node:sqlite`, available from Node 22.5 and in the current Electron runtime. On older Node runtimes the tracker uses each agent's attributable legacy JSON/JSONL or VS Code task fallback; SQLite-only history cannot be read there.
- Native Codex rollouts count only when the current `$CODEX_HOME/auth.json` proves a ChatGPT login (an explicit `auth_mode: "chatgpt"` or a structurally valid legacy token bundle). If Codex stores credentials only in the OS keyring, or uses an ephemeral auth injection, the tracker deliberately fails closed because the rollout itself does not record the authentication method. For the same reason, switching the current Codex login between ChatGPT and API-key auth reclassifies historical rollouts on the next scan. Credential values are never retained, logged, or uploaded.
- Kilo uses only the current auth entry's `type` discriminator; credential values are not retained, logged, or uploaded. Because its message rows do not retain the per-request auth method, switching OpenAI between OAuth and API-key auth can change how historical rows are classified on a later sync.
- DeepSeek Harness parses its local credentials and settings YAML, but uses only the `openai-codex` record kind and whether an API-key override is configured; credential values are not retained, logged or uploaded. Its logs likewise do not retain the auth method per request, so current route configuration determines how historical rows are classified. This also applies to a custom `dsh`-format root: attribution uses the current sidecars under `$DSH_HOME` or `~/.dsh`.
- Hermes stores hourly-agnostic session/model aggregates. The tracker assigns each aggregate to its `last_seen` hour, so totals are preserved but the hourly distribution is an approximation.
- OpenClaw's current transcript database carries the exact Codex-OAuth route marker and is the supported source. Its managed Codex harness injects `chatgptAuthTokens` in memory and intentionally does not write them to the managed `CODEX_HOME/auth.json`; those rollout files can be inspected only with `trackAllProviders` and never enter OAuth totals.
- Compressed Codex/OpenClaw `.jsonl.zst` rollouts and DeepSeek Harness `.jsonl.zstd` sessions prefer native Zstandard when available and otherwise use the bundled decoder, so compressed history remains readable on every supported runtime. Plain `.jsonl` remains supported.

## Development

```bash
pnpm install
cd apps/dashboard && npx convex dev            # dev deployment; writes .env.local (keep running)
# Clerk dev keys → apps/dashboard/.env.local (see .env.example); `clerk init` can do it
pnpm dev                                        # http://localhost:3000

pnpm --filter codex-token-tracker build          # a local build is a *dev* build
node packages/menubar/bin/codex-tracker.js login   # → localhost:3000 by default, no flag needed
node packages/menubar/bin/codex-tracker.js      # tray app, or `agent` / `status`
```

A local `pnpm build` targets the **dev** environment: the dashboard at `http://localhost:3000` (and so
the dev Convex deployment), state in `~/.codex-tracker-dev`, no self-update, an orange **DEV** badge in
the popover. Only `--release` — which `prepack` runs on `npm pack` / `npm publish` — produces a build
that talks to production. The two can run side by side; see
[`packages/menubar/README.md`](packages/menubar/README.md#dev-builds-vs-published-builds).

| Command | What |
|---|---|
| `pnpm dev:tour` | dashboard dev server with the guided tour forced open on every dashboard load |
| `pnpm test` | unit tests (shared parsers/pricing/aggregation, menubar sources) |
| `pnpm -r typecheck` | all workspaces |
| `pnpm build` | packages, then the dashboard |
| `pnpm release:menubar` | publish `codex-token-tracker` — `prepack` makes the production build (see the admin guide) |

Pricing lives in `packages/shared/src/pricing.ts`, mirroring <https://developers.openai.com/api/docs/pricing> (including the 272K long-context tiers); unknown models fall back to their family and are flagged *estimated*. Only OpenAI models with exact Codex-OAuth attribution are counted — API-key and non-OpenAI usage is dropped, since this tracker reports Codex subscription consumption. Versions are pinned to stable major lines (Next 15, Clerk 6, Convex 1.x, TypeScript 5.9, Electron 38, recharts 2); pnpm ≥ 10 needs the `allowBuilds` list in `pnpm-workspace.yaml`.

License: MIT.
