# codex-token-tracker

Menu bar / system tray app **and** headless agent that tracks your [OpenAI Codex](https://github.com/openai/codex) usage — tokens, cache hit rate, model mix, tokens per second of the running session, subscription rate limits and the **API-equivalent cost in dollars** — and syncs it to your team's Codex Tracker dashboard (Next.js + Clerk + Convex).

- macOS menu bar app and native Windows tray app (Electron)
- `codex-token-tracker agent` headless mode for **WSL2**, Linux and servers
- Self-update: `codex-token-tracker update`, plus an in-app "Update" button when a newer version is published
- Reads Codex CLI / Codex Desktop rollout logs (`~/.codex/sessions`) locally — no API keys, no proxies
- Real-time: today's totals, the live session's generation speed (tokens/s), context window use, weekly / 5-hour rate limits
- Activity heatmap merged from **local data + your other devices** (realtime database)
- English / 中文, follows your OS language and can be switched and persisted
- Light / dark follows the system theme

> Screenshots: `docs/` (coming with the first release).

## Install

```bash
npm install -g codex-token-tracker
# or run without installing
npx codex-token-tracker
```

This installs two equivalent commands on your PATH: **`codex-token-tracker`** and the shorter alias
`codex-tracker`. Every example below works with either name.

Already installed? `codex-token-tracker update` fetches the newest published version and installs it
with whichever package manager you used (npm / pnpm / yarn / bun).

> **npm 11+ / pnpm 10+ block Electron's install script by default.** That's fine: the first `codex-tracker` run downloads the Electron runtime itself (~100 MB, once). To do it during install instead: `npm install -g codex-token-tracker --allow-scripts=electron`.

Node.js 20+ is required. Electron is an *optional* dependency: if its binary cannot be downloaded (locked-down servers, WSL without a desktop), the package still installs and runs in agent mode.

## Quick start

```bash
codex-tracker login            # connect this device to the dashboard (Google / GitHub via Clerk)
codex-tracker                  # start the menu bar app (agent mode when there is no display)
codex-tracker status           # terminal summary — handy in WSL / over SSH
```

By default the tool connects to **https://codex.chenli.dev**; other teams pass their own dashboard with `--dashboard <url>` (remembered afterwards). `login` prints a short code and opens `https://<dashboard>/cli-auth?code=XXXX-XXXX` in your browser. Approve the device there and the tracker receives a device token. Local tracking works without signing in; signing in enables uploads and the multi-device heatmap.

### Self-hosted dashboard

```bash
codex-tracker login --dashboard https://tracker.your-company.com
# or
codex-tracker config set dashboardUrl https://tracker.your-company.com
```

The tracker discovers the Convex deployment through `<dashboard>/api/config`.

## Commands

| Command | What it does |
| --- | --- |
| `codex-tracker` | Menu bar app; falls back to `agent` when no display / no Electron |
| `codex-tracker menubar [--background]` | Start the tray app (detached with `--background`) |
| `codex-tracker agent [--interval <sec>] [--once]` | Headless tracking + uploads; `--once` runs one cycle and exits |
| `codex-tracker login [--dashboard <url>]` | Device-code login |
| `codex-tracker logout` | Forget the device token (local data stays) |
| `codex-tracker status [--json]` | Today / 7d / 30d usage, live session, rate limits, models |
| `codex-tracker paths` | Detected Codex session directories |
| `codex-tracker config get [key]` / `config set <key> <value>` | Settings (see below) |
| `codex-tracker lang <en\|zh\|auto>` | Display language |
| `codex-tracker update [--check]` | Install the newest published version; `--check` only reports it |
| `codex-tracker --version` / `--help` | |

## Menu bar app

- Tray title shows today's tokens (`12.4k`) — `config set trayTitle tokens|cost|none`
- Click: popover with Today, Live session (tokens/s, context window, rate limits), Activity heatmap, Models, Account
- Right-click: Open dashboard, Sign in/out, Language, Launch at login, Refresh, Check for updates, Quit
- A banner appears at the top of the popover when a newer version is published; **Update** installs it and the app asks you to restart
- Launch at login uses a LaunchAgent on macOS and the registry run key on Windows

## Windows and WSL2

**Native Windows**: `npm i -g codex-token-tracker` in PowerShell, then `codex-tracker`. The tray app also scans every WSL distro (`\\wsl$\<distro>\home\*\.codex\sessions`) so sessions run inside WSL are counted.

**Inside WSL2**: Electron cannot show a Windows tray from WSL, so run the agent:

```bash
codex-tracker login    # prints the URL + code; open it in your Windows browser
codex-tracker agent    # keep running (tmux / nohup / systemd --user)
```

The agent also scans `/mnt/c/Users/*/.codex/sessions`, so one agent covers both sides. WSLg can display the Electron window but tray support is limited; the Windows tray app is the recommended UI.

Example `systemd --user` unit (`~/.config/systemd/user/codex-tracker.service`):

```ini
[Service]
ExecStart=%h/.npm-global/bin/codex-tracker agent
Restart=always
[Install]
WantedBy=default.target
```

## Configuration

Config lives in `~/.codex-tracker/` (override with `CODEX_TRACKER_HOME`):

| Key | Default | Notes |
| --- | --- | --- |
| `dashboardUrl` | `https://codex.chenli.dev` | Your team dashboard (self-hosters: `codex-tracker login --dashboard <url>`) |
| `language` | `auto` | `en`, `zh` or `auto` (OS language) |
| `uploadIntervalSec` | `60` | Push interval |
| `heartbeatIntervalSec` | `15` | Live status interval |
| `extraSessionDirs` | `[]` | Extra session folders (comma-separated in `config set`) |
| `launchAtLogin` | `false` | macOS / Windows |
| `trayTitle` | `tokens` | `tokens`, `cost` or `none` |
| `checkUpdates` | `true` | Ask the npm registry (once per 6 h) whether a newer version exists |

`CODEX_HOME` is honoured when locating `sessions/` and `archived_sessions/`.

### Updates

`checkUpdates` (default on) asks `registry.npmjs.org` for the package's `latest` dist-tag at most once
every 6 hours and caches the answer in `~/.codex-tracker/update.json`. Nothing else is sent — the request
carries no usage data and no identifiers. Turn it off with `codex-tracker config set checkUpdates false`;
`codex-tracker update` still works on demand. Set `CODEX_TRACKER_REGISTRY` (or `npm_config_registry`) to use
a mirror.

Global installs can fail for reasons the app cannot fix — a root-owned npm prefix, a proxy, a read-only
volume. When that happens the exact command is shown so you can run it yourself.

### Pricing

Costs are "API-equivalent" — [standard OpenAI list prices](https://developers.openai.com/api/docs/pricing)
per 1M tokens (input, cached input, output; reasoning tokens are billed as output). Models with a
long-context tier are billed at the higher rate for requests whose prompt exceeds 272K tokens. `-codex`
variants are priced at their base model's rate.

**Codex only.** Some supported sources (Cline/Roo/Kilo, OpenCode) can also drive Anthropic, Google or local
models. That usage is *not* counted: this tool reports Codex consumption, and pricing a Claude request
against an OpenAI table would be meaningless.

Models missing from the built-in table are priced by family and marked **est.** Override or add prices in
`~/.codex-tracker/pricing.json`:

```json
{
  "gpt-5.7-nova": { "input": 1.75, "cachedInput": 0.175, "output": 14 }
}
```

## Sources

The tracker reads the local transcripts of every agent that can use a Codex subscription (ChatGPT login) and
attributes usage to an **agent** (shown as "Sources" chips in the popover, a `Sources` line in `codex-tracker status`,
and as a tag on live sessions / model rows). Only Codex-subscription providers are counted unless
`trackAllProviders` is `true`, and **only OpenAI models are counted at all** — see [Pricing](#pricing).

| Source | Where it looks | Notes |
|---|---|---|
| `codex` – Codex CLI / Codex Desktop | `$CODEX_HOME` or `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, `archived_sessions/` | Reference format; also carries rate-limit snapshots and context-window size |
| `pi` – [pi coding agent](https://github.com/badlogic/pi-mono) | `$PI_CODING_AGENT_DIR` or `~/.pi/agent/sessions/<project>/*.jsonl` | Counts messages whose `provider` is `openai-codex` (Codex OAuth); other providers (API keys) only with `trackAllProviders` |
| `opencode` – [OpenCode](https://github.com/sst/opencode) | `$XDG_DATA_HOME/opencode` or `~/.local/share/opencode/storage/` (Windows: `%LOCALAPPDATA%\opencode`, `%APPDATA%\opencode`) | One JSON file per message; `providerID` `openai` counts when `auth.json` shows an OAuth login. *Best-effort – format inferred, not verified on a real install* |
| `cline`, `roo`, `kilo` – Cline / Roo Code / Kilo Code (VS Code, Cursor, Windsurf, VSCodium, Trae, VS Code Remote) | `<globalStorage>/<extension id>/tasks/<task>/ui_messages.json` + `task_metadata.json` | Per-request `api_req_started` entries; model/provider from `model_usage`. *Best-effort* |
| `hermes` – Hermes agent | `$HERMES_HOME` or `~/.hermes/sessions/**/*.json\|jsonl` (+ `state.db` via `node:sqlite` when available) | Generic parser: any JSON/JSONL with per-request `usage` objects. *Best-effort* |
| custom | `extraSessionDirs` | `{"path": "~/.myagent/logs", "agent": "myagent", "format": "generic"}` (formats: `codex`, `pi`, `generic`, `opencode`, `cline`) |

All sources are on by default. Turn one off with `codex-tracker config set sources.opencode false` (or
`config set sources '{"pi":false}'`); `codex-tracker paths` shows which roots were found. On Windows the WSL
distros' homes are scanned too, and inside WSL the Windows user profiles under `/mnt/c/Users`.

The opencode / cline / hermes readers were written from the projects' known on-disk layouts without a real
install to test against. If your usage is missing, please open an issue with one anonymised sample file
(`ui_messages.json`, a message JSON, or a session JSONL) and the output of `codex-tracker paths`.

## Rate limits

The popover and `codex-tracker status` show your account's rate-limit windows (e.g. weekly / 5-hour) **live** from
`https://chatgpt.com/backend-api/wham/usage`, the same endpoint the official Codex client uses. The request is
made with the access token from your local Codex login (`~/.codex/auth.json`); the token is read fresh each time,
never written, never refreshed by the tracker, and is sent **only to chatgpt.com** – never to the dashboard.
Because every Codex-subscription consumer (pi, OpenCode, …) draws from the same account, this is the only
accurate number; the values inside Codex logs are just snapshots from Codex's own last request.

- Refreshed every `usageRefreshSec` (default 60 s) and ~10 s after new local usage is seen.
- If the request fails (offline, expired token, API-key login) the card falls back to the latest values from Codex
  logs and is labelled *From logs · as of <time>* with the reason.
- Disable with `codex-tracker config set liveRateLimits false`.

## What gets uploaded

Only aggregates: token counts per UTC hour and model, per-session totals, the model name, the project **folder name** and a SHA-256 of its path, plus a heartbeat (tokens/s, today's totals). Prompts, code, file paths and session contents never leave your machine. Timestamps are stored in UTC; the app and dashboard display them in your local time zone.

## Development

```bash
pnpm install                       # from the repo root
pnpm --filter codex-token-tracker build
node packages/menubar/bin/codex-tracker.js status
CODEX_TRACKER_DEBUG=1 node packages/menubar/bin/codex-tracker.js menubar   # verbose logs
CODEX_TRACKER_DEVTOOLS=1 ...                                                # open DevTools
pnpm --filter codex-token-tracker build:icons                               # regenerate tray icons
```

Publishing (from the repo root): `pnpm release:menubar` — `prepublishOnly` rebuilds and typechecks first.

## License

MIT

## Troubleshooting

- **"Electron is not installed" / tray app does not start** – the Electron binary is downloaded by an install script. If your package manager skipped or cached it incompletely, run `npm rebuild electron` (or `node "$(npm root -g)/codex-token-tracker/node_modules/electron/install.js"`). With pnpm, allow the build script (`pnpm approve-builds`). The headless `codex-tracker agent` and `codex-tracker status` work without Electron.
- **Nothing is tracked** – run `codex-tracker paths`; Codex must have written rollouts under `~/.codex/sessions` (or set `CODEX_HOME`). Add other locations with `codex-tracker config set extraSessionDirs '["/path/to/sessions"]'`.
- **Uploads fail with BAD_TOKEN** – the device was revoked in the dashboard; run `codex-tracker login` again.
