import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_SOURCES, type SourcesConfig } from "../config";
import { SessionStore } from "../store";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function onlyCline(): SourcesConfig {
  const sources = { ...DEFAULT_SOURCES };
  for (const source of Object.keys(sources) as Array<keyof SourcesConfig>) sources[source] = false;
  sources.cline = true;
  return sources;
}

function assistantMessage(ts: number, input: number, output: number): string {
  return JSON.stringify({
    role: "assistant",
    ts,
    modelInfo: { id: "gpt-5-codex", provider: "openai-codex" },
    metrics: { inputTokens: input, outputTokens: output },
  });
}

test("streams Cline envelopes above 50 MiB, retains torn growth, and follows completed growth", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-cline-large-"));
  const sessionId = "session-large";
  const sessionDir = path.join(dataDir, "sessions", sessionId);
  const file = path.join(sessionDir, `${sessionId}.messages.json`);
  const startedAt = Date.UTC(2026, 8, 3, 10);
  const previousDataDir = process.env.CLINE_DATA_DIR;

  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      file,
      `{"version":1,"updated_at":"${new Date(startedAt + 1_000).toISOString()}","sessionId":"${sessionId}","messages":[{"role":"user","ts":${startedAt},"content":"`,
    );
    const padding = "x".repeat(1024 * 1024);
    for (let chunk = 0; chunk < 51; chunk++) fs.appendFileSync(file, padding);
    fs.appendFileSync(file, `"},${assistantMessage(startedAt + 1_000, 100, 20)}]}\n`);
    assert.ok(fs.statSync(file).size > MAX_FILE_BYTES);

    process.env.CLINE_DATA_DIR = dataDir;
    const store = new SessionStore(() => ({
      extraSessionDirs: [],
      sources: onlyCline(),
      trackAllProviders: false,
    }));
    await store.refreshDeep();

    assert.equal(store.sessions().find((session) => session.sessionId === sessionId)?.cumulative.total, 120);

    fs.truncateSync(file, fs.statSync(file).size - Buffer.byteLength("]}\n"));
    fs.appendFileSync(file, `,${assistantMessage(startedAt + 2_000, 30, 5)}`);
    assert.equal(await store.refreshDeep(), false);
    assert.equal(store.sessions().find((session) => session.sessionId === sessionId)?.cumulative.total, 120);

    fs.appendFileSync(file, "]}\n");
    assert.equal(await store.refreshDeep(), true);
    assert.equal(store.sessions().find((session) => session.sessionId === sessionId)?.cumulative.total, 155);
  } finally {
    if (previousDataDir === undefined) delete process.env.CLINE_DATA_DIR;
    else process.env.CLINE_DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
