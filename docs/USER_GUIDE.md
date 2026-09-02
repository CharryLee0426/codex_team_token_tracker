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

## 3. Install the menu bar tool

Requirements: **Node.js 20 or newer** (`node -v`). Install Node from https://nodejs.org or with `nvm`.

```bash
npm install -g codex-token-tracker
codex-token-tracker login  # opens the dashboard; sign in and click "Approve"
codex-token-tracker        # starts the menu bar app
```

This gives you two interchangeable commands: **`codex-token-tracker`** and the shorter alias
`codex-tracker`. The rest of this guide uses the short one.

`codex-tracker login` prints a code such as `RHF7-DWW8` and opens `https://codex.chenli.dev/cli-auth?code=…`. Approve it in the browser and the terminal shows *Connected as <your name>*. The device now has its own token (revocable from **Dashboard → Devices**).

> **npm 11+ / pnpm 10+ block Electron's install script by default.** That's fine: the first `codex-tracker` run downloads the Electron runtime itself (~100 MB, once). To do it during install instead: `npm install -g codex-token-tracker --allow-scripts=electron`.

Tips
- Right-click the tray icon → **Launch at login** so it starts with your computer.
- The tray title shows today's tokens (e.g. `12.4k`); `codex-tracker config set trayTitle cost` shows dollars instead, `none` hides it.
- Upgrade later with `codex-token-tracker update` (or `npm install -g codex-token-tracker@latest`). The tray menu and the popover also offer an **Update** button when a new version is out.

### Windows

Works natively (system tray). If you use Codex inside **WSL2**, the Windows tray app also discovers the WSL session logs (`\\wsl$\<distro>\home\<you>\.codex`) — run **one** tracker per machine, not both.

### WSL2 / Linux servers (no tray)

```bash
npm install -g codex-token-tracker
codex-tracker login                 # prints the URL — open it in any browser
codex-tracker agent                 # headless: tracks + uploads, prints a status line
codex-tracker status                # today's usage, live limits, sources
```

Keep the agent running (tmux, `nohup`, or a `systemd --user` service).

## 4. What the menu bar shows

| Section | Meaning |
|---|---|
| **Today** | Tokens, API-equivalent cost, cache-hit %, requests — local day, this machine |
| **Sources** | Which tools consumed your Codex subscription (Codex, pi, …) |
| **Live** | Current session's project, model, generation speed (output tokens/second), context window use |
| **Rate limits** | **Live** weekly / 5-hour limits from your Codex account (same numbers as the Codex app), extra per-model limits, plan, "resets in …". Amber *From logs* means the live query failed (offline / expired Codex login) and the last logged value is shown |
| **Heatmap** | Last 16 weeks, this machine plus your other devices |
| **Models** | Tokens, share and cost per model; *est.* = model newer than the price table |

"API-equivalent cost" is what the same tokens would cost on the public OpenAI API at list prices — a way to compare usage, not a bill.

## 5. Dashboard tour

- **Personal** — only you (all your devices). **Team** — everyone in the organization, plus a member leaderboard.
- **Range chips** (Today · 7d · 30d · 90d · 1y) apply to every card.
- **Members** — roster, last seen, who is live. **Devices** — your connected computers; **Revoke** disconnects one.
- Header: organization switcher, language (EN / 中文), theme (light / dark / system).

## 6. Which agents are tracked

Everything that consumes your Codex subscription and keeps a local transcript:

| Agent | Notes |
|---|---|
| Codex CLI / Codex Desktop | exact numbers from `~/.codex/sessions` |
| pi | `~/.pi/agent/sessions`; only `openai-codex` calls count — API-key providers are ignored unless `codex-tracker config set trackAllProviders true` |
| OpenCode, Cline / Roo Code / Kilo Code, Hermes | best-effort readers; if your usage is missing run `codex-tracker paths` and tell your admin |
| Other tools | `codex-tracker config set extraSessionDirs '[{"path":"/path/to/logs","agent":"mytool","format":"generic"}]'` |

## 7. Command reference

```
codex-tracker                 menu bar app (falls back to agent mode without a display)
codex-tracker agent [--once]  headless tracker/uploader
codex-tracker login|logout    connect / disconnect this device
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

- **Dashboard shows nothing** — is the tray app / agent running and signed in (`codex-tracker status` → *Signed in as …*)? Data appears within a minute.
- **This machine's numbers look wrong / incomplete** — press **⟳ Sync** in the popover header (or run `codex-tracker sync`). It rescans every agent from scratch and re-uploads this device's whole history, replacing the dashboard's totals for it. Do this after installing a new coding agent too.
- **"Electron is not installed"** — run `npm rebuild electron` (or use `codex-tracker agent`). On Linux/WSL the tray needs a display; agent mode does not.
- **Numbers differ from the Codex app's limits** — the Rate limits card should be within a minute of the Codex app; if it says *From logs*, your Codex login expired: open Codex once to refresh it.
- **I use two computers** — connect both; the dashboard sums all your devices. Don't run two trackers that read the *same* logs (e.g. Windows tray + WSL agent on one PC).
- **Wrong day / hour** — everything is your machine's local time; the database stores UTC.
- **Lost a laptop** — Dashboard → Devices → Revoke.
