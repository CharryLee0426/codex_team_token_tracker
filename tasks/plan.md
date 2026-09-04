# Implementation Plan: Codex OAuth Agent Sources

## Overview

Audit the ten requested agents against official sources, then close gaps in the existing local source registry. The implementation keeps all parsing local and changes no outbound payload.

## Architecture Decisions

- Treat an agent as supported only when an official, user-facing Codex/ChatGPT OAuth flow and a local usage artifact are both verifiable.
- Reuse the source registry and existing parsers. Add optional SQLite readers behind runtime feature detection rather than adding a native dependency.
- Prefer OpenClaw's transcript database when available. Discover its managed Codex rollout directory only for local diagnostics because no durable OAuth discriminator is stored beside it.
- Keep current Kilo SQLite and legacy VS Code-extension roots under the same `kilo` identity.
- Add a dedicated `dsh` reader for DeepSeek Harness's raw and concatenated-Zstandard sessions. Require exact `openai-codex` provenance plus current OAuth-route metadata by default.
- Treat Zazen/Freebuff's locally installed Codex integration as native `codex` coverage because Freebuff exposes no separate durable OAuth attribution. Claude Code remains the only audited target skipped.

## Task List

### Phase 1: Accounting foundation

- [x] Task 1: Lock current OAuth markers and normalized cache/reasoning semantics with shared-parser tests.
- [x] Task 2: Add a WAL-aware binary-store refresh fingerprint.

### Checkpoint: Foundation

- [x] Shared and menubar focused tests pass.

### Phase 2: Source slices

- [x] Task 3: Update Codex and oh-my-pi for their current usage records and compressed rollouts.
- [x] Task 4: Add current OpenClaw database parsing plus diagnostic managed-rollout discovery.
- [x] Task 5: Add current Cline and Kilo storage while retaining legacy tasks.
- [x] Task 6: Correct Hermes current aggregate-schema parsing.
- [x] Task 7: Add DeepSeek Harness raw/compressed session parsing and OAuth attribution.

### Checkpoint: Sources

- [x] Synthetic fixtures prove OAuth inclusion, API-key exclusion, tagging, and totals.

### Phase 3: Documentation and verification

- [x] Task 8: Update paired user documentation, CLI help, and the changelog.
- [x] Task 9: Run focused tests, workspace typecheck/build, Node 16 compatibility, diff review, and five-axis code review.

### Checkpoint: Complete

- [x] All spec success criteria are met and the working tree contains no accidental changes.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| SQLite is unavailable on Node 16/20 | Current DB-backed formats cannot be read there | Keep JSON/JSONL fallbacks, fail closed, and document that DB readers require a runtime exposing `node:sqlite` |
| OpenClaw mirrors Codex-native rollouts without persisting its injected auth | Double-counted or misattributed usage | Prefer the attributable DB per agent; managed rollouts are local diagnostics only and are filtered out of final totals |
| Session IDs collide across different agents | One agent overwrites another remotely | Backend upserts normalize identity as `(device, agent, sessionId)` using the existing index; bump the local session-cache epoch so summaries replay once |
| New Codex records coexist with legacy cumulative records | Double-counted usage | Use response-level `token_usage_record` as authoritative for a rollout and fall back to cumulative deltas only when absent |
| Auth state changes after old Kilo messages | Historical auth type can be ambiguous | Count `providerID=openai` only while the persisted OpenAI auth discriminator is OAuth and document the limitation |
| Aggregate Hermes rows lack per-call timestamps | Historical hourly attribution is approximate | Attribute the aggregate at its official last-seen timestamp and state the limitation |
| DeepSeek Harness session rows omit the per-request auth method | Current route configuration can reclassify historical usage | Require exact model provenance, inspect only the current auth-type/API-key-override discriminators, and document the limitation |
| Compressed Codex/OpenClaw/DeepSeek Harness histories run on Node 16/20 | Native Zstandard is unavailable on those runtimes | Stream Codex/OpenClaw input and scan independent DSH frames, using the bundled decoder when native support is unavailable |

## Open Questions

- None blocking implementation.
