# Changelog

All notable changes to `codex-token-tracker`. This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

Run it with `npx` — nothing to install.

### Added

- **Current Codex-OAuth storage support across the audited agent set.** The tracker now understands the
  current local usage formats for Codex CLI/Desktop, pi, oh-my-pi, Cline, Kilo Code, Hermes Agent,
  OpenClaw and DeepSeek Harness while retaining their older readers:
  - Codex `token_usage_record` events (de-duplicated by response id) and compressed `.jsonl.zst` rollouts;
  - pi assistant usage plus oh-my-pi `model_usage` / `reasoningTokens` records;
  - Cline v1 message envelopes under `~/.cline/data/sessions` and its current legacy-task location, with
    `CLINE_SESSION_DATA_DIR` → `CLINE_DATA_DIR` → `CLINE_DIR/data` precedence;
  - current Kilo `kilo*.db` assistant messages, classified as Codex OAuth using only the Kilo data root's
    `auth.json` entry `type` discriminator (credential values are not retained, logged, or uploaded);
  - Hermes `session_model_usage` rows, including cache writes, reasoning, request counts and profiles;
  - OpenClaw per-agent transcript databases and attributable legacy sessions. Managed Codex rollouts remain
    discoverable for local diagnostics, but never enter OAuth totals because OpenClaw injects their auth in
    memory instead of persisting an auth discriminator beside the rollout.
  - DeepSeek Harness `assistant/message` usage from `$DSH_HOME/sessions` / `~/.dsh/sessions`, including
    concatenated independent `session.jsonl.zstd` frames and failed-attempt usage samples. Only exact
    `openai-codex` provenance with current OAuth route metadata enters OAuth totals. Local credentials/settings
    YAML is parsed, but only its route discriminators are used; credential values are not retained, logged or uploaded.
    Custom session roots can select the first-class `dsh` format.
- **The OpenRouter-ranked agent audit has explicit coverage decisions.** Claude Code is not integrated because
  it has no public Codex / ChatGPT OAuth provider. Zazen (the Freebuff fork) can run a locally installed Codex,
  whose native rollouts are already covered by `codex`; it exposes no distinct durable OAuth attribution for a
  separate source. Existing OpenCode and Roo readers remain enabled as best-effort compatibility integrations.

### Changed

- **Pricing table refreshed from developers.openai.com (2026-09-05).** GPT-6 Astra (`gpt-6-astra`) is listed
  at $10 input / $1 cached / $12.50 cache writes / $50 output per 1M tokens, with prompts above 272K input
  tokens billing the whole request at 2× input and cache rates and 1.5× output; it was previously priced
  through the global fallback (`gpt-5.3-codex`, $1.75 / $14) and marked *est.* The documented `gpt-5.6` alias
  resolves to `gpt-5.6-sol`, and GPT-6 / GPT-5.6 cache writes bill at 1.25× input in both tiers instead of the
  plain input rate. Run `codex-tracker sync` after updating so this machine's history is re-priced; other
  machines keep their previously uploaded costs until they sync.
- SQLite-backed Kilo, Hermes and OpenClaw stores are read when the runtime exposes `node:sqlite` (Node 22.5+
  and the current Electron runtime). Older Node processes use any attributable legacy JSON/JSONL or VS Code-task
  fallback; SQLite-only history is unavailable. Hermes aggregate rows are assigned
  to their `last_seen` hour, so their totals are preserved but hourly distribution is approximate. Kilo's
  current auth type can reclassify historical `providerID: openai` rows after an OAuth/API-key switch.
- Codex/OpenClaw `.jsonl.zst` rollouts and DeepSeek Harness `.jsonl.zstd` sessions prefer native Zstandard
  when available and otherwise use the bundled decoder, including on supported older Node runtimes. Plain
  `.jsonl` remains supported.
- Native Codex rollout usage now fails closed unless the current `auth.json` explicitly identifies ChatGPT
  login or contains a structurally valid legacy OAuth token bundle. Keyring-only and ephemeral authentication
  cannot be proven from a rollout and is therefore omitted; no credential value is retained, logged or uploaded.
  Because upstream rollouts lack a per-request auth field, changing the current Codex login between ChatGPT
  and API-key modes reclassifies historical rollouts on the next scan.
- **`npx codex-token-tracker` is the documented way to run the tracker.** `npx codex-token-tracker login`
  the first time on a computer, `npx codex-token-tracker` every day after (or *Launch at login*): npx
  resolves the newest published version on every start, so there is nothing to keep up to date. A global
  `npm i -g codex-token-tracker` still works and still provides the short `codex-tracker` alias.
- **`update` knows when it was started with npx.** A copy running out of npm's exec cache used to answer
  `update` (and the popover's *Update* button) with a global install it never asked for. It now reports
  the newer version and says to quit and run `npx codex-token-tracker` again, which fetches it; `--check`
  is unchanged. `UpdateInfo` carries an `installMethod` (`global` | `npx`) and `command` is the start
  command under npx. `--help` mentions the npx form.

### Fixed

- **Agent session summaries no longer collide when two agents reuse the same session id.** Backend upserts and
  device merges now identify a summary by `(device, agent, sessionId)`, while adopting legacy agent-less rows as
  native Codex. The client replays its cached summaries once so previously collapsed records can be restored.
- **Only Codex-OAuth events can reach statistics or uploads, even with `trackAllProviders` enabled.** Session
  metadata and cumulative totals are rebuilt from the retained events; API-key and non-OpenAI sessions are
  removed before pricing and upload. DeepSeek Harness also stamps an exact route as unverified unless its
  current sidecar proves OAuth, so diagnostic parsing cannot turn API-key usage into uploadable usage.
- **Parallel Codex sessions and subagents no longer make usage totals move backward.** A child rollout
  keeps its own identity when it contains inherited parent metadata, cumulative usage stays additive
  across Codex counter resets, and the scanner keeps the last valid snapshot during transient rewrites,
  filesystem errors, overlapping scans, or full rescans. Plain rollouts larger than 50 MiB are parsed
  line by line instead of disappearing.
- **Compressed Codex/OpenClaw histories work on Node 16 and 20 without native Zstandard.** The bundled
  decoder streams `.jsonl.zst` input when no native decoder exists, and an oversized non-usage record is
  discarded without hiding later usage records.
- **Large Cline snapshots are parsed with bounded memory.** Prompt and tool strings are discarded while
  streaming `*.messages.json`; a torn or malformed rewrite retains the last valid usage snapshot for retry.
- **OpenCode accounting now includes separately stored reasoning tokens without double-counting totals.**
  Inconsistent reported totals fall back to recombined counters, and prompt-derived session titles are never
  reused as uploaded project metadata.
- **Generic JSON/JSONL attribution no longer crosses record boundaries.** A provider, API, or model must be
  present on the usage record/message or its enclosing document; a previous record cannot lend it an OAuth
  identity. Hermes discovery now consistently defaults to `<user-home>/.hermes` on every operating system.
- **Kilo's current database is discovered in each platform's official data directory:** `%LOCALAPPDATA%\kilo`
  on Windows, `~/Library/Application Support/kilo` on macOS, and `$XDG_DATA_HOME/kilo` on Linux.
- **OpenClaw forked sessions no longer multiply copied parent usage.** Durable transcript event/message ids
  are de-duplicated within each agent database while independent id-less usage rows remain countable.

### Upgrade note

- Deploy the backend's `(device, agent, sessionId)` session identity before distributing this client. If an
  older client used `trackAllProviders`, it may already have uploaded API-key OpenAI rows; the upsert-only wire
  protocol cannot safely infer deletions. Back up Convex, remove that device's `hourlyUsage` and `sessions`
  rows, then run `codex-tracker sync` on the device. Revoking the device does not delete its usage.

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
  `openai-codex` messages enter accounting (`trackAllProviders` may retain other providers only for local
  diagnostics), and they appear tagged **oh-my-pi** (`omp`) in the popover, `codex-tracker status`,
  `codex-tracker paths` and on the
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
  4. re-uploads every still-present local record. Existing rows are refreshed idempotently; this protocol
     does not delete older remote rows whose source file is no longer present;
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
