# codex-token-tracker

Menu bar / system tray app **and** headless agent that tracks your [OpenAI Codex](https://github.com/openai/codex) usage — tokens, cache hit rate, model mix, tokens per second of the running session, subscription rate limits and the **API-equivalent cost in dollars** — and syncs it to your team's Codex Tracker dashboard (Next.js + Clerk + Convex).

- macOS menu bar app and native Windows tray app (Electron)
- `codex-tracker agent` headless mode for **WSL2**, Linux and servers
- Reads Codex CLI / Codex Desktop rollout logs (`~/.codex/sessions`) locally — no API keys, no proxies
- Real-time: today's totals, current session tokens/sec, context window use, weekly / 5-hour rate limits
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

Node.js 20+ is required. Electron is an *optional* dependency: if its binary cannot be downloaded (locked-down servers, WSL without a desktop), the package still installs and runs in agent mode.

## Quick start

```bash
codex-tracker login            # connect this device to the dashboard (Google / GitHub via Clerk)
codex-tracker                  # start the menu bar app (agent mode when there is no display)
codex-tracker status           # terminal summary — handy in WSL / over SSH
```

`login` prints a short code and opens `https://<dashboard>/cli-auth?code=XXXX-XXXX` in your browser. Approve the device there and the tracker receives a device token. Local tracking works without signing in; signing in enables uploads and the multi-device heatmap.

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
| `codex-tracker --version` / `--help` | |

## Menu bar app

- Tray title shows today's tokens (`12.4k`) — `config set trayTitle tokens|cost|none`
- Click: popover with Today, Live session (tokens/s, context window, rate limits), Activity heatmap, Models, Account
- Right-click: Open dashboard, Sign in/out, Language, Launch at login, Refresh, Quit
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
| `dashboardUrl` | `https://codex-tracker.vercel.app` | Your dashboard |
| `language` | `auto` | `en`, `zh` or `auto` (OS language) |
| `uploadIntervalSec` | `60` | Push interval |
| `heartbeatIntervalSec` | `15` | Live status interval |
| `extraSessionDirs` | `[]` | Extra session folders (comma-separated in `config set`) |
| `launchAtLogin` | `false` | macOS / Windows |
| `trayTitle` | `tokens` | `tokens`, `cost` or `none` |

`CODEX_HOME` is honoured when locating `sessions/` and `archived_sessions/`.

### Pricing overrides

Costs are "API-equivalent" — standard OpenAI list prices per 1M tokens (input, cached input, output; reasoning tokens are billed as output). Models missing from the built-in table are priced by family and marked **est.** Override or add prices in `~/.codex-tracker/pricing.json`:

```json
{
  "gpt-5.6-sol": { "input": 1.75, "cachedInput": 0.175, "output": 14 }
}
```

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
