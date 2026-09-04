# Codex Token Tracker — User Guide

*中文版：[USER_GUIDE.zh-CN.md](./USER_GUIDE.zh-CN.md)*

This guide is for team members. You do not deploy anything: your admin runs the dashboard at **https://codex.chenli.dev**; you only sign in and install a small menu bar tool on each computer where you use Codex.

## 1. What you get

- **Dashboard** (https://codex.chenli.dev) — your personal usage and your team's usage: tokens, cache-hit rate, API-equivalent cost, daily heatmap, active hours, weekday comparison, model mix, who is coding right now.
- **Menu bar / tray app** (`codex-token-tracker` on npm) — lives in the macOS menu bar or Windows tray, shows today's usage, the running session's tokens per second, your **live** weekly / 5-hour Codex limits, and uploads your usage to the team dashboard every minute.

Everything is shown in **your computer's local time** and in **English or Chinese** (follows your system language; switchable and remembered).

## 2. Sign in to the dashboard

1. Open https://codex.chenli.dev and click **Sign in** → **Google** or **GitHub**.
2. Your admin adds you to the team (a Clerk *organization*), in one of two ways:
   - **An invite link** like `https://codex.chenli.dev/j/7K2QF9XM4TVB` — open it, sign in with any account, and press **Join the organization**. The link works for anyone who has it until it expires (at most 7 days) or runs out of seats.
   - **An e-mail invitation** — accept it from the email or from the organization switcher in the dashboard header.

   Until you are in the organization you still see your **Personal** view.

Always use the same login provider (or the same e-mail) on every device so all usage lands on one account.

## 3. Install and start the menu bar tool

Requirements: **Node.js 20 or newer** (`node -v`; install it from https://nodejs.org or with `nvm`). `npx` comes with Node, and there is nothing else to install — the tracker is fetched when you run it.

### The first time on a computer

```bash
npx codex-token-tracker login
```

1. The terminal prints a code such as `RHF7-DWW8` and the link `https://codex.chenli.dev/cli-auth?code=…`, and opens it in your browser (the very first run also downloads the package — a few seconds).
2. In the browser, sign in with the **same** Google/GitHub account you use for the dashboard and click **Approve**.
3. The terminal shows *Connected as <your name>. Uploads are enabled.* This computer now has its own device token — see it, or revoke it, under **Dashboard → Devices**.

No browser on that machine (WSL2, a server, SSH)? The terminal also prints a **QR code** of the same link: scan it with your phone's camera, sign in there and approve — or open the link on any other computer. Add `--qr` to get the QR code on a desktop too, `--no-qr` to hide it.

### After you have signed in — every day

```bash
npx codex-token-tracker
```

This starts the menu bar / tray app (on a desktop the first start also downloads the Electron runtime, ~100 MB, once). Leave it running: it reads supported agents' local Codex usage records, shows today's usage in the tray and uploads to the dashboard every minute. Then:

- Right-click the tray icon → **Launch at login**, and you never have to type the command again.
- Open https://codex.chenli.dev → **Personal**. Past sessions are uploaded on the first run; new usage appears within a minute.
- `npx codex-token-tracker status` prints today's usage, your live limits and the signed-in account — no tray needed.

`npx` fetches the newest published version every time it starts, so there is nothing to update. Prefer a permanent install? `npm install -g codex-token-tracker` gives you the shorter **`codex-tracker`** command (and its alias `codex-token-tracker`), upgraded with `codex-tracker update`. Every command in this guide works in both forms — `codex-tracker <command>` below means `npx codex-token-tracker <command>` if you did not install globally.

Logging in more than once from one computer (the menu bar app *and* the headless agent, or a re-login) is fine: the dashboard recognises the machine and keeps a single device for it, so nothing is counted twice.

> **The Electron runtime is downloaded on the first start, never during install** (~100 MB, once, into `~/.codex-tracker/electron/`). Behind a firewall set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` or `HTTPS_PROXY` and start again; the headless `agent` and `status` commands need no Electron at all.

Tips
- The tray title shows today's tokens (e.g. `12.4k`); `codex-tracker config set trayTitle cost` shows dollars instead, `none` hides it.
- Global install only: upgrade with `codex-tracker update` (or `npm install -g codex-token-tracker@latest`). The tray menu and the popover offer an **Update** button when a new version is out; started with `npx`, it simply asks you to quit and run `npx codex-token-tracker` again.

### Windows

Works natively (system tray): run the same two commands in PowerShell. If you use Codex inside **WSL2**, the Windows tray app also discovers the WSL session logs (`\\wsl$\<distro>\home\<you>\.codex`), so one tracker is enough; running a WSL agent as well does no harm — both identify as the same PC and it is counted once.

### WSL2 / Linux servers (no tray)

```bash
npx codex-token-tracker login    # prints the URL and a QR code — approve from your phone or any browser
npx codex-token-tracker agent    # headless: tracks + uploads, prints a status line
npx codex-token-tracker status   # today's usage, live limits, sources
```

Keep the agent running (tmux, `nohup`, or a `systemd --user` service).

## 4. What the menu bar shows

| Section | Meaning |
|---|---|
| **Today** | Tokens, API-equivalent cost, cache-hit %, requests — local day, this machine |
| **Sources** | Which tools consumed your Codex subscription (Codex, pi, oh-my-pi, …) |
| **Live** | Current session's project, model, generation speed (output tokens/second), context window use |
| **Rate limits** | **Live** weekly / 5-hour limits from your Codex account (same numbers as the Codex app), extra per-model limits, plan, "resets in …". Amber *From logs* means the live query failed (offline / expired Codex login) and the last logged value is shown |
| **Heatmap** | Last 16 weeks, this machine plus your other devices |
| **Models** | Tokens, share and cost per model; *est.* = model newer than the price table |

"API-equivalent cost" is what the same tokens would cost on the public OpenAI API at list prices — a way to compare usage, not a bill.

## 5. Dashboard tour

- **Personal** — only you (all your devices). **Team** — everyone in the organization, plus a member leaderboard.
- **Range chips** (Today · 7d · 30d · 90d · 1y), **Since team plan starts** (everything since 2026-08-25 00:00 PDT) and **Custom** (any start and end day, up to a year) apply to every card. **Active hours** always covers at least the last 7 days, so a 1-day range still shows a full week's pattern.
- **Members** — roster, last seen, who is live. **Devices** — your connected computers; **Revoke** disconnects one.
- Header: organization switcher, language (EN / 中文), theme (light / dark / system).

## 6. Which agents are tracked

The current public agents below have been audited for both a user-facing Codex / ChatGPT OAuth login
and durable local usage data. API-key and non-OpenAI records never enter displayed, priced, or uploaded totals.

| Agent | Status and local data |
|---|---|
| Codex CLI / Codex Desktop | Supported: native rollouts in `~/.codex/sessions`, including current `token_usage_record` entries and legacy counters |
| pi | Supported: `~/.pi/agent/sessions`; `openai-codex` assistant usage is attributed to `pi` |
| oh-my-pi (`omp`) | Supported: `~/.omp/agent/sessions`, profiles and the XDG session directory; pi-compatible messages and current `model_usage` records are attributed to `omp` |
| Cline | Supported: current v1 envelopes under `~/.cline/data/sessions` and legacy VS Code task storage; only exact `openai-codex` usage counts by default, while `openai-codex-cli` is excluded to avoid counting the same Codex rollout twice |
| Kilo Code | Supported: current `kilo*.db` SQLite stores from `$KILO_DB`, otherwise `%LOCALAPPDATA%\kilo` on Windows, `~/Library/Application Support/kilo` on macOS, or `$XDG_DATA_HOME/kilo` (normally `~/.local/share/kilo`) on Linux; legacy VS Code task storage remains supported |
| Hermes Agent | Supported: current `state.db` usage aggregates under `$HERMES_HOME` or `<user-home>/.hermes` on every OS (including Windows homes visible from WSL), plus profiles and legacy JSON / JSONL sessions |
| OpenClaw | Supported: per-agent SQLite transcripts under `$OPENCLAW_STATE_DIR`, `~/.openclaw` or `~/.clawdbot`, plus attributable legacy JSON / JSONL. Managed Codex rollouts are diagnostic-only because their OAuth token is not persisted alongside them |
| DeepSeek Harness (`dsh`) | Supported: exact `openai-codex` usage under `$DSH_HOME/sessions` or `~/.dsh/sessions` when current local route metadata identifies OAuth; reads `session.jsonl` and concatenated `session.jsonl.zstd` frames. For another session root, use `format: "dsh"` in `extraSessionDirs` |
| OpenCode / Roo Code | Existing best-effort compatibility readers remain available, but this audit did not verify them as current-format integrations |
| Other tools | Add a compatible directory with `codex-tracker config set extraSessionDirs '[{"path":"/path/to/logs","agent":"mytool","format":"generic"}]'` |

Audit decisions for the remaining ranked agents:

- **Claude Code** has no public Codex / ChatGPT OAuth provider; its first-party login is for Anthropic services.
- **Zazen (Freebuff fork)** needs no separate source: Freebuff Desktop can run a locally installed Codex using the existing provider account, and those native rollouts are already tracked as `codex`. Freebuff does not expose distinct durable OAuth attribution that could be labelled `zazen`.

Accuracy and runtime notes:

- Current Kilo, Hermes and OpenClaw databases require `node:sqlite` (Node 22.5+ or the current Electron runtime). Older Node runtimes use attributable legacy JSON/JSONL or VS Code task fallbacks; they cannot read history that exists only in SQLite.
- Native Codex rollouts count only when the current `$CODEX_HOME/auth.json` proves ChatGPT login. Keyring-only or ephemeral login leaves no readable auth method in the rollout, so the tracker deliberately excludes it rather than risk counting API-key usage. Because rollouts also lack a per-request auth marker, switching the current Codex login between ChatGPT and API-key auth reclassifies historical rollouts on the next scan. Credential values are never retained, logged or uploaded.
- Kilo uses only the current auth entry's `type` discriminator; credential values are not retained, logged, or uploaded. Its SQLite messages do not preserve the auth method used by each request, so changing OpenAI between OAuth and API-key auth can reclassify historical rows on the next sync.
- DeepSeek Harness parses local `.credentials.yaml` and `settings.yaml`, but uses only the `openai-codex` record kind and whether an `apiKeyEnv` override exists; credential values are not retained, logged or uploaded. Its session rows do not preserve each request's auth method either, so current route configuration can reclassify historical usage. A custom `dsh`-format root still uses the current sidecars under `$DSH_HOME` or `~/.dsh` for this attribution.
- Hermes stores session/model aggregates rather than hourly rows. The tracker assigns an aggregate to its `last_seen` hour, preserving its total while approximating its hourly distribution.
- OpenClaw's current transcript DB records the exact Codex-OAuth route marker. Its managed Codex harness injects `chatgptAuthTokens` only in memory and does not write a managed `CODEX_HOME/auth.json`; those rollout files can be discovered for local diagnostics but never enter OAuth totals.
- Compressed Codex/OpenClaw `.jsonl.zst` rollouts and DeepSeek Harness `.jsonl.zstd` sessions prefer native Zstandard when available and otherwise use the bundled decoder, so compressed history works across supported runtimes. Plain `.jsonl` remains supported.
- DeepSeek Harness records are JSON-decoded locally so usage and model provenance can be read; prompt and response content is never retained, logged or uploaded by the tracker.

## 7. Command reference

Every command runs as `npx codex-token-tracker <command>`, or as `codex-tracker <command>` after a global install.

```
codex-tracker                 menu bar app (falls back to agent mode without a display)
codex-tracker agent [--once]  headless tracker/uploader
codex-tracker login|logout    connect / disconnect this device (login: --qr, --no-qr, --no-browser)
codex-tracker status          today's usage, live limits, sources, account
codex-tracker paths           detected session folders per agent
codex-tracker sync            rescan every agent + re-upload this device's full history
codex-tracker lang en|zh|auto display language
codex-tracker config get      all settings (uploadIntervalSec, trayTitle, sources.*, …)
codex-tracker config set <key> <value>
codex-tracker update [--check]  install the newest published version
```

Settings live in `~/.codex-tracker/config.json`; `~/.codex-tracker/pricing.json` overrides model prices.

## 8. Privacy

Only these leave your machine: token counts, model names, the agent name (codex / pi / …), the **folder name** of the project and a SHA-256 of its path, timestamps. Prompts, code, file contents and your Codex login token are never uploaded. Live rate limits are fetched by your own computer directly from chatgpt.com with your local Codex login.

## 9. FAQ

- **Which command do I run every day?** — `npx codex-token-tracker` (or turn on *Launch at login*). `login` is only needed once per computer.
- **Dashboard shows nothing** — is the tray app / agent running and signed in (`npx codex-token-tracker status` → *Signed in as …*)? Data appears within seconds of a session's activity (a few seconds after the tracker sees new usage; every minute otherwise).
- **The dashboard stopped updating** — it should never need a reload: the page re-establishes its realtime link on its own (also after your laptop wakes up), and the link indicator in the sidebar reads *Reconnecting…* while it does. If it stays there, check your network; a reload is never required for fresh data.
- **A machine appears twice under Devices** — it logged in twice with a version before 0.3.0. Update and restart the tracker on that machine; its first heartbeats merge the two entries into one (shown with a *2 logins* badge).
- **This machine's numbers look wrong / incomplete** — press **⟳ Sync** in the popover header (or run `codex-tracker sync`). It rescans every agent from scratch and re-uploads every still-present local record for this device. The idempotent API refreshes those records but does not delete older remote rows whose source file is no longer present. Do this after installing a new coding agent too.
- **"Electron is not installed"** — run `npm rebuild electron` (or use `codex-tracker agent`). On Linux/WSL the tray needs a display; agent mode does not.
- **Numbers differ from the Codex app's limits** — the Rate limits card should be within a minute of the Codex app; if it says *From logs*, your Codex login expired: open Codex once to refresh it.
- **I use two computers** — connect both; the dashboard sums all your devices. Two trackers on the *same* PC (e.g. Windows tray + WSL agent) are recognised as one machine and counted once.
- **Wrong day / hour** — everything is your machine's local time; the database stores UTC.
- **Lost a laptop** — Dashboard → Devices → Revoke.
