import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyUsage, type ParsedSession, type UsageEvent } from "@codex-tracker/shared";
import { computeStats } from "../stats";

const NOW = Date.UTC(2026, 8, 1, 12, 0, 0);

function event(tsOffsetMs: number, model: string, input: number, output: number): UsageEvent {
  return {
    ts: NOW + tsOffsetMs,
    model,
    agent: "codex",
    provider: "openai-codex",
    usage: { ...emptyUsage(), input, output, total: input + output, requests: 1 },
  };
}

function session(events: UsageEvent[], overrides: Partial<ParsedSession> = {}): ParsedSession {
  const last = events[events.length - 1];
  return {
    sessionId: "s1",
    agent: "codex",
    provider: null,
    startedAt: events[0].ts,
    lastActivityAt: last.ts,
    cwd: null,
    projectName: "proj",
    originator: null,
    source: null,
    cliVersion: null,
    timezone: null,
    model: last.model,
    events,
    cumulative: { ...emptyUsage() },
    contextWindow: 400_000,
    rateLimits: null,
    lineCount: events.length,
    ...overrides,
  };
}

test("live tok/s measures generated tokens, not re-sent context", () => {
  // Three requests in the last 30 s, each re-sending a 200K-token prompt for ~1.5K of output.
  const events = [event(-30_000, "gpt-5.3-codex", 200_000, 1_500), event(-20_000, "gpt-5.3-codex", 201_000, 1_500), event(-8_000, "gpt-5.3-codex", 202_000, 1_500)];
  const s = computeStats({ sessions: [session(events, { startedAt: NOW - 600_000 })], now: NOW });
  assert.ok(s.live);
  // 4 500 output tokens over the 60 s rate window — never prompt tokens.
  assert.equal(Number(s.live!.tokensPerSecond.toFixed(1)), 75);
  // burst: only the newest request falls inside 10 s
  assert.equal(Number(s.live!.tokensPerSecond10s.toFixed(1)), 150);
});

test("a session younger than the window is not diluted by time that never happened", () => {
  const s = computeStats({ sessions: [session([event(-2_000, "gpt-5.3-codex", 1_000, 600)], { startedAt: NOW - 5_000 })], now: NOW });
  assert.equal(Number(s.live!.tokensPerSecond.toFixed(0)), 120);
});

test("an OAuth-only native Codex session keeps authoritative timing while its summary is normalized", () => {
  const events = [event(-20_000, "gpt-5.3-codex", 1_000, 200)];
  const cumulative = { ...emptyUsage(), input: 1_000, output: 200, total: 1_200, requests: 4 };
  const original = session(events, {
    provider: "openai-codex",
    startedAt: NOW - 45_000,
    lastActivityAt: NOW - 1_000,
    cumulative,
  });

  const s = computeStats({ sessions: [original], now: NOW });

  assert.notEqual(s.sessions[0], original);
  assert.equal(s.sessions[0].startedAt, NOW - 45_000);
  assert.equal(s.sessions[0].lastActivityAt, NOW - 1_000);
  assert.deepEqual(s.sessions[0].cumulative, events[0].usage);
  assert.equal(Number(s.live!.tokensPerSecond.toFixed(1)), 4.4);
});

test("already-filtered multi-provider sources cannot leak excluded summary metadata", () => {
  for (const agent of ["pi", "cline"]) {
    const retained = { ...event(-20_000, "gpt-5.3-codex", 10, 2), agent };
    const contaminated = session([retained], {
      agent,
      provider: "anthropic",
      model: "claude-sonnet-4",
      startedAt: NOW - 50_000,
      lastActivityAt: NOW - 1_000,
      cumulative: { ...emptyUsage(), input: 999, output: 999, total: 1_998, requests: 9 },
    });

    const [sanitized] = computeStats({ sessions: [contaminated], now: NOW }).sessions;
    assert.equal(sanitized.provider, "openai-codex");
    assert.equal(sanitized.model, "gpt-5.3-codex");
    assert.equal(sanitized.startedAt, NOW - 50_000);
    assert.equal(sanitized.lastActivityAt, NOW - 20_000);
    assert.deepEqual(sanitized.cumulative, retained.usage);
  }
});

test("non-OpenAI models are excluded from Codex totals", () => {
  const events = [event(-60_000, "gpt-5.3-codex", 1_000, 500), event(-30_000, "claude-sonnet-4-5", 900_000, 9_000)];
  const s = computeStats({
    sessions: [session(events, {
      provider: "anthropic",
      startedAt: NOW - 120_000,
      lastActivityAt: NOW - 30_000,
      model: "claude-sonnet-4-5",
      cumulative: { ...emptyUsage(), input: 901_000, output: 9_500, total: 910_500, requests: 2 },
    })],
    now: NOW,
  });
  assert.equal(s.today.usage.total, 1_500);
  assert.deepEqual(s.modelsToday.map((m) => m.model), ["gpt-5.3-codex"]);
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].model, "gpt-5.3-codex");
  assert.equal(s.sessions[0].provider, "openai-codex");
  assert.equal(s.sessions[0].startedAt, NOW - 120_000);
  assert.equal(s.sessions[0].lastActivityAt, NOW - 60_000);
  assert.deepEqual(s.sessions[0].cumulative, events[0].usage);
  assert.equal(s.live?.model, "gpt-5.3-codex");
  assert.deepEqual(s.live?.sessionUsage, events[0].usage);
  assert.equal(s.lastActivityAt, NOW - 60_000);
});

test("sessions with no OpenAI events are excluded from upload and live state", () => {
  const claude = event(-30_000, "claude-sonnet-4-5", 900_000, 9_000);
  const s = computeStats({ sessions: [session([claude])], now: NOW });

  assert.deepEqual(s.sessions, []);
  assert.equal(s.live, null);
  assert.equal(s.lastActivityAt, null);
});

test("OpenAI API-key events are excluded even when their model name is Codex", () => {
  const apiKeyEvent = { ...event(-30_000, "gpt-5.3-codex", 1_000, 500), provider: "openai" };
  const s = computeStats({ sessions: [session([apiKeyEvent])], now: NOW });

  assert.deepEqual(s.sessions, []);
  assert.equal(s.today.usage.total, 0);
  assert.equal(s.live, null);
});

test("unsafe timestamps and cumulative overflow cannot reach buckets or session uploads", () => {
  const overflowing = session([
    event(-2_000, "gpt-5.3-codex", Number.MAX_SAFE_INTEGER, 0),
    event(-1_000, "gpt-5.3-codex", 1, 0),
  ]);
  const invalidTime = session([event(Number.POSITIVE_INFINITY, "gpt-5.3-codex", 10, 2)], {
    sessionId: "invalid-time",
  });

  const stats = computeStats({ sessions: [overflowing, invalidTime], now: NOW });
  assert.deepEqual(stats.sessions, []);
  assert.deepEqual(stats.buckets, []);
  assert.equal(stats.today.usage.total, 0);
});
