import assert from "node:assert/strict";
import { test } from "node:test";

import { parseGenericSessionText } from "../generic-parser.ts";

test("generic parser rejects unsafe counters and totals below normalized components", () => {
  const text = [
    `{"timestamp":"2026-09-03T15:00:00.000Z","provider":"openai-codex","model":"valid","usage":{"input":10,"output":2,"cacheRead":3,"cacheWrite":1,"totalTokens":16}}`,
    `{"timestamp":"2026-09-03T15:00:01.000Z","provider":"openai-codex","model":"negative","usage":{"input":-1,"output":2,"totalTokens":1}}`,
    `{"timestamp":"2026-09-03T15:00:02.000Z","provider":"openai-codex","model":"fractional","usage":{"input":1.5,"output":2,"totalTokens":3.5}}`,
    `{"timestamp":"2026-09-03T15:00:03.000Z","provider":"openai-codex","model":"infinite","usage":{"input":1e309,"output":2,"totalTokens":1e309}}`,
    `{"timestamp":"2026-09-03T15:00:04.000Z","provider":"openai-codex","model":"unsafe","usage":{"input":9007199254740992,"output":2,"totalTokens":9007199254740994}}`,
    `{"timestamp":"2026-09-03T15:00:05.000Z","provider":"openai-codex","model":"undersized","usage":{"input":10,"output":2,"cacheRead":3,"cacheWrite":1,"totalTokens":15}}`,
    `{"timestamp":"2026-09-03T15:00:05.100Z","provider":"openai-codex","model":"cache-subset","usage":{"input_tokens":10,"output_tokens":2,"cached_input_tokens":11,"total_tokens":12}}`,
    `{"timestamp":"2026-09-03T15:00:05.200Z","provider":"openai-codex","model":"reasoning-subset","usage":{"input":10,"output":2,"reasoning":3,"totalTokens":12}}`,
    // OpenAI-style input already includes cached tokens, so total=input+output remains valid.
    `{"timestamp":"2026-09-03T15:00:06.000Z","provider":"openai-codex","model":"inclusive-input","usage":{"input_tokens":10,"output_tokens":2,"cached_input_tokens":3,"total_tokens":12}}`,
  ].join("\n");

  const session = parseGenericSessionText(text, "validated-generic", {
    agent: "generic",
    includeAllProviders: false,
  });
  assert.ok(session);
  assert.deepEqual(session.events.map((event) => event.model), ["valid", "inclusive-input"]);
  assert.equal(session.cumulative.total, 28);
});
