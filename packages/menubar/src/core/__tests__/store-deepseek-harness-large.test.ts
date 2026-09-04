import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_SOURCES, type SourcesConfig } from "../config";
import { SessionStore } from "../store";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function onlyDeepSeekHarness(): SourcesConfig {
  const sources = { ...DEFAULT_SOURCES };
  for (const source of Object.keys(sources) as Array<keyof SourcesConfig>) sources[source] = false;
  sources.dsh = true;
  return sources;
}

function header(createdAt: number): string {
  return JSON.stringify({
    type: "session",
    version: 0,
    id: "session-large",
    createdAt,
    cwd: "/work/dsh-large",
    delegationDepth: 0,
  });
}

function assistant(createdAt: number, inputTokens: number, outputTokens: number): string {
  return JSON.stringify({
    type: "assistant/message",
    seq: 1,
    time: createdAt + 1_000,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: "assistant",
        source: { kind: "model", provider: "openai-codex", model: "gpt-5-codex" },
      },
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    },
  });
}

function writeOauth(dshHome: string): void {
  fs.writeFileSync(path.join(dshHome, ".credentials.yaml"), [
    "version: 1",
    "records:",
    "  llm-pi-ai/openai-codex:",
    "    kind: grant",
    "",
  ].join("\n"));
}

function growPastStoreLimit(file: string): void {
  const paddingLine = `${" ".repeat(64 * 1024 - 1)}\n`;
  const padding = paddingLine.repeat(64);
  while (fs.statSync(file).size <= MAX_FILE_BYTES) fs.appendFileSync(file, padding);
}

test("indexes oversized plaintext DSH logs and retains last-good across a partial rewrite", async () => {
  const dshHome = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-dsh-large-"));
  const sessionDir = path.join(dshHome, "sessions", "project", "session-large");
  const file = path.join(sessionDir, "session.jsonl");
  const createdAt = Date.UTC(2026, 8, 3, 20);
  const previousDshHome = process.env.DSH_HOME;

  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    writeOauth(dshHome);
    fs.writeFileSync(file, `${header(createdAt)}\n${assistant(createdAt, 100, 20)}\n`);
    growPastStoreLimit(file);

    process.env.DSH_HOME = dshHome;
    const store = new SessionStore(() => ({
      extraSessionDirs: [],
      sources: onlyDeepSeekHarness(),
      trackAllProviders: false,
    }));
    await store.refreshDeep();

    const [initial] = store.sessions();
    assert.ok(initial, "a fresh store should stream an already-oversized DSH transcript");
    assert.equal(initial.sessionId, "session-large");
    assert.equal(initial.agent, "dsh");
    assert.equal(initial.cumulative.total, 120);

    fs.writeFileSync(path.join(dshHome, ".credentials.yaml"), "records: [\n");
    assert.equal(await store.refreshDeep(), false);
    assert.strictEqual(store.sessions()[0], initial, "invalid auth metadata should retain last-good usage");
    writeOauth(dshHome);

    fs.writeFileSync(file, `${header(createdAt)}\n`);
    assert.equal(await store.refreshDeep(), false);
    assert.strictEqual(store.sessions()[0], initial, "an append-only DSH prefix should retain last-good usage");

    fs.writeFileSync(file, `${header(createdAt)}\n{\"type\":`);
    growPastStoreLimit(file);
    assert.equal(await store.refreshDeep(), false);
    assert.strictEqual(store.sessions()[0], initial, "a malformed in-progress rewrite should retain last-good usage");

    fs.writeFileSync(file, `${header(createdAt)}\n${assistant(createdAt, 140, 30)}\n`);
    growPastStoreLimit(file);
    assert.equal(await store.refreshDeep(), true, "the unchanged index version should be retried after parse failure");
    assert.equal(store.sessions()[0]?.cumulative.total, 170);
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousDshHome;
    fs.rmSync(dshHome, { recursive: true, force: true });
  }
});
