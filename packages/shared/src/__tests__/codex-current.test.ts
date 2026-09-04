import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSessionText, sessionIdFromFilename } from "../codex-parser.ts";

function line(timestamp: string, type: string, payload: object): string {
  return JSON.stringify({ timestamp, type, payload });
}

test("current token_usage_record entries win over legacy token_count and dedupe response ids", () => {
  const text = [
    line("2026-09-03T10:00:00.000Z", "session_meta", {
      id: "session-current",
      cwd: "/work/current",
    }),
    line("2026-09-03T10:00:01.000Z", "turn_context", { model: "gpt-5.3-codex" }),
    line("2026-09-03T10:00:03.000Z", "token_usage_record", {
      session_id: "session-current",
      response_id: "response-a",
      usage: {
        input_tokens: 120,
        cached_input_tokens: 20,
        cache_write_input_tokens: 5,
        output_tokens: 30,
        reasoning_output_tokens: 10,
        total_tokens: 150,
      },
      turn_token_usage: { input_tokens: 1_200, output_tokens: 300, total_tokens: 1_500 },
      thread_token_usage: { input_tokens: 12_000, output_tokens: 3_000, total_tokens: 15_000 },
    }),
    line("2026-09-03T10:00:04.000Z", "token_usage_record", {
      response_id: "response-a",
      usage: { input_tokens: 999, output_tokens: 999, total_tokens: 1_998 },
    }),
    line("2026-09-03T10:00:05.000Z", "turn_context", { model: "gpt-5.4" }),
    line("2026-09-03T10:00:06.000Z", "token_usage_record", {
      response_id: "response-b",
      usage: {
        input_tokens: 80,
        cached_input_tokens: 10,
        output_tokens: 20,
        reasoning_output_tokens: 4,
        total_tokens: 100,
      },
      turn_token_usage: { input_tokens: 200, output_tokens: 50, total_tokens: 250 },
      thread_token_usage: { input_tokens: 12_080, output_tokens: 3_020, total_tokens: 15_100 },
    }),
    line("2026-09-03T10:00:07.000Z", "event_msg", {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 10_000,
          cached_input_tokens: 4_500,
          output_tokens: 1_000,
          reasoning_output_tokens: 100,
          total_tokens: 11_000,
        },
      },
    }),
  ].join("\n");

  const session = parseSessionText(text, "fallback");
  assert.ok(session);
  assert.equal(session.events.length, 2);
  assert.deepEqual(session.events.map((event) => ({
    ts: event.ts,
    model: event.model,
    usage: event.usage,
  })), [
    {
      ts: Date.parse("2026-09-03T10:00:03.000Z"),
      model: "gpt-5.3-codex",
      usage: {
        input: 120,
        cached: 20,
        cacheWrite: 5,
        output: 30,
        reasoning: 10,
        total: 150,
        requests: 1,
      },
    },
    {
      ts: Date.parse("2026-09-03T10:00:06.000Z"),
      model: "gpt-5.4",
      usage: {
        input: 80,
        cached: 10,
        cacheWrite: 0,
        output: 20,
        reasoning: 4,
        total: 100,
        requests: 1,
      },
    },
  ]);
  assert.deepEqual(session.cumulative, {
    input: 200,
    cached: 30,
    cacheWrite: 5,
    output: 50,
    reasoning: 14,
    total: 250,
    requests: 2,
  });
});

test("preserves a legacy token_count prefix when a rollout transitions to usage records", () => {
  const text = [
    line("2026-09-03T12:00:00.000Z", "turn_context", { model: "gpt-5.3-codex" }),
    line("2026-09-03T12:00:01.000Z", "event_msg", {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } },
    }),
    line("2026-09-03T12:00:02.000Z", "event_msg", {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 150, output_tokens: 30, total_tokens: 180 } },
    }),
    line("2026-09-03T12:00:03.000Z", "token_usage_record", {
      response_id: "new-format-a",
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
    }),
    // New Codex also emits a cumulative mirror after the authoritative record.
    line("2026-09-03T12:00:04.000Z", "event_msg", {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 160, output_tokens: 32, total_tokens: 192 } },
    }),
    line("2026-09-03T12:00:05.000Z", "token_usage_record", {
      response_id: "new-format-b",
      usage: { input_tokens: 8, output_tokens: 1, total_tokens: 9 },
    }),
  ].join("\n");

  const session = parseSessionText(text, "transition");
  assert.ok(session);
  assert.deepEqual(session.events.map((event) => event.usage.total), [120, 60, 12, 9]);
  assert.deepEqual(session.cumulative, {
    input: 168,
    cached: 0,
    cacheWrite: 0,
    output: 33,
    reasoning: 0,
    total: 201,
    requests: 4,
  });
});

test("legacy token_count remains the fallback when no current records exist", () => {
  const text = [
    line("2026-09-03T11:00:00.000Z", "turn_context", { model: "gpt-5.3-codex" }),
    line("2026-09-03T11:00:01.000Z", "event_msg", {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 40,
          cached_input_tokens: 10,
          output_tokens: 5,
          total_tokens: 45,
        },
      },
    }),
    line("2026-09-03T11:00:02.000Z", "event_msg", {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 70,
          cached_input_tokens: 20,
          output_tokens: 15,
          total_tokens: 85,
        },
      },
    }),
  ].join("\n");

  const session = parseSessionText(text, "legacy");
  assert.ok(session);
  assert.deepEqual(session.events.map((event) => event.usage.total), [45, 40]);
  assert.deepEqual(session.cumulative, {
    input: 70,
    cached: 20,
    cacheWrite: 0,
    output: 15,
    reasoning: 0,
    total: 85,
    requests: 2,
  });
});

test("malformed token_usage_record does not suppress valid legacy usage", () => {
  const text = [
    line("2026-09-03T11:00:00.000Z", "event_msg", {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 40,
          output_tokens: 5,
          total_tokens: 45,
        },
      },
    }),
    line("2026-09-03T11:00:01.000Z", "token_usage_record", {
      response_id: "missing-usage",
    }),
  ].join("\n");

  const session = parseSessionText(text, "legacy-with-malformed-record");
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.equal(session.cumulative.total, 45);
});

test("Codex rejects non-finite, unsafe, negative, and internally inconsistent usage", () => {
  const text = [
    line("2026-09-03T11:30:00.000Z", "event_msg", {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 40, output_tokens: 5, total_tokens: 45 } },
    }),
    `{"timestamp":"2026-09-03T11:30:01.000Z","type":"token_usage_record","payload":{"response_id":"infinite","usage":{"input_tokens":1e309,"output_tokens":1,"total_tokens":1e309}}}`,
    line("2026-09-03T11:30:02.000Z", "token_usage_record", {
      response_id: "negative",
      usage: { input_tokens: -1, output_tokens: 1, total_tokens: 0 },
    }),
    line("2026-09-03T11:30:03.000Z", "token_usage_record", {
      response_id: "fractional",
      usage: { input_tokens: 1.5, output_tokens: 1, total_tokens: 2.5 },
    }),
    line("2026-09-03T11:30:04.000Z", "token_usage_record", {
      response_id: "unsafe",
      usage: { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 1, total_tokens: Number.MAX_SAFE_INTEGER + 2 },
    }),
    line("2026-09-03T11:30:05.000Z", "token_usage_record", {
      response_id: "undersized",
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 11 },
    }),
    line("2026-09-03T11:30:06.000Z", "token_usage_record", {
      response_id: "cache-subset",
      usage: { input_tokens: 10, cached_input_tokens: 11, output_tokens: 2, total_tokens: 12 },
    }),
    line("2026-09-03T11:30:07.000Z", "token_usage_record", {
      response_id: "reasoning-subset",
      usage: { input_tokens: 10, output_tokens: 2, reasoning_output_tokens: 3, total_tokens: 12 },
    }),
  ].join("\n");

  const session = parseSessionText(text, "validated-codex");
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.equal(session.cumulative.total, 45);
});

test("session ids are derived from compressed and uncompressed rollout filenames", () => {
  const id = "01a058dc-c4fa-7972-8ff5-77ccfd3de86f";
  const stem = `rollout-2026-09-03T10-00-00-${id}`;
  assert.equal(sessionIdFromFilename(`${stem}.jsonl`), id);
  assert.equal(sessionIdFromFilename(`${stem}.jsonl.zst`), id);
});
