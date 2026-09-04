import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSessionText } from "../codex-parser.ts";

test("keeps the child session id when inherited metadata repeats the parent id", () => {
  const childId = "01a06b16-380e-7eb2-9f78-2b98bd6fa064";
  const parentId = "01a06afd-ec91-7133-b419-17f062efb670";
  const text = [
    JSON.stringify({
      timestamp: "2026-09-03T23:23:33.000Z",
      type: "session_meta",
      payload: { id: childId, timestamp: "2026-09-03T23:23:33.000Z", cwd: "/work/project" },
    }),
    JSON.stringify({
      timestamp: "2026-09-03T22:57:01.000Z",
      type: "session_meta",
      payload: { id: parentId, timestamp: "2026-09-03T22:57:01.000Z", cwd: "/work/project" },
    }),
    JSON.stringify({
      timestamp: "2026-09-03T23:23:34.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 40,
            output_tokens: 20,
            total_tokens: 120,
          },
        },
      },
    }),
  ].join("\n");

  const session = parseSessionText(text, "fallback");

  assert.ok(session);
  assert.equal(session.sessionId, childId);
});

test("keeps child metadata when inherited modern metadata repeats the parent session", () => {
  const childId = "01a06b16-380e-7eb2-9f78-2b98bd6fa064";
  const parentId = "01a06afd-ec91-7133-b419-17f062efb670";
  const childTimestamp = "2026-09-03T23:23:33.000Z";
  const text = [
    JSON.stringify({
      timestamp: childTimestamp,
      type: "session_meta",
      payload: {
        id: childId,
        timestamp: childTimestamp,
        cwd: "/work/child",
        source: "subagent",
        model: "gpt-5.6-sol",
      },
    }),
    JSON.stringify({
      timestamp: "2026-09-03T22:57:01.000Z",
      type: "session_meta",
      payload: {
        id: parentId,
        timestamp: "2026-09-03T22:57:01.000Z",
        cwd: "/work/parent",
        source: "vscode",
        model: "gpt-5.5",
      },
    }),
  ].join("\n");

  const session = parseSessionText(text, "fallback");

  assert.ok(session);
  assert.equal(session.sessionId, childId);
  assert.equal(session.startedAt, Date.parse(childTimestamp));
  assert.equal(session.cwd, "/work/child");
  assert.equal(session.source, "subagent");
  assert.equal(session.model, "gpt-5.6-sol");
});

test("keeps the first legacy child identity and metadata when parent metadata is replayed", () => {
  const childId = "01a06b16-380e-7eb2-9f78-2b98bd6fa064";
  const parentId = "01a06afd-ec91-7133-b419-17f062efb670";
  const childTimestamp = "2026-09-03T23:23:33.000Z";
  const text = [
    JSON.stringify({
      id: childId,
      timestamp: childTimestamp,
      instructions: "child instructions",
      cwd: "/work/child",
    }),
    JSON.stringify({
      id: parentId,
      timestamp: "2026-09-03T22:57:01.000Z",
      instructions: "parent instructions",
      cwd: "/work/parent",
    }),
  ].join("\n");

  const session = parseSessionText(text, "fallback");

  assert.ok(session);
  assert.equal(session.sessionId, childId);
  assert.equal(session.startedAt, Date.parse(childTimestamp));
  assert.equal(session.cwd, "/work/child");
});

test("keeps cumulative usage additive when legacy counters reset", () => {
  const text = [
    JSON.stringify({
      timestamp: "2026-09-03T23:00:00.000Z",
      type: "session_meta",
      payload: { id: "session-with-reset", cwd: "/work/project" },
    }),
    JSON.stringify({
      timestamp: "2026-09-03T23:01:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1_000,
            cached_input_tokens: 400,
            output_tokens: 500,
            reasoning_output_tokens: 100,
            total_tokens: 1_500,
          },
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-09-03T23:02:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 150,
            cached_input_tokens: 20,
            output_tokens: 50,
            reasoning_output_tokens: 10,
            total_tokens: 200,
          },
        },
      },
    }),
  ].join("\n");

  const session = parseSessionText(text, "fallback");

  assert.ok(session);
  assert.deepEqual(session.events.map((event) => event.usage.total), [1_500, 200]);
  assert.deepEqual(session.cumulative, {
    input: 1_150,
    cached: 420,
    cacheWrite: 0,
    output: 550,
    reasoning: 110,
    total: 1_700,
    requests: 2,
  });
});
