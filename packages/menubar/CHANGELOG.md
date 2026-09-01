# Changelog

All notable changes to `codex-token-tracker`. This project follows [Semantic Versioning](https://semver.org/).

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
