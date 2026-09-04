# Spec: Codex OAuth Agent Sources

## Objective

Track local token usage produced by every OpenRouter-ranked coding agent that has a verified, user-facing Codex/ChatGPT OAuth route. Preserve older storage readers while adding current formats, and exclude records that are identified as API-key traffic from all displayed, priced, and uploaded totals. When an upstream format lacks a per-request auth marker, use its current durable local auth discriminator and document that changing auth can reclassify history.

The audited target set is:

- Supported directly: Codex, pi, oh-my-pi (`omp`), Cline, Kilo Code, Hermes Agent, OpenClaw, and DeepSeek Harness (`dsh`).
- Covered through native Codex rollouts: Zazen/Freebuff can run a locally installed Codex using the existing provider account. Those rollouts are tagged `codex`; Freebuff exposes no distinct durable OAuth attribution for a separate source.
- Not integrated: Claude Code, whose public first-party login is for Anthropic services and which has no Codex / ChatGPT OAuth provider.

## Tech Stack

- Strict TypeScript in the existing pnpm monorepo.
- Existing `node:test` suites and source registry in `packages/menubar/src/core/sources`.
- Optional runtime `node:sqlite` access for current SQLite-backed stores; JSON/JSONL readers remain available on older runtimes.
- Small pure-JavaScript YAML and Zstandard dependencies support exact sidecar parsing and compressed Codex, OpenClaw, and DeepSeek Harness sessions on runtimes without native Zstandard.
- No outbound payload expansion or wire-version bump. The backend uses its existing session index and filters the small candidate set by normalized agent identity.

## Commands

- Focused shared tests: `pnpm --filter @codex-tracker/shared test`
- Focused menubar tests: `pnpm --filter codex-token-tracker test`
- Workspace typecheck: `pnpm typecheck`
- Menubar build: `pnpm --filter codex-token-tracker build`
- Node 16 compatibility: `pnpm test:node16`

There is no lint command in this repository.

## Project Structure

- `packages/shared/src` — provider filtering and JSON/JSONL usage normalization.
- `packages/menubar/src/core/sources` — discovery and parsing for each local agent store.
- `packages/menubar/src/core/store.ts` — incremental file/database indexing.
- `packages/menubar/src/core/sources/__tests__` — synthetic source fixtures and registry tests.
- Root, `docs`, and `packages/menubar` READMEs — paired English/Chinese user documentation where applicable.

## Code Style

Follow the existing source-definition pattern and stamp every parsed event with its owning agent:

```ts
export const exampleSource: SourceDefinition = {
  id: "example",
  label: "Example",
  format: "generic",
  discover: (ctx) => discoverExampleRoots(ctx),
  parse: (file, opts) => parseExample(file, opts),
};
```

DeepSeek Harness uses the dedicated `dsh` source identity and custom-directory format so its auth-sidecar and compressed-frame semantics stay distinct from generic JSONL readers.

Use two-space indentation, strict types at module boundaries, and narrow helpers instead of a new framework.

## Testing Strategy

- Add failing fixtures before each parser change.
- Prove both sides of the privacy boundary: Codex OAuth usage is counted, while same-model API-key usage is rejected.
- Cover default paths, environment overrides, source disabling, agent tagging, cache/reasoning accounting, and SQLite WAL refresh fingerprints.
- Run focused tests first, then typecheck/build and Node 16 compatibility checks.

## Boundaries

- Always: retain only local usage metadata needed for accounting; retain UTC millisecond timestamps; preserve idempotent rescans; keep legacy readers.
- Never: retain, log, or upload credential values, prompts, code, transcript content, full paths, or records carrying a non-Codex/API-key provider marker; deploy or publish. DeepSeek Harness credential/settings YAML is parsed locally, but only the auth-type discriminator and API-key-override presence are retained for attribution.

## Success Criteria

- OpenClaw current SQLite transcripts and managed Codex rollouts are discovered without double-counting. Exact Codex-auth database records count; managed rollouts stay diagnostic-only because their in-memory authentication is not persisted alongside them.
- Current Kilo `kilo.db` messages count only when its local OpenAI auth discriminator is OAuth; legacy Kilo VS Code tasks keep working.
- Current Hermes `session_model_usage.billing_provider = 'openai-codex'` aggregates are parsed, including cache-write and reasoning fields; legacy Hermes JSON/JSONL keeps working.
- Current Cline `~/.cline/data/sessions/<id>/<id>.messages.json` usage is parsed; legacy VS Code task storage keeps working.
- oh-my-pi recognizes its current `reasoningTokens` field and Codex-only model-usage records without counting unrelated providers.
- Current Codex `token_usage_record` entries and compressed `.jsonl.zst` rollouts are supported without also counting coexisting legacy cumulative events; pi behavior remains covered.
- DeepSeek Harness `assistant/message` and failed-attempt usage is read from raw or concatenated-Zstandard session logs, with exact `openai-codex` provenance and current local OAuth-route metadata required by default.
- Zazen/Freebuff native Codex rollouts remain covered by the `codex` source without inventing a separate attribution tag; Claude Code is the only audited target skipped for lack of Codex OAuth support.
- User documentation lists supported, indirectly covered, and intentionally unsupported agents and runtime limitations accurately in English and Chinese.

## Open Questions

None. The user's instruction to stop on agents without Codex OAuth resolves the unsupported-agent behavior; the repository's existing best-effort local-reader model resolves historical-format compatibility.
