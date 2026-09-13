# Codex Token Tracker — Agent Guide

## Scope and context

- These instructions apply repository-wide. More-specific agent instruction files (`AGENTS.md` or `CLAUDE.md`) add to or override them for their subtree.
- Before editing, read the root `README.md`, the nearest package README when present, relevant tests, and the nested instruction file used by your agent tool.
- Keep changes scoped to the request. Follow existing local patterns before introducing a new abstraction or dependency.

## Project map

This is a strict-TypeScript pnpm monorepo. Use pnpm `11.15.1` and Node 22 or newer for repository development and full verification; CI uses Node 22. The primary tracker runtime supports Node 20 or newer; the compatibility package supports Node 16.8 or newer.

- `apps/dashboard`: Next.js 15 App Router UI with React 19, Clerk, Convex, next-intl, Tailwind CSS 4, and Recharts. Its nested `AGENTS.md` also applies.
- `packages/backend`: Convex schema, queries, mutations, actions, and HTTP endpoints. It is deployed from `apps/dashboard`.
- `packages/shared`: source-only parsers, pricing, aggregation, time helpers, device identity, and wire contracts shared across the system.
- `packages/menubar`: Electron tray app, headless agent, CLI, and local transcript source registry.
- `packages/menubar-node16`: compatibility build only. It bundles `packages/menubar/src`; do not duplicate application code here.
- `docs`: paired English and Simplified Chinese user/admin documentation.

Data flows from local transcript parsers in `packages/menubar/src/core/sources`, through shared UTC-hour aggregation and wire types, into Convex, and then to realtime dashboard subscriptions.

## Common commands

Run commands from the repository root unless a package README says otherwise.

- Install: `pnpm install` (`pnpm install --frozen-lockfile` for CI parity).
- Dashboard/backend development: run `pnpm dev:convex` and `pnpm dev` in separate terminals. `dev:convex` is stateful: it links or updates an external Convex development deployment and writes `.env.local`, so run it only when the task requires that external mutation and the user has authorized it.
- Guided-tour UI development: `pnpm dev:tour`.
- Menubar watch build: `pnpm dev:menubar`.
- Focused shared tests: `pnpm --filter @codex-tracker/shared test`.
- Focused menubar tests: `pnpm --filter codex-token-tracker test`.
- All available unit tests: `pnpm test`.
- All workspace type checks: `pnpm typecheck`.
- Full build: `pnpm build`.
- Convex bindings: `pnpm codegen`; run only when Convex API/schema changes require it and review the generated diff.
- Real Node 16 compatibility: `pnpm test:node16`; this needs Node 16 or `NODE16_BIN`.

There is no lint script or lint configuration. Do not claim that lint ran. Prefer focused checks while iterating, then run the relevant CI-equivalent gates before finishing. Dashboard changes have no unit-test script, so validate them with typecheck, build, and appropriate runtime/browser checks. Dashboard builds require configured environment values; for service-free verification, follow the placeholders in `.github/workflows/ci.yml`.

## Code and content conventions

- Follow `.editorconfig`: UTF-8, LF, two-space indentation, final newline, and no trailing whitespace except where Markdown needs it.
- Keep TypeScript strict. Reuse existing types and utilities rather than weakening types or duplicating logic.
- Match import style locally; conventions intentionally differ between workspaces. Do not normalize extensions or aliases repo-wide.
- Add or update `node:test` coverage for changed shared and menubar logic. Test observable behavior and regression boundaries, not implementation details.
- For dashboard UI copy, update both `apps/dashboard/src/messages/en.json` and `zh.json`.
- Keep paired English/Chinese docs in sync (`*.md` and `*.zh-CN.md`).
- Preserve dashboard accessibility, responsive behavior, keyboard/focus handling, and reduced-motion behavior. Keep theme-token changes synchronized between `apps/dashboard/src/lib/theme.ts` and `apps/dashboard/src/app/globals.css`.
- Keep dashboard data/subscription containers separate from reusable pure views where the existing code follows that pattern.
- Use `workspace:*` for internal dependencies. Generate `pnpm-lock.yaml` changes with pnpm rather than editing the lockfile by hand, and review lifecycle or supply-chain allowlist changes in `pnpm-workspace.yaml` narrowly.

## Backend and generated code

- Before changing any Convex code, read `packages/backend/convex/_generated/ai/guidelines.md`. Those current project-specific rules take precedence over remembered Convex patterns.
- Do not hand-edit generated Convex API/type files under `packages/backend/convex/_generated`. Generated Convex bindings are committed; regenerate them with `pnpm codegen` and review intended changes.
- Do not edit build output or caches such as `.next`, `dist`, `dist-test`, `*.tsbuildinfo`, or dependency directories.
- Treat wire and schema changes as compatibility-sensitive. Preserve support for deployed clients, update the advertised wire version deliberately, and prefer rollout-safe schema evolution.

## Product invariants and safety boundaries

- Store and transmit usage buckets as UTC milliseconds; convert to the viewer's local timezone only at display/grouping boundaries.
- Rescans, uploads, and reconciliation must remain idempotent; repeated ingestion must not double-count usage.
- Count only OpenAI/Codex usage. Do not price or report Anthropic, Google, local, or other providers as Codex usage.
- Privacy is a hard boundary: prompts, code, transcript contents, full paths, and raw hardware identifiers must not be uploaded. Credentials and tokens may be sent only to their intended authenticated endpoints and must never be logged, committed, or exposed. Preserve the reviewed payload contract in `packages/shared/src/wire.ts`; any new outbound field requires explicit privacy review and matching documentation.
- For a given user, one physical machine must remain one canonical device even across repeated logins, tray/headless clients, or aliases. Never merge or canonicalize devices across users.
- Menubar source changes also affect the Node 16 package. Keep both package versions aligned and verify the compatibility build when touching shared menubar paths. Its build runs version synchronization and may update `packages/menubar-node16/package.json`; inspect that diff rather than accepting it blindly.
- Ordinary menubar `build`/`dev` commands create a DEV build targeting localhost and separate local state. Only explicit `--release`, `prepack`, or publish flows produce production artifacts.
- Never deploy Convex or Vercel to production, publish packages, run release commands, or rotate credentials unless the user explicitly asks.
- Never commit local environment files, tokens, credentials, transcript data, or other secrets. `apps/dashboard/.env.example` is the tracked template and must contain placeholders only.

## Before handing off

- Inspect `git diff` and `git status`. Preserve unrelated or pre-existing changes; revert only changes you introduced and verified are accidental, and report unexpected changes.
- Run the narrowest relevant tests first, then the applicable typecheck/build gates.
- Report what changed, what was verified, and any checks that could not be run.
