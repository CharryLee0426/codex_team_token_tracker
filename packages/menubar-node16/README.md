# codex-token-tracker-nodejs16

The **Node.js 16 build** of [`codex-token-tracker`](https://www.npmjs.com/package/codex-token-tracker) — the
menu bar / system tray app and headless agent that tracks OpenAI Codex token usage, cache hits, model mix
and API-equivalent cost, and syncs it to your team dashboard.

Same app, same features, same version number. The only difference is the runtime it can be installed on:

| | `codex-token-tracker` | `codex-token-tracker-nodejs16` |
|---|---|---|
| Node | 20 or newer | **16.8 or newer** (also runs on 18 / 20 / 22) |
| Features | all | all |
| Dashboard / wire protocol | identical | identical |

**Use the regular package unless your machine is pinned to Node 16.** This one exists for build boxes and
older dev machines whose OS cannot go past Node 16.

## Install

```bash
npx codex-token-tracker-nodejs16 login   # first time: sign in and approve the device
npx codex-token-tracker-nodejs16         # then: menu bar app, or headless agent where there is no display
# or install it: npm install -g codex-token-tracker-nodejs16, then `codex-tracker`
```

It installs the same `codex-token-tracker` and `codex-tracker` commands as the regular package, plus
`codex-token-tracker-node16` if you need to disambiguate. Because the command names overlap, install **one
of the two packages per machine**, not both.

Everything else — commands, configuration, sources, sync, rate limits, what gets uploaded — is documented in
the [main README](https://github.com/CharryLee0426/codex_team_token_tracker/tree/main/packages/menubar#readme).

## Why a separate package

Node 16 reached end of life in September 2023 and never shipped a global `fetch`. Rather than hold the main
package back, the Node 16 support lives here:

- **One source tree.** This package contains no application code. Its build bundles `../menubar/src` — the
  exact same sources the Node 20 package ships — so the two cannot drift apart in features.
- **`target: node16`.** esbuild downlevels any syntax Node 16 cannot parse.
- **A polyfill prelude.** `dist/node16-polyfill.js` is prepended to every Node-side bundle and installs the
  web globals Node 16 lacks, sourced from [undici](https://github.com/nodejs/undici) — which is the very
  implementation Node 18 adopted as its built-in `fetch`:

  | Global | Source | Missing before |
  |---|---|---|
  | `fetch`, `Headers`, `Request`, `Response`, `FormData`, `File` | `undici` | Node 18 |
  | `Blob` | `node:buffer` | Node 18 |
  | `ReadableStream`, `WritableStream`, `TransformStream` | `node:stream/web` | Node 18 |
  | `crypto` (WebCrypto) | `node:crypto` | Node 19 |
  | `structuredClone` | `node:v8` | Node 17 |

  Every one is installed **only if absent**, so the same bundle is unchanged on newer Node and inside
  Electron — where the polyfill is a no-op.

## Requirements and caveats

- **Node >= 16.8.** 16.8 is the first release undici's `fetch` supports; 16.20.2 is the last 16.x. Running an
  older Node prints a clear message instead of a syntax error.
- **Electron is not an npm dependency of this package.** Node 16's npm (8.x) aborts an entire global
  install when an optional dependency's install script fails, so on a machine that could not reach GitHub
  the tracker could not be installed at all — not even for headless use — and the retry died with
  `Cannot find module …/node_modules/electron/install.js`. Since 0.2.2, `npm install -g` never runs
  Electron's installer. On a machine with a display, the first `codex-tracker` (or `codex-tracker menubar`)
  downloads the runtime itself — about 100 MB, once — into `~/.codex-tracker/electron/<version>/`, honouring
  `ELECTRON_MIRROR` (for example `https://npmmirror.com/mirrors/electron/`) and `HTTPS_PROXY`. Without a
  display the app runs headless — `codex-tracker agent` — which does all the tracking and uploading and never
  touches Electron. If your OS is too old for Electron 38, install an older one alongside
  (`npm i -g electron@22`): a globally installed `electron` is picked up first, and the renderer is built for
  Chromium 108 so it still works.
- **Hermes SQLite sources are skipped**, because they need `node:sqlite`. This is not a regression: that
  module only arrived in Node 22.5, so the Node 20 build skips them too.
- **Self-update stays on this package.** `codex-tracker update` checks and installs
  `codex-token-tracker-nodejs16`, never the Node 20 package.

## Development

Built from the monorepo; it needs `../menubar/src` present.

```bash
pnpm --filter codex-token-tracker-nodejs16 build          # dev build
pnpm --filter codex-token-tracker-nodejs16 build:release   # what prepack/publish runs
pnpm --filter codex-token-tracker-nodejs16 typecheck
pnpm --filter codex-token-tracker-nodejs16 test            # suites on the current Node
pnpm --filter codex-token-tracker-nodejs16 test:node16      # suites on a real Node 16
```

`test:node16` finds the newest Node 16 under `~/.nvm/versions/node`, or uses `NODE16_BIN`. It runs the
upstream suites against the node16 bundle, with `node:test` mapped onto a small shim since Node 16 has no
test runner.

### End-to-end

```bash
pnpm e2e:node16            # from the repo root
pnpm e2e:node16:gui        # also downloads Electron (~100 MB) and launches the tray app
```

This does what a user does: builds a release, packs a tarball, installs it with **Node 16's own npm**
under `--engine-strict`, and drives the installed binary on a real Node 16 — 36 checks across the
polyfill, the CLI surface, the self-updater and a headless agent cycle.

The load-bearing assertion is **differential**: the same synthetic Codex fixtures are fed to both the
Node 16 build (on Node 16) and the Node 20 build (on your Node), and the two `status --json` reports must
be byte-identical once timestamps are masked. A port that silently drops a source, mis-parses a number or
takes a different branch cannot pass that.

The run is hermetic — `CODEX_TRACKER_HOME` sends config, state and the update cache to a temp dir (so the
run is signed out and **nothing can upload**), `CODEX_HOME` and friends point the scanner at fixtures
rather than your real sessions, and local stub servers stand in for the npm registry and the dashboard, so
it needs no network. It restores your dev builds and deletes its scratch directory on the way out; pass
`--keep` to inspect it.

The version is kept identical to `codex-token-tracker` by `scripts/sync-version.mjs`, which every build runs.

## License

MIT © Chen Li
