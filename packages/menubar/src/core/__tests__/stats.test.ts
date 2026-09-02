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
  // 4 500 output tokens over the 60 s window — not (603 000 + 4 500) / 60 ≈ 10 125
  assert.equal(Number(s.live!.tokensPerSecond.toFixed(1)), 75);
  // burst: only the newest request falls inside 10 s
  assert.equal(Number(s.live!.tokensPerSecond10s.toFixed(1)), 150);
});

test("a session younger than the window is not diluted by time that never happened", () => {
  const s = computeStats({ sessions: [session([event(-2_000, "gpt-5.3-codex", 1_000, 600)], { startedAt: NOW - 5_000 })], now: NOW });
  // 600 tokens over the 5 s the session has existed, not over a full 60 s
  assert.equal(Number(s.live!.tokensPerSecond.toFixed(0)), 120);
});

test("non-OpenAI models are excluded from Codex totals", () => {
  const events = [event(-60_000, "gpt-5.3-codex", 1_000, 500), event(-30_000, "claude-sonnet-4-5", 900_000, 9_000)];
  const s = computeStats({ sessions: [session(events, { startedAt: NOW - 120_000 })], now: NOW });
  assert.equal(s.today.usage.total, 1_500);
  assert.deepEqual(s.modelsToday.map((m) => m.model), ["gpt-5.3-codex"]);
});
