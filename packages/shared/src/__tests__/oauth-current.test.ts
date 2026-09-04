import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGenericSessionText } from "../generic-parser.ts";
import { isCodexAuthProvider } from "../pi-parser.ts";

test("OpenClaw's ChatGPT transport is Codex OAuth, but OpenAI Responses is not", () => {
  assert.equal(isCodexAuthProvider("openai-codex"), true);
  assert.equal(isCodexAuthProvider("openai", "openai-chatgpt-responses"), true);
  assert.equal(isCodexAuthProvider("openai", "openai-responses"), false);
  assert.equal(isCodexAuthProvider("codex-proxy"), false);
  assert.equal(isCodexAuthProvider("openai", "openai-codex-cli"), false);
  for (const ambiguous of ["codex", "chatgpt", "openai-chatgpt"]) {
    assert.equal(isCodexAuthProvider(ambiguous), false, `${ambiguous} is not a current durable OAuth discriminator`);
  }
  assert.equal(
    isCodexAuthProvider("anthropic", "openai-chatgpt-responses"),
    false,
    "an OAuth API marker must still belong to the OpenAI provider",
  );
});

test("generic parser reads nested OpenClaw OAuth attribution and normalized usage", () => {
  const oauth = JSON.stringify({
    type: "message",
    timestamp: "2026-09-01T10:00:00.000Z",
    message: {
      role: "assistant",
      api: "openai-chatgpt-responses",
      provider: "openai",
      model: "gpt-5.3-codex",
      usage: {
        input: 50,
        cacheRead: 20,
        cacheWrite: 5,
        output: 15,
        reasoningTokens: 4,
        totalTokens: 90,
      },
    },
  });
  const apiKey = JSON.stringify({
    type: "message",
    timestamp: "2026-09-01T10:01:00.000Z",
    message: {
      role: "assistant",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.3-codex",
      usage: { input: 7, output: 3, totalTokens: 10 },
    },
  });

  const session = parseGenericSessionText(`${oauth}\n${apiKey}`, "openclaw-session", { agent: "openclaw" });
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.deepEqual(session.events[0].usage, {
    input: 75,
    cached: 20,
    cacheWrite: 5,
    output: 15,
    reasoning: 4,
    total: 90,
    requests: 1,
  });
});

test("generic parser never inherits OAuth provider or model from a previous usage record", () => {
  const explicit = JSON.stringify({
    timestamp: "2026-09-01T10:00:00.000Z",
    provider: "openai-codex",
    model: "gpt-5.3-codex",
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  });
  const unattributed = JSON.stringify({
    timestamp: "2026-09-01T10:01:00.000Z",
    usage: { input_tokens: 50, output_tokens: 5, total_tokens: 55 },
  });

  const session = parseGenericSessionText(`${explicit}\n${unattributed}`, "mixed", { agent: "generic" });
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.equal(session.cumulative.total, 12);
  assert.equal(session.provider, "openai-codex");
  assert.equal(session.model, "gpt-5.3-codex");
});

test("generic parser accepts explicit enclosing-document provider and model context", () => {
  const session = parseGenericSessionText(JSON.stringify({
    provider: "openai-codex",
    model: "gpt-5.3-codex",
    messages: [{
      timestamp: "2026-09-01T10:00:00.000Z",
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
    }],
  }), "document-context", { agent: "generic" });

  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.equal(session.events[0].provider, "openai-codex");
  assert.equal(session.events[0].model, "gpt-5.3-codex");
});
