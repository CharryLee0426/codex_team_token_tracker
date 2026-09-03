# Changelog

All notable changes to `codex-token-tracker`. This project follows [Semantic Versioning](https://semver.org/).

## 0.3.1 — 2026-09-02

oh-my-pi sessions are tracked.

### Fixed

- **oh-my-pi usage was never collected.** [oh-my-pi](https://github.com/can1357/oh-my-pi) (the `omp`
  command) is a pi fork that writes the same session transcripts as pi, but under `~/.omp/agent/sessions`
  instead of `~/.pi/agent/sessions` — a directory the tracker never looked at, so the Codex-subscription
  usage it produced was missing from every view. A new `omp` source (`sources.omp`, on by default) scans
  that directory, every oh-my-pi profile (`~/.omp/profiles/<name>/agent/sessions`), the XDG data
  directory oh-my-pi switches to when `$XDG_DATA_HOME/omp` exists, and `$PI_CODING_AGENT_SESSION_DIR`;
  `$PI_CONFIG_DIR` is honoured in place of `~/.omp`. The transcripts go through the pi reader, so only
  `openai-codex` messages count (every provider with `trackAllProviders`), and they appear tagged
  **oh-my-pi** (`omp`) in the popover, `codex-tracker status`, `codex-tracker paths` and on the
  dashboard. An `extraSessionDirs` entry with `"agent": "omp"` now defaults to the pi format.

## 0.3.0 — 2026-09-02

Approve a headless login from your phone, one device per machine, and a dashboard that stays live.

### Added

- **QR code login.** `codex-token-tracker login` now prints a QR code of the approval link next to the
  code and the URL, so a machine that cannot open a browser — WSL2, a build server, an SSH session, a
  desktop whose browser failed to launch — can still be approved: scan it with your phone, or open the
  link on any other computer, sign in and click *Approve*. The QR code appears automatically whenever
  no browser could be opened; `--qr` always prints it, `--no-qr` never does, and `--no-browser` skips
  the browser altogether. The popover's sign-in box shows the same QR code. The encoder is built in
  (no new dependency) and runs on Node 16 as well as Node 20. The terminal output is painted
  black-on-white explicitly so it scans on light and dark terminal themes alike.
- `login` now says how long the code stays valid and whether a browser was opened.

### Fixed

- **A machine that logged in twice was counted twice.** Every `login` created a new device on the
  dashboard and re-uploaded the machine's whole history under it, so running the tray app *and* the
  headless agent on one computer — or simply logging in again — doubled that machine's tokens in every
  view. The client now sends a hashed hardware identity (`machineId`: the IOPlatformUUID on macOS, the
  registry MachineGuid on Windows — also from inside WSL, so a WSL agent and a Windows tray app on the
  same PC agree — `/etc/machine-id` on Linux; only its SHA-256 leaves the machine), and the backend keeps
  **one device per machine per user**: a repeat login becomes an alias whose token writes into the
  existing device. Devices created by older versions are reconciled on their first heartbeat after
  the update: two device rows of yours with the same hostname and *identical* hourly counts are
  recognised as the same computer and merged, so existing duplicates disappear on their own once the
  tracker is restarted with 0.3.0. Nothing is summed during a merge — where both rows hold an hour the
  fresher copy wins. The Devices page lists each machine once and shows a *2 logins* badge when both
  a tray app and an agent are connected.
- **A second login no longer signs the first process out.** The tray app and the agent share the
  config file; when one of them logs in again the other now adopts the new token instead of hitting
  *BAD_TOKEN*, signing out, and wiping the token the other had just stored.
- **The dashboard follows a running session within seconds.** New local usage now triggers a push
  ~5 s after it is seen (at most every 15 s) instead of waiting for the next 60 s upload tick.

### Changed

- Wire protocol version 2. The client reads the backend's version from `<dashboard>/api/config` and
  only sends `machineId` to backends that understand it, so an updated tracker keeps working against a
  dashboard that has not been redeployed yet (it just does not get the one-device-per-machine fix).
  `config.json` gains a cached `wireVersion`.
- Heartbeats from an alias login do not relabel the machine's platform or hostname on the dashboard.

## 0.2.2 — 2026-09-02

Installs on machines that cannot download Electron.

### Fixed

- **`npm install -g` no longer runs Electron's install script.** `electron` was an optional dependency, and
  `menubar` declared it as a hard peer dependency, so every install ran Electron's `install.js` — a ~100 MB
  download from GitHub. When that download failed (firewalled build servers, no proxy) npm aborted the
  **entire** install instead of skipping the optional package — Node 16's npm 8 does so outright, npm 11 does
  the same once the script runs — and the retry died with
  `Cannot find module …/node_modules/electron/install.js`, leaving the machine unable to install the tracker
  even for headless use. Neither package is a dependency any more: `menubar` is bundled into `dist/main.js`,
  and the CLI downloads the Electron runtime itself on first GUI launch into
  `~/.codex-tracker/electron/<version>/` — the same downloader 0.1.1 added for package managers that skip
  install scripts — honouring `ELECTRON_MIRROR` and `HTTPS_PROXY`. A globally installed `electron` is still
  preferred when present. Headless machines never download Electron at all, and a plain install is ~40
  packages instead of ~75.

### Changed

- The *Electron download failed* message now points at `ELECTRON_MIRROR` / `HTTPS_PROXY` and
  `codex-tracker menubar` rather than `npm rebuild electron`.

## 0.2.1 — 2026-09-01

A manual **Sync** button that recalibrates this device's numbers on the dashboard.

### Added

- **Full sync.** The popover header gets a **⟳** button (also *Sync now* in the Account card and the tray
  menu, and `codex-token-tracker sync` on the CLI). Unlike the background upload — which every 60 s pushes
  only the hour buckets and sessions that changed — a full sync throws away every cache on the way:
  1. re-reads the config, so agents enabled since start-up are picked up;
  2. re-discovers every session directory and re-parses every transcript from scratch — Codex plus the
     coding agents running on your Codex subscription (pi, OpenCode, Cline / Roo / Kilo, Hermes) and any
     configured `extraSessionDirs` — instead of skipping files whose size and mtime are unchanged;
  3. recomputes the aggregates with the current pricing table;
  4. re-uploads **everything**, so the dashboard's totals for this device are replaced by the freshly
     computed ones;
  5. pulls the other devices' rows and the live rate limits back down.

  Use it when a machine's numbers look wrong, after installing a new agent, or after an update that
  changes the pricing table. It is manual only — never on a timer — because it re-sends the whole history.
- A banner in the popover reports the phase while a sync runs (*Rescanning every agent's transcripts…*,
  *Re-uploading this device's history…*) and then the result, e.g. `Synced codex, pi · 75 files ·
  75 sessions · 70 hours re-uploaded`. Signed out, the rescan still runs and nothing leaves the machine.
- `codex-token-tracker sync` prints the same summary and exits non-zero if the sync failed.

- **Dev builds target the dev environment.** A build now carries its channel, stamped by
  `scripts/build.mjs`: only `--release` (what `prepack` runs) produces a production build, so every
  published tarball is prod and every local `pnpm build` / `pnpm dev` is dev. A dev build
  - defaults to the local dashboard `http://localhost:3000` instead of `https://codex.chenli.dev`, and
    therefore uploads to whatever Convex deployment that dashboard advertises — the dev one;
  - keeps its config, device token and upload state in `~/.codex-tracker-dev`, so a local run can
    never overwrite the production token or the record of what was already pushed to production;
  - defaults `checkUpdates` to `false` and refuses `codex-token-tracker update`, which would otherwise
    install the published package over the checkout;
  - runs as `Codex Tracker (dev)` with its own Electron userData directory and macOS LaunchAgent, so it
    can run **beside** an installed copy instead of fighting it for the single-instance lock;
  - shows an orange **DEV** badge in the popover header and names its dashboard and config directory in
    `--version`, `status` and `paths`.

  `--dashboard <url>`, `config set dashboardUrl` and `CODEX_TRACKER_HOME` still override all of it.

### Changed

- `Uploader.pushAll()` takes a `{ full }` option that clears the pushed-buckets/pushed-sessions record
  before building the payload, and waits for an in-flight incremental push instead of skipping the call.
- `SessionStore.reset()` drops the parsed-file index so a following deep refresh re-reads everything.
- Packaging scripts: `build:release` builds with the prod channel; `prepack` runs it (so `npm pack` and
  `npm publish` always ship a prod build) and `postpack` restores the dev build in `dist/`.
  `prepublishOnly` now only typechecks.
- `app.setName()` moved ahead of `requestSingleInstanceLock()` — the lock is keyed on the userData
  directory, which is derived from the name.

## 0.2.0 — 2026-09-01

Pricing accuracy, an honest tokens/s number, and self-update.

### Added

- **`codex-token-tracker` command.** Installing globally now puts **two** equivalent executables on your
  PATH — `codex-token-tracker` (matching the package name) and the existing `codex-tracker` alias. Both
  run the same CLI; nothing you already scripted breaks.
- **Self-update.** `codex-token-tracker update` checks the npm registry and installs the newest release
  with the package manager this copy came from (npm / pnpm / yarn / bun). `--check` reports without
  installing. The menu bar app shows an **Update** banner and a *Check for updates* item in the tray
  menu; installing from there asks you to restart to apply.
  - Checks are cached for 6 h in `~/.codex-tracker/update.json` and send no usage data or identifiers.
  - Disable with `config set checkUpdates false`; point at a mirror with `CODEX_TRACKER_REGISTRY`.
  - `codex-tracker status` prints a one-line notice when a newer version exists.
- **Long-context pricing tiers.** Models that OpenAI bills at a higher rate above 272K input tokens
  (`gpt-5.4`, `gpt-5.5`, the `gpt-5.6-*` family and their `-pro` variants) are now priced per request at
  the correct tier instead of always at the standard rate.
- New config key `checkUpdates` (default `true`).

### Changed

- **Pricing table rebuilt** from <https://developers.openai.com/api/docs/pricing>. Adds `gpt-5.6-sol`,
  `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.6-cyber`, `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.5-cyber`, `gpt-5.4`,
  `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.4-pro`, `gpt-5.3-codex`, `gpt-5-search-api` and `chat-latest`,
  plus explicit `-codex` entries so Codex CLI model ids resolve exactly rather than through the family
  fallback. Models in current use — `gpt-5.6-sol` above all — are now exact matches and lose the *est.*
  badge. The catch-all fallback moved from `gpt-5.2` to `gpt-5.3-codex`.
- **Codex-only accounting.** Usage on non-OpenAI models is dropped from totals, cost, the model mix, the
  heatmap and uploads. Sources such as Cline/Roo/Kilo and OpenCode can drive Anthropic, Google or local
  models; costing those against an OpenAI price table produced meaningless dollars. The dashboard also
  filters rows and sessions uploaded by older clients.

### Fixed

- **Live tokens/s was wildly overstated** (6,000+ tok/s where the real rate is tens). Each request's
  `input` counts the *entire prompt re-sent for that turn* — hundreds of thousands of context tokens —
  so summing `total` over a 60 s window measured context replay, not generation. The rate is now
  **output tokens only**, and the divisor is clamped to the part of the window the session has actually
  existed for, so a session seconds old is not diluted by time that never happened. The 10 s burst
  figure is computed the same way.

## 0.1.1 — 2026-08-31

### Fixed

- Self-install the Electron runtime on first run when npm ≥ 11 / pnpm ≥ 10 skipped its install script.

## 0.1.0 — 2026-08-31

First public release: macOS menu bar app, Windows tray app, headless `agent` mode, Codex/pi/OpenCode/
Cline/Roo/Kilo/Hermes session readers, live rate limits, activity heatmap, device-code login and
dashboard sync.
