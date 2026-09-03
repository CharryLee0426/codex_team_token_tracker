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

> **Electron is downloaded on first launch, not during install.** `npm install -g` never runs Electron's install script, so the install succeeds on locked-down servers and headless machines download nothing. The first `codex-tracker` run on a desktop fetches the runtime (~100 MB, once) into `~/.codex-tracker/electron/<version>/`, honouring `ELECTRON_MIRROR` (e.g. `https://npmmirror.com/mirrors/electron/`) and `HTTPS_PROXY`. A globally installed `electron` (`npm i -g electron`) is used instead when present.

Node.js 20+ is required. Electron is not an npm dependency: if the runtime cannot be downloaded (locked-down servers, WSL without a desktop), the package still installs and runs in agent mode.

> **Stuck on Node 16?** Install [`codex-token-tracker-nodejs16`](https://www.npmjs.com/package/codex-token-tracker-nodejs16) instead — the same app, same features, same version number, built from these same sources for Node 16.8+. Use one or the other on a machine, not both, since they install the same commands.

## Quick start

```bash
codex-tracker login            # connect this device to the dashboard (Google / GitHub via Clerk)
codex-tracker                  # start the menu bar app (agent mode when there is no display)
codex-tracker status           # terminal summary — handy in WSL / over SSH
```

By default the tool connects to **https://codex.chenli.dev**; other teams pass their own dashboard with `--dashboard <url>` (remembered afterwards). `login` prints a short code and the approval link `https://<dashboard>/cli-auth?code=XXXX-XXXX`, opens it in your browser when this machine has one, and otherwise prints a **QR code** of the link — scan it with your phone, or open the link on any other computer, sign in and approve. The tracker then receives a device token. Local tracking works without signing in; signing in enables uploads and the multi-device heatmap.

```
$ codex-tracker login
Connecting this device to https://codex.chenli.dev

  Your code: RHF7-DWW8

Open this link on any device — this computer, another one, or your phone — sign in and approve:
  https://codex.chenli.dev/cli-auth?code=RHF7-DWW8
  The code expires in 15 min.

  █▀▀▀▀▀█ ▄▀ █▄ ▀▀▀ █▀▀▀▀▀█      ← scan with a phone camera
  █ ███ █ ▀▄▀ ▄ ██▀ █ ███ █
  …

Waiting for approval…
Connected as Chen Li. Uploads are enabled.
```

`--qr` always prints the QR code (also on a desktop), `--no-qr` never does, and `--no-browser` only prints the link and the code.

**One machine, one device.** Logging in more than once from the same computer — the tray app *and* `codex-tracker agent`, or a re-login — does not create a second device: the login carries a hashed hardware id (the platform UUID / MachineGuid / `/etc/machine-id`, SHA-256'd, never the raw value), the dashboard attaches it to the machine's existing device, and its usage is counted once. Inside WSL the Windows MachineGuid is used, so a WSL agent and the Windows tray app on the same PC count as one machine too.

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
| `codex-tracker login [--dashboard <url>] [--qr\|--no-qr] [--no-browser]` | Device-code login; prints the link and a QR code for phones / other computers |
| `codex-tracker logout` | Forget the device token (local data stays) |
| `codex-tracker status [--json]` | Today / 7d / 30d usage, live session, rate limits, models |
| `codex-tracker sync` | Full sync: rescan every agent and re-upload this device's whole history |
| `codex-tracker paths` | Detected Codex session directories |
| `codex-tracker config get [key]` / `config set <key> <value>` | Settings (see below) |
| `codex-tracker lang <en\|zh\|auto>` | Display language |
| `codex-tracker update [--check]` | Install the newest published version; `--check` only reports it |
| `codex-tracker --version` / `--help` | |

## Menu bar app

- Tray title shows today's tokens (`12.4k`) — `config set trayTitle tokens|cost|none`
- Click: popover with Today, Live session (tokens/s, context window, rate limits), Activity heatmap, Models, Account
- Right-click: Open dashboard, Sign in/out, Language, Launch at login, Refresh, **Sync now**, Check for updates, Quit
- A banner appears at the top of the popover when a newer version is published; **Update** installs it and the app asks you to restart
- Launch at login uses a LaunchAgent on macOS and the registry run key on Windows

## Sync

The tracker uploads continuously in the background: every 60 s it sends the hour buckets and sessions
that *changed* since the last push. **Sync** does the full version instead — use it when the dashboard's
numbers for this machine look wrong, after you install a new agent, or after an update that changes the
pricing table.

Press the **⟳** button in the popover header (or *Sync now* in the Account card and the tray menu, or run
`codex-tracker sync`). It:

1. re-reads the config, so agents enabled since the app started are picked up;
2. re-discovers **every** session directory and re-parses **every** transcript from scratch — Codex plus
   the coding agents running on your Codex subscription (pi, oh-my-pi, OpenCode, Cline / Roo / Kilo, Hermes) and any
   `extraSessionDirs` you configured — instead of skipping files whose size and mtime are unchanged;
3. recomputes all aggregates with the current pricing table;
4. re-uploads **everything**, not just what changed, so the dashboard's totals for this device are
   replaced by the freshly computed ones — this is the calibration step;
5. pulls the other devices' rows and the live rate limits back down.

A banner reports the phase while it runs and then what it found (`Synced codex, pi · 75 files ·
75 sessions · 70 hours re-uploaded`). Signed out, steps 1-3 still run and nothing leaves the machine.

A full sync re-sends your whole history, so it costs more bandwidth than a normal push — it is a manual
action, never on a timer.

## Windows and WSL2

**Native Windows**: `npm i -g codex-token-tracker` in PowerShell, then `codex-tracker`. The tray app also scans every WSL distro (`\\wsl$\<distro>\home\*\.codex\sessions`) so sessions run inside WSL are counted.

**Inside WSL2**: Electron cannot show a Windows tray from WSL, so run the agent:

```bash
codex-tracker login    # prints the URL, the code and a QR code — approve from your Windows browser or your phone
codex-tracker agent    # keep running (tmux / nohup / systemd --user)
```

The agent also scans `/mnt/c/Users/*/.codex/sessions`, so one agent covers both sides. WSLg can display the Electron window but tray support is limited; the Windows tray app is the recommended UI. Running both the Windows tray app and a WSL agent on one PC is fine since 0.3.0: they identify as the same machine and the dashboard counts it once.

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
| `omp` – [oh-my-pi](https://github.com/can1357/oh-my-pi) | `~/.omp/agent/sessions/<project>/*.jsonl` (`$PI_CONFIG_DIR` replaces `~/.omp`), every profile's `~/.omp/profiles/<name>/agent/sessions`, `$XDG_DATA_HOME/omp/sessions` (+ `profiles/<name>/sessions`) on macOS / Linux, and `$PI_CODING_AGENT_SESSION_DIR` | pi's transcript format, so the same rule as `pi`. A `$PI_CODING_AGENT_DIR` shared by both agents is scanned once and tagged `pi` |
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
Because every Codex-subscription consumer (pi, oh-my-pi, OpenCode, …) draws from the same account, this is the only
accurate number; the values inside Codex logs are just snapshots from Codex's own last request.

- Refreshed every `usageRefreshSec` (default 60 s) and ~10 s after new local usage is seen.
- If the request fails (offline, expired token, API-key login) the card falls back to the latest values from Codex
  logs and is labelled *From logs · as of <time>* with the reason.
- Disable with `codex-tracker config set liveRateLimits false`.

## What gets uploaded

Only aggregates: token counts per UTC hour and model, per-session totals, the model name, the project **folder name** and a SHA-256 of its path, plus a heartbeat (tokens/s, today's totals) that carries a SHA-256 of the machine's hardware id (so one computer maps to one device however often it logs in). Prompts, code, file paths, session contents and the raw hardware id never leave your machine. Timestamps are stored in UTC; the app and dashboard display them in your local time zone.

## Development

```bash
pnpm install                       # from the repo root
pnpm --filter codex-token-tracker build
node packages/menubar/bin/codex-tracker.js status
CODEX_TRACKER_DEBUG=1 node packages/menubar/bin/codex-tracker.js menubar   # verbose logs
CODEX_TRACKER_DEVTOOLS=1 ...                                                # open DevTools
pnpm --filter codex-token-tracker build:icons                               # regenerate tray icons
```

### Dev builds vs published builds

A build knows which environment it belongs to, so a local test run can never write into production.
`scripts/build.mjs` stamps the channel at bundle time: **only `--release` produces a prod build**, which
is what `prepack` runs — so every tarball and every `npm publish` is prod, and every `pnpm build`,
`pnpm dev` and watch-mode rebuild is dev.

| | dev build (`pnpm build`) | published build (`npm i -g codex-token-tracker`) |
| --- | --- | --- |
| Dashboard default | `http://localhost:3000` | `https://codex.chenli.dev` |
| Convex deployment | whatever the local dashboard's `/api/config` advertises — the **dev** one | production |
| Config, device token, upload state | `~/.codex-tracker-dev` | `~/.codex-tracker` |
| `checkUpdates` default | `false` (`update` refuses to run) | `true` |
| App name / Electron userData | `Codex Tracker (dev)` | `Codex Tracker` |
| macOS LaunchAgent | `dev.codex-tracker.menubar.dev` | `dev.codex-tracker.menubar` |
| Popover | orange **DEV** badge in the header | — |

Because the two differ in app name and config directory, **a dev build and an installed one can run at
the same time**, each with its own tray icon, device token and upload state.

To test against a dev environment, start the dashboard and Convex, then run the local build:

```bash
cd apps/dashboard && npx convex dev            # terminal 1
pnpm dev                                        # terminal 2 — http://localhost:3000
pnpm --filter codex-token-tracker build         # terminal 3
node packages/menubar/bin/codex-tracker.js login   # → localhost:3000, no --dashboard needed
node packages/menubar/bin/codex-tracker.js menubar
```

Both defaults are only *defaults*: `--dashboard <url>` and `config set dashboardUrl <url>` still point
either build anywhere, and `CODEX_TRACKER_HOME` still overrides the config directory.

Publishing (from the repo root): `pnpm release:menubar` — `prepublishOnly` typechecks and `prepack`
makes the release build, so a published tarball is never accidentally a dev build. `postpack` restores
the dev build in `dist/` afterwards, so your working copy keeps pointing at localhost.

## License

MIT

## Troubleshooting

- **"Electron download failed" / tray app does not start** – the CLI downloads the Electron runtime on first launch from GitHub releases into `~/.codex-tracker/electron/<version>/`. Behind a firewall set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` (or `HTTPS_PROXY`) and run `codex-tracker menubar` again; a half-finished download can be cleared by deleting that directory. A manually installed `npm i -g electron` is also picked up. The headless `codex-tracker agent` and `codex-tracker status` work without Electron.
- **Nothing is tracked** – run `codex-tracker paths`; Codex must have written rollouts under `~/.codex/sessions` (or set `CODEX_HOME`). Add other locations with `codex-tracker config set extraSessionDirs '["/path/to/sessions"]'`.
- **Uploads fail with BAD_TOKEN** – the device was revoked in the dashboard; run `codex-tracker login` again.
- **No browser on this machine** (WSL2, a server, SSH) – `codex-tracker login` prints the approval link and a QR code; scan it with your phone or open the link on any computer where you can sign in. `--qr` forces the QR code on a desktop too.
- **This machine shows up twice on the dashboard** – it logged in twice with a version before 0.3.0. Restart the tracker (tray app or agent) on 0.3.0; within a few minutes its first heartbeats merge the two entries, and the Devices page shows one device with a *2 logins* badge.
