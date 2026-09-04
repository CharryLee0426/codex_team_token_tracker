import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePiSessionText } from "../pi-parser.ts";

test("pi parser counts current OMP model_usage records", () => {
  const text = [
    `{"type":"session","id":"omp-session","timestamp":"2026-09-03T10:00:00.000Z","cwd":"/tmp/omp-project"}`,
    `{"type":"title","id":"title-1","timestamp":"2026-09-03T10:00:01.000Z","title":"Current OMP session"}`,
    `{"type":"model_usage","id":"usage-1","timestamp":"2026-09-03T10:00:02.000Z","purpose":"response","api":"openai-chatgpt-responses","provider":"openai","model":"gpt-5.3-codex","usage":{"input":11,"output":7,"cacheRead":19,"cacheWrite":3,"reasoningTokens":4}}`,
  ].join("\n");

  const session = parsePiSessionText(text, "fallback");
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.deepEqual(session.events[0], {
    ts: Date.parse("2026-09-03T10:00:02.000Z"),
    model: "gpt-5.3-codex",
    provider: "openai-codex",
    agent: "pi",
    usage: {
      input: 33,
      cached: 19,
      cacheWrite: 3,
      output: 7,
      reasoning: 4,
      total: 40,
      requests: 1,
    },
  });
  assert.deepEqual(session.cumulative, session.events[0].usage);
});

test("pi parser keeps assistant messages and prefers provider totalTokens", () => {
  const text = [
    `{"type":"session","id":"pi-session","timestamp":"2026-09-03T11:00:00.000Z"}`,
    `{"type":"message","id":"message-1","timestamp":"2026-09-03T11:00:01.000Z","message":{"role":"assistant","api":"openai-codex-responses","provider":"openai-codex","model":"gpt-5.3-codex","usage":{"input":11,"output":7,"cacheRead":2,"cacheWrite":3,"reasoning":5,"reasoningTokens":6,"totalTokens":24}}}`,
  ].join("\n");

  const session = parsePiSessionText(text, "fallback");
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.deepEqual(session.events[0].usage, {
    input: 16,
    cached: 2,
    cacheWrite: 3,
    output: 7,
    reasoning: 5,
    total: 24,
    requests: 1,
  });
});

test("pi parser filters non-Codex model usage and ignores unrelated usage records", () => {
  const text = [
    `{"type":"session","id":"mixed-session","timestamp":"2026-09-03T12:00:00.000Z"}`,
    `{"type":"model_usage","id":"codex-usage","timestamp":"2026-09-03T12:00:01.000Z","api":"openai-codex-responses","provider":"openai-codex","model":"gpt-5.3-codex","usage":{"input":10,"output":2,"cacheRead":5,"cacheWrite":1,"reasoningTokens":1,"totalTokens":18}}`,
    `{"type":"model_usage","id":"anthropic-usage","timestamp":"2026-09-03T12:00:02.000Z","api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-4-5","usage":{"input":20,"output":3,"cacheRead":0,"cacheWrite":0,"reasoningTokens":0,"totalTokens":23}}`,
    `{"type":"compaction","id":"compaction-1","timestamp":"2026-09-03T12:00:03.000Z","usage":{"input":100,"output":100,"totalTokens":200}}`,
    `{"type":"message","id":"tool-result-1","timestamp":"2026-09-03T12:00:04.000Z","message":{"role":"toolResult","provider":"openai-codex","usage":{"input":100,"output":100,"totalTokens":200}}}`,
  ].join("\n");

  const codexOnly = parsePiSessionText(text, "fallback");
  assert.ok(codexOnly);
  assert.equal(codexOnly.events.length, 1);
  assert.equal(codexOnly.cumulative.requests, 1);
  assert.equal(codexOnly.cumulative.total, 18);

  const allProviders = parsePiSessionText(text, "fallback", { includeAllProviders: true });
  assert.ok(allProviders);
  assert.equal(allProviders.events.length, 2);
  assert.equal(allProviders.cumulative.requests, 2);
  assert.equal(allProviders.cumulative.total, 41);
});

test("pi parser rejects unsafe counters and totals below cache-inclusive components", () => {
  const text = [
    `{"type":"session","id":"validated-pi","timestamp":"2026-09-03T13:00:00.000Z"}`,
    `{"type":"model_usage","timestamp":"2026-09-03T13:00:01.000Z","provider":"openai-codex","model":"gpt-5.3-codex","usage":{"input":10,"output":2,"cacheRead":3,"cacheWrite":1,"totalTokens":16}}`,
    `{"type":"model_usage","timestamp":"2026-09-03T13:00:02.000Z","provider":"openai-codex","model":"negative","usage":{"input":-1,"output":2,"totalTokens":1}}`,
    `{"type":"model_usage","timestamp":"2026-09-03T13:00:03.000Z","provider":"openai-codex","model":"fractional","usage":{"input":1.5,"output":2,"totalTokens":3.5}}`,
    `{"type":"model_usage","timestamp":"2026-09-03T13:00:04.000Z","provider":"openai-codex","model":"infinite","usage":{"input":1e309,"output":2,"totalTokens":1e309}}`,
    `{"type":"model_usage","timestamp":"2026-09-03T13:00:05.000Z","provider":"openai-codex","model":"unsafe","usage":{"input":9007199254740992,"output":2,"totalTokens":9007199254740994}}`,
    `{"type":"model_usage","timestamp":"2026-09-03T13:00:06.000Z","provider":"openai-codex","model":"undersized","usage":{"input":10,"output":2,"cacheRead":3,"cacheWrite":1,"totalTokens":15}}`,
    `{"type":"model_usage","timestamp":"2026-09-03T13:00:07.000Z","provider":"openai-codex","model":"reasoning-subset","usage":{"input":10,"output":2,"reasoningTokens":3,"totalTokens":12}}`,
  ].join("\n");

  const session = parsePiSessionText(text, "fallback");
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.equal(session.events[0].model, "gpt-5.3-codex");
  assert.deepEqual(session.cumulative, session.events[0].usage);
});

test("pi session summary follows the latest retained OAuth event, not a later API-key route", () => {
  const text = [
    `{"type":"session","id":"pi-summary","timestamp":"2026-09-03T14:00:00.000Z"}`,
    `{"type":"message","timestamp":"2026-09-03T14:00:01.000Z","message":{"role":"assistant","provider":"openai-codex","model":"gpt-5.3-codex","usage":{"input":10,"output":2,"totalTokens":12}}}`,
    `{"type":"message","timestamp":"2026-09-03T14:00:02.000Z","message":{"role":"assistant","provider":"openai","api":"openai-responses","model":"api-key-model","usage":{"input":20,"output":3,"totalTokens":23}}}`,
  ].join("\n");

  const session = parsePiSessionText(text, "fallback");
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.equal(session.model, "gpt-5.3-codex");
  assert.equal(session.provider, "openai-codex");
});
