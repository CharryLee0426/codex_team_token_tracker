import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { emptyUsage, type ParsedSession } from "@codex-tracker/shared";
import type { TrackerConfig } from "../config";
import { SESSION_UPLOAD_IDENTITY_EPOCH, Uploader, sessionStateKey, sessionUploadHash } from "../uploader";

test("a session-identity epoch replays summaries cached before agent-aware backend upserts", async () => {
  const trackerHome = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-uploader-session-"));
  const previousHome = process.env.CODEX_TRACKER_HOME;
  const session: ParsedSession = {
    sessionId: "shared-session-id",
    agent: "codex",
    provider: "openai-codex",
    startedAt: 1,
    lastActivityAt: 1_000,
    cwd: null,
    projectName: "project",
    originator: "codex",
    source: "codex",
    cliVersion: null,
    timezone: null,
    model: "gpt-5-codex",
    events: [{
      ts: 1_000,
      model: "gpt-5-codex",
      agent: "codex",
      provider: "openai-codex",
      usage: { ...emptyUsage(), input: 10, output: 2, total: 12, requests: 1 },
    }],
    cumulative: { ...emptyUsage(), input: 10, output: 2, total: 12, requests: 1 },
    contextWindow: null,
    rateLimits: null,
    lineCount: 1,
  };

  try {
    process.env.CODEX_TRACKER_HOME = trackerHome;
    fs.writeFileSync(path.join(trackerHome, "state.json"), JSON.stringify({
      pushedBuckets: {},
      // This is the exact pre-migration key/hash. Without the epoch it suppresses the replay.
      pushedSessions: {
        "codex:shared-session-id": "codex|gpt-5-codex|1000|12|1|0.000000|project",
      },
      lastUploadAt: 1,
    }));

    const uploader = new Uploader({
      getConfig: () => ({ deviceToken: "test-token" } as TrackerConfig),
      onSignedOut: () => null,
    });
    const mutations: Array<Record<string, unknown>> = [];
    const fakeClient = {
      mutation: async (_reference: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        return { upserted: 1 };
      },
    };
    (uploader as unknown as {
      call: <T>(fn: (client: typeof fakeClient, token: string) => Promise<T>) => Promise<T>;
    }).call = async (fn) => fn(fakeClient, "test-token");

    const result = await uploader.pushAll([], [session], new Map([["codex:shared-session-id", 0]]));

    assert.equal(result.sessions, 1);
    assert.equal(mutations.length, 1);
    assert.equal(sessionStateKey(session), `${SESSION_UPLOAD_IDENTITY_EPOCH}|codex|shared-session-id`);
    const persisted = JSON.parse(fs.readFileSync(path.join(trackerHome, "state.json"), "utf8")) as {
      pushedSessions: Record<string, string>;
    };
    assert.ok(persisted.pushedSessions[sessionStateKey(session)]);

    const rejected = await uploader.pushAll(
      [{
        hourStart: 0,
        model: "gpt-5-codex",
        agent: "codex",
        usage: { ...emptyUsage(), input: Number.POSITIVE_INFINITY, total: Number.POSITIVE_INFINITY },
        cost: 0,
      }],
      [{ ...session, cumulative: { ...session.cumulative, total: Number.NaN } }],
      new Map([["codex:shared-session-id", 0]]),
    );
    assert.deepEqual(rejected, { buckets: 0, sessions: 0 });
    assert.equal(mutations.length, 1, "non-finite usage must be stopped before any Convex mutation");
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_TRACKER_HOME;
    else process.env.CODEX_TRACKER_HOME = previousHome;
    fs.rmSync(trackerHome, { recursive: true, force: true });
  }
});

test("the session upload hash covers every outbound summary field", () => {
  const base: ParsedSession = {
    sessionId: "session",
    agent: "codex",
    provider: "openai-codex",
    startedAt: 10,
    lastActivityAt: 20,
    cwd: "/work/one",
    projectName: "one",
    originator: "origin",
    source: "source",
    cliVersion: "1.0.0",
    timezone: null,
    model: "gpt-5-codex",
    events: [{
      ts: 20,
      model: "gpt-5-codex",
      agent: "codex",
      provider: "openai-codex",
      usage: { input: 8, cached: 2, cacheWrite: 1, output: 4, reasoning: 1, total: 12, requests: 1 },
    }],
    cumulative: { input: 8, cached: 2, cacheWrite: 1, output: 4, reasoning: 1, total: 12, requests: 1 },
    contextWindow: null,
    rateLimits: null,
    lineCount: 1,
  };
  const baseline = sessionUploadHash(base, 0.001);
  const variants: ParsedSession[] = [
    { ...base, sessionId: "other-session" },
    { ...base, agent: "pi" },
    { ...base, startedAt: 9 },
    { ...base, lastActivityAt: 21 },
    { ...base, cwd: "/work/two" },
    { ...base, projectName: "two" },
    { ...base, source: "other-source" },
    { ...base, cliVersion: "1.0.1" },
    { ...base, model: "gpt-5.1-codex" },
    { ...base, cumulative: { ...base.cumulative, input: 7, cached: 3 } },
    { ...base, cumulative: { ...base.cumulative, cacheWrite: 2, output: 3 } },
    { ...base, cumulative: { ...base.cumulative, reasoning: 2 } },
  ];

  for (const variant of variants) assert.notEqual(sessionUploadHash(variant, 0.001), baseline);
  assert.notEqual(sessionUploadHash(base, 0.0010001), baseline);
});
