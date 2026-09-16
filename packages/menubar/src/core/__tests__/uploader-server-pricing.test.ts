import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LONG_CONTEXT_THRESHOLD, bucketEvents, emptyUsage, type ParsedSession, type UsageEvent } from "@codex-tracker/shared";
import type { TrackerConfig } from "../config";
import { Uploader, sessionModels, sessionUploadHash, uploadSession } from "../uploader";

const HOUR = 1_780_000_000_000 - (1_780_000_000_000 % 3_600_000);

function event(model: string, input: number, output = 100): UsageEvent {
  return { ts: HOUR + 1000, model, agent: "codex", provider: "openai-codex", usage: { input, cached: Math.floor(input / 2), cacheWrite: 0, output, reasoning: 10, total: input + output, requests: 1 } };
}

const session: ParsedSession = {
  sessionId: "s1",
  agent: "codex",
  provider: "openai-codex",
  startedAt: HOUR,
  lastActivityAt: HOUR + 1000,
  cwd: null,
  projectName: "project",
  originator: "codex",
  source: "codex",
  cliVersion: null,
  timezone: null,
  model: "gpt-5.4-mini",
  events: [event("gpt-6-astra", LONG_CONTEXT_THRESHOLD + 5), event("gpt-6-astra", 1000), event("gpt-5.4-mini", 2000)],
  cumulative: { input: LONG_CONTEXT_THRESHOLD + 3005, cached: Math.floor((LONG_CONTEXT_THRESHOLD + 5) / 2) + 500 + 1000, cacheWrite: 0, output: 300, reasoning: 30, total: LONG_CONTEXT_THRESHOLD + 3305, requests: 3 },
  contextWindow: null,
  rateLimits: null,
  lineCount: 3,
};

test("a session's per-model breakdown carries each model's long-context share", () => {
  const models = sessionModels(session);
  assert.deepEqual(models.map((m) => m.model), ["gpt-5.4-mini", "gpt-6-astra"]);
  const astra = models[1];
  assert.equal(astra.requests, 2);
  assert.equal(astra.input, LONG_CONTEXT_THRESHOLD + 1005);
  assert.deepEqual(astra.long, { input: LONG_CONTEXT_THRESHOLD + 5, cached: Math.floor((LONG_CONTEXT_THRESHOLD + 5) / 2), cacheWrite: 0, output: 100, reasoning: 10, total: LONG_CONTEXT_THRESHOLD + 105, requests: 1 });
  assert.equal(models[0].long, undefined, "no request of this model ran long");
});

test("against a pricing backend the payloads carry tokens and splits, never a device-computed cost", async () => {
  const trackerHome = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-uploader-pricing-"));
  const previousHome = process.env.CODEX_TRACKER_HOME;
  try {
    process.env.CODEX_TRACKER_HOME = trackerHome;
    for (const wireVersion of [2, 3]) {
      fs.rmSync(path.join(trackerHome, "state.json"), { force: true });
      const uploader = new Uploader({
        getConfig: () => ({ deviceToken: "test-token", wireVersion } as TrackerConfig),
        onSignedOut: () => null,
      });
      const mutations: Array<Record<string, unknown>> = [];
      const fakeClient = { mutation: async (_ref: unknown, args: Record<string, unknown>) => { mutations.push(args); return { upserted: 1 }; } };
      (uploader as unknown as { call: <T>(fn: (client: typeof fakeClient, token: string) => Promise<T>) => Promise<T> }).call = async (fn) => fn(fakeClient, "test-token");

      const buckets = [...bucketEvents(session.events).values()];
      await uploader.pushAll(buckets, [session], new Map([["codex:s1", 1.25]]));
      assert.equal(mutations.length, 2);
      const sent = mutations[0].buckets as Array<Record<string, unknown>>;
      const astra = sent.find((b) => b.model === "gpt-6-astra")!;
      const sentSession = (mutations[1].sessions as Array<Record<string, unknown>>)[0];
      if (wireVersion >= 3) {
        assert.equal("cost" in astra, false, "wire 3: the backend prices the bucket");
        assert.deepEqual(astra.long, buckets.find((b) => b.model === "gpt-6-astra")!.long);
        assert.equal("long" in sent.find((b) => b.model === "gpt-5.4-mini")!, false);
        assert.equal("cost" in sentSession, false);
        assert.deepEqual(sentSession.models, sessionModels(session));
      } else {
        assert.equal(typeof astra.cost, "number", "wire 2: the old backend still needs the device cost");
        assert.equal("long" in astra, false);
        assert.equal(sentSession.cost, 1.25);
        assert.equal("models" in sentSession, false);
      }

      // Re-pushing the same data is a no-op; on wire 3 so is a price change (the cost is not part of the payload).
      await uploader.pushAll(buckets, [session], new Map([["codex:s1", wireVersion >= 3 ? 9.99 : 1.25]]));
      assert.equal(mutations.length, 2);
    }
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_TRACKER_HOME;
    else process.env.CODEX_TRACKER_HOME = previousHome;
    fs.rmSync(trackerHome, { recursive: true, force: true });
  }
});

test("the wire-3 session hash ignores the local cost but covers the breakdown", () => {
  const base = sessionUploadHash(session, 1, true);
  assert.equal(sessionUploadHash(session, 2, true), base);
  assert.notEqual(sessionUploadHash({ ...session, events: session.events.slice(1) }, 1, true), base);
  assert.equal("cost" in uploadSession(session, 1, true), false);
  assert.equal(uploadSession(session, 1, false).cost, 1);
  assert.equal("models" in uploadSession(session, 1, false), false);
  // An empty session has no breakdown but is still a valid payload.
  assert.deepEqual(uploadSession({ ...session, events: [], cumulative: emptyUsage() }, 0, true).models, []);
});
