import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_SOURCES, type SourcesConfig } from "../config";
import { SessionStore } from "../store";

const SESSION_ID = "01a06b18-7591-7d80-8d06-039ea669de03";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function onlyOpenClaw(): SourcesConfig {
  const sources = { ...DEFAULT_SOURCES };
  for (const source of Object.keys(sources) as Array<keyof SourcesConfig>) sources[source] = false;
  sources.openclaw = true;
  return sources;
}

test("indexes an already-oversized managed OpenClaw Codex rollout on a fresh store", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-openclaw-large-codex-"));
  const sessionsDir = path.join(stateDir, "agents", "default", "agent", "codex-home", "sessions", "2026", "09", "03");
  const file = path.join(sessionsDir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const originalStateDir = process.env.OPENCLAW_STATE_DIR;

  try {
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(file, [
      JSON.stringify({
        timestamp: "2026-09-03T10:00:00.000Z",
        type: "session_meta",
        payload: { id: SESSION_ID, cwd: "/work/openclaw" },
      }),
      JSON.stringify({
        timestamp: "2026-09-03T10:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } },
        },
      }),
      "",
    ].join("\n"));
    const paddingLine = `${" ".repeat(64 * 1024 - 1)}\n`;
    const paddingChunk = paddingLine.repeat(64);
    while (fs.statSync(file).size <= MAX_FILE_BYTES) fs.appendFileSync(file, paddingChunk);

    process.env.OPENCLAW_STATE_DIR = stateDir;
    const store = new SessionStore(() => ({
      extraSessionDirs: [],
      sources: onlyOpenClaw(),
      // Managed OpenClaw CODEX_HOME is not an auth store. OAuth attribution comes from its DB;
      // this fixture exercises the explicitly enabled diagnostic rollout fallback.
      trackAllProviders: true,
    }));
    await store.refreshDeep();

    const [session] = store.sessions();
    assert.ok(session, "the managed Codex rollout should be streamed through the OpenClaw source");
    assert.equal(session.sessionId, SESSION_ID);
    assert.equal(session.agent, "openclaw");
    assert.equal(session.cumulative.total, 120);
  } finally {
    if (originalStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = originalStateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
