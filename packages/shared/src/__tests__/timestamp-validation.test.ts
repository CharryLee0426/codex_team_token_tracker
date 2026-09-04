import assert from "node:assert/strict";
import test from "node:test";
import { parseSessionText } from "../codex-parser.ts";
import { parseGenericSessionText } from "../generic-parser.ts";
import { parsePiSessionText } from "../pi-parser.ts";

test("shared transcript parsers never retain non-finite numeric timestamps", () => {
  const pi = parsePiSessionText(
    '{"type":"model_usage","timestamp":1e309,"provider":"openai-codex","model":"gpt-5","usage":{"input":1,"output":2,"totalTokens":3}}',
    "pi",
  );
  const generic = parseGenericSessionText(
    '{"timestamp":1e309,"provider":"openai-codex","model":"gpt-5","usage":{"input":1,"output":2,"totalTokens":3}}',
    "generic",
    { agent: "test" },
  );
  const codex = parseSessionText(
    '{"timestamp":1e309,"type":"token_usage_record","payload":{"response_id":"response-1","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}',
    "codex",
  );

  for (const session of [pi, generic, codex]) {
    assert.ok(session);
    assert.ok(Number.isFinite(session.startedAt));
    assert.ok(Number.isFinite(session.lastActivityAt));
    assert.ok(session.events.every((event) => Number.isFinite(event.ts)));
  }
});
