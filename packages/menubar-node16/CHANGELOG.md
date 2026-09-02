# Changelog

All notable changes to `codex-token-tracker-nodejs16`.

This package is the Node 16 build of [`codex-token-tracker`](https://www.npmjs.com/package/codex-token-tracker)
and carries **the same version number**, because it is built from the same sources. For what changed in the
application itself, see [that package's changelog](https://github.com/CharryLee0426/codex_team_token_tracker/blob/main/packages/menubar/CHANGELOG.md).
Entries here cover only what is specific to the Node 16 build.

## 0.2.1 — 2026-09-02

First release. Feature-identical to `codex-token-tracker` 0.2.1, installable on Node 16.8+.

### Added

- **Runs on Node 16.8 or newer** — and unchanged on Node 18 / 20 / 22, so a team can standardise on this
  package if some machines are pinned to an old runtime.
- **`dist/node16-polyfill.js`**, prepended to every Node-side bundle so it runs before any application or
  vendored code evaluates. It installs `fetch`/`Headers`/`Request`/`Response`/`FormData`/`File` from
  [undici](https://github.com/nodejs/undici) (the implementation Node 18 adopted as its built-in fetch),
  `Blob` from `node:buffer`, the stream classes from `node:stream/web`, WebCrypto `crypto` from
  `node:crypto`, and `structuredClone` via `node:v8`. Each is installed only when absent, so the polyfill is
  a no-op on newer Node and inside Electron.
- **`codex-token-tracker-node16`** as a third command name, for machines where the shared
  `codex-token-tracker` / `codex-tracker` names would be ambiguous.
- **`test:node16`**, which runs the upstream suites against this package's own bundle on a real Node 16
  binary (`node:test` is mapped onto a shim, since Node 16 has no test runner).

### Notes

- No application source of its own: the build bundles `../menubar/src`, so this package cannot drift from
  the Node 20 one. `scripts/sync-version.mjs` keeps the version aligned on every build.
- The renderer is built for Chromium 108 (Electron 22) rather than Chromium 128, so the popover still
  renders if an older Electron has to be used on an older OS.
- Hermes SQLite session sources are skipped, as they require `node:sqlite`. Not a regression — that module
  landed in Node 22.5, so the Node 20 build skips them as well.
- `codex-tracker update` checks and installs `codex-token-tracker-nodejs16`. Its update cache is stored
  separately from the Node 20 build's, so the two never report each other's published version.
