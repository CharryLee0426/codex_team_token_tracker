import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_SOURCES, type SourcesConfig } from "../config";
import { SessionStore } from "../store";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function onlyPi(): SourcesConfig {
  const sources = { ...DEFAULT_SOURCES };
  for (const source of Object.keys(sources) as Array<keyof SourcesConfig>) sources[source] = false;
  sources.pi = true;
  return sources;
}

function message(timestamp: string, input: number, output: number): string {
  return JSON.stringify({
    type: "message",
    timestamp,
    message: {
      role: "assistant",
      provider: "openai-codex",
      api: "openai-codex-responses",
      model: "gpt-5-codex",
      usage: { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output },
    },
  });
}

function growPastStoreLimit(file: string): void {
  const paddingLine = `${" ".repeat(64 * 1024 - 1)}\n`;
  const padding = paddingLine.repeat(64);
  while (fs.statSync(file).size <= MAX_FILE_BYTES) fs.appendFileSync(file, padding);
}

test("streams pi sessions that already exceed 50 MiB and keeps following their growth", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-pi-large-"));
  const agentDir = path.join(home, ".pi", "agent");
  const sessionDir = path.join(agentDir, "sessions", "-work-large");
  const sessionId = "01a06b18-7591-7d80-8d06-039ea669de03";
  const file = path.join(sessionDir, `2026-09-03T10-00-00-000Z_${sessionId}.jsonl`);
  const previousDir = process.env.PI_CODING_AGENT_DIR;

  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(file, [
      JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-09-03T10:00:00.000Z", cwd: "/work/large" }),
      message("2026-09-03T10:00:01.000Z", 100, 20),
      "",
    ].join("\n"));
    growPastStoreLimit(file);

    process.env.PI_CODING_AGENT_DIR = agentDir;
    const store = new SessionStore(() => ({
      extraSessionDirs: [],
      sources: onlyPi(),
      trackAllProviders: false,
    }));
    await store.refreshDeep();

    assert.equal(store.sessions()[0]?.sessionId, sessionId);
    assert.equal(store.sessions()[0]?.cumulative.total, 120);

    fs.appendFileSync(file, `${message("2026-09-03T10:00:02.000Z", 30, 5)}\n`);
    assert.equal(await store.refreshDeep(), true);
    assert.equal(store.sessions()[0]?.cumulative.total, 155);
  } finally {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
