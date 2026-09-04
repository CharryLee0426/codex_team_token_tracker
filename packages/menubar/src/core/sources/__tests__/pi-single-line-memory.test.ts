import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { piSource } from "../pi";

const CHILD_FILE_ENV = "CODEX_TRACKER_TEST_PI_SINGLE_LINE";
const childFile = process.env[CHILD_FILE_ENV];

if (childFile) {
  const parsePath = piSource.parsePath;
  if (!parsePath) process.exit(2);
  const root = piSource.extraRoot(path.dirname(childFile), "pi");
  void parsePath({ path: childFile, root }, { includeAllProviders: false }).then(
    (session) => process.exit(session?.cumulative.total === 120 ? 0 : 3),
    () => process.exit(4),
  );
} else {
  test("Pi streaming projection matches line-parser accounting and fails closed on oversized metadata", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-pi-stream-parity-"));
    const file = path.join(dir, "session.jsonl");
    const oversizedProvider = `private-provider-${"x".repeat(64 * 1024 + 1)}`;
    const text = [
      '{"type":"session","id":"pi-parity","timestamp":"2026-09-03T09:59:59.000Z","cwd":"/work/parity"}',
      '{"type":"title","timestamp":"2026-09-03T10:00:00.000Z","title":"private title"}',
      '{"broken":',
      '{"type":"model_usage","timestamp":"2026-09-03T10:00:00.500Z","provider":"openai-codex","model":"infinite","usage":{"input":1e309,"output":2,"totalTokens":1e309}}',
      `{"type":"model_usage","timestamp":"2026-09-03T10:00:00.750Z","provider":"openai-codex","model":"oversized-counter","usage":{"input":"${"x".repeat(64 * 1024 + 1)}","output":2,"totalTokens":2}}`,
      '{"type":"model_change","timestamp":"2026-09-03T10:00:00.800Z","provider":"openai-codex","modelId":"gpt-5.3-codex"}',
      `{"type":"model_usage","timestamp":"2026-09-03T10:00:00.900Z","provider":"${oversizedProvider}","model":"oversized-provider","usage":{"input":1,"output":1,"totalTokens":2}}`,
      '{"type":"model_usage","timestamp":"2026-09-03T10:00:01.000Z","provider":"anthropic","provider":"openai","api":"openai-chatgpt-responses","model":"gpt-5.3-codex","usage":{"input":11,"output":7,"cacheRead":19,"cacheWrite":3,"reasoningTokens":4}}',
      '{"type":"message","timestamp":"2026-09-03T10:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"private response"}],"provider":"openai-codex","api":"openai-codex-responses","model":"gpt-5.3-codex","usage":{"input":5,"output":2,"cacheRead":1,"cacheWrite":0,"reasoning":1,"totalTokens":8}}}',
      '{"type":"message","timestamp":"2026-09-03T10:00:03.000Z","message":{"role":"assistant","content":"private api response","provider":"openai","api":"openai-responses","model":"gpt-5.3-codex","usage":{"input":9,"output":3,"totalTokens":12}}}',
    ].join("\r\n");
    try {
      fs.writeFileSync(file, text);
      const root = piSource.extraRoot(dir, "pi");
      const parsePath = piSource.parsePath;
      assert.ok(parsePath);
      const streamed = await parsePath({ path: file, root }, { includeAllProviders: false });
      const synchronous = piSource.parse({ path: file, root, text }, { includeAllProviders: false });
      assert.deepEqual(streamed, synchronous);

      const streamedAll = await parsePath({ path: file, root }, { includeAllProviders: true });
      const synchronousAll = piSource.parse({ path: file, root, text }, { includeAllProviders: true });
      assert.ok(streamedAll);
      assert.ok(synchronousAll);
      assert.deepEqual(streamedAll.cumulative, synchronousAll.cumulative);
      assert.deepEqual(
        streamedAll.events.map((event) => [event.ts, event.model, event.usage.total]),
        synchronousAll.events.map((event) => [event.ts, event.model, event.usage.total]),
      );
      assert.equal(streamedAll.events.find((event) => event.model === "oversized-provider")?.provider, null);
      assert.equal(JSON.stringify(streamedAll).includes("private-provider-"), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Pi extracts usage from one oversized assistant record with bounded heap", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-pi-line-bound-"));
    const file = path.join(dir, "2026-09-03T10-00-00-000Z_01a06b18-7591-7d80-8d06-039ea669de03.jsonl");
    try {
      fs.writeFileSync(
        file,
        '{"type":"session","version":3,"id":"01a06b18-7591-7d80-8d06-039ea669de03","timestamp":"2026-09-03T10:00:00.000Z","cwd":"/work/large"}\n'
        + '{"type":"message","timestamp":"2026-09-03T10:00:01.000Z","message":{"role":"assistant","content":"',
      );
      const padding = "x".repeat(1024 * 1024);
      for (let chunk = 0; chunk < 64; chunk++) fs.appendFileSync(file, padding);
      fs.appendFileSync(
        file,
        '","api":"openai-codex-responses","provider":"openai-codex","model":"gpt-5.3-codex","usage":{"input":100,"output":20,"cacheRead":0,"cacheWrite":0,"totalTokens":120}}}\n',
      );

      const child = spawnSync(process.execPath, ["--max-old-space-size=32", __filename], {
        encoding: "utf8",
        env: { ...process.env, [CHILD_FILE_ENV]: file },
        timeout: 20_000,
      });
      assert.equal(
        child.status,
        0,
        `bounded Pi parsing child exited ${String(child.status)}\n${child.stderr}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
