# Codex OAuth Agent Sources

## Task 1: Accounting foundation

**Acceptance criteria:**

- [x] OpenClaw's exact OAuth API marker is accepted and ordinary OpenAI Responses API-key traffic is rejected.
- [x] Cache-write and `reasoningTokens` fields retain correct token totals.

**Verification:** `pnpm --filter @codex-tracker/shared test`

**Dependencies:** None

**Files likely touched:** `packages/shared/src/pi-parser.ts`, `packages/shared/src/generic-parser.ts`, shared tests

## Task 2: Binary-store refresh

**Acceptance criteria:**

- [x] Binary databases are not rejected by the transcript text-size limit.
- [x] A SQLite WAL change invalidates the cached parse.

**Verification:** `pnpm --filter codex-token-tracker test`

**Dependencies:** Task 1

**Files likely touched:** source types/utilities, `packages/menubar/src/core/store.ts`, store tests

## Task 3: Current Codex and oh-my-pi records

**Acceptance criteria:**

- [x] Codex response-level records take precedence over coexisting cumulative records, and compressed rollouts use native or bundled streaming Zstandard decoding.
- [x] oh-my-pi current reasoning and model-usage records are handled without cross-provider leakage.

**Verification:** `pnpm --filter @codex-tracker/shared test && pnpm --filter codex-token-tracker test`

**Dependencies:** Task 1

**Files likely touched:** shared Codex/pi parsers, focused tests, Codex source

## Task 4: OpenClaw

**Acceptance criteria:**

- [x] Current state directory and override are discovered and tagged `openclaw`.
- [x] OAuth database events count, API-key events do not, and unauthenticated managed rollouts remain diagnostic-only.

**Verification:** `pnpm --filter codex-token-tracker test`

**Dependencies:** Tasks 1-2

**Files likely touched:** OpenClaw source, registry/config, source tests

## Task 5: Cline and Kilo Code

**Acceptance criteria:**

- [x] Current Cline message files and `kilo.db` are discovered alongside legacy extension tasks.
- [x] Only OAuth-discriminated OpenAI messages count by default with exact usage totals.

**Verification:** `pnpm --filter codex-token-tracker test`

**Dependencies:** Task 2

**Files likely touched:** Cline/Kilo sources, registry, source tests

## Task 6: Hermes

**Acceptance criteria:**

- [x] `session_model_usage` rows use `billing_provider` and all official token columns.
- [x] Other billing providers remain excluded by default.

**Verification:** `pnpm --filter codex-token-tracker test`

**Dependencies:** Task 2

**Files likely touched:** Hermes source and source tests

## Task 7: DeepSeek Harness

**Acceptance criteria:**

- [x] Raw `session.jsonl` and concatenated `session.jsonl.zstd` histories are discovered under `$DSH_HOME/sessions` or `~/.dsh/sessions` and tagged `dsh`.
- [x] Final messages replace provisional chunk usage within an attempt, failed retry attempts remain counted, inherited seed events are skipped, and disjoint cache buckets are combined once.
- [x] Default attribution requires exact `openai-codex` model provenance plus current local OAuth-route metadata; API-key overrides and unrelated providers are rejected.

**Verification:** `pnpm --filter codex-token-tracker test`

**Dependencies:** Task 1

**Files likely touched:** DeepSeek Harness source, registry/config, source tests

## Task 8: Documentation

**Acceptance criteria:**

- [x] Directly supported, indirectly covered, and skipped agents, paths, limitations, and config keys are accurate.
- [x] English and Chinese documentation stay paired.

**Verification:** Documentation diff review and link check where available

**Dependencies:** Tasks 3-7

**Files likely touched:** root/user/menubar documentation, i18n help, changelog

## Task 9: Final verification

**Acceptance criteria:**

- [x] Focused tests, typecheck, build, Node 16 compatibility, and five-axis review pass or any environment blocker is reported.
- [x] `git diff` and `git status` contain no accidental or generated changes.

**Verification:** Commands in `SPEC-codex-oauth-agent-sources.md`

**Dependencies:** Tasks 1-8

**Files likely touched:** `tasks/plan.md`, `tasks/todo.md`
