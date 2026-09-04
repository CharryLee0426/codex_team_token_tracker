import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { codexSource, MAX_CODEX_JSONL_LINE_BYTES, parseCodexRolloutPath } from "../codex";

const CHILD_PATH_ENV = "CODEX_TRACKER_TEST_ZSTD_MISSING_PATH";

const childPath = process.env[CHILD_PATH_ENV];

if (childPath) {
  const parsePath = codexSource.parsePath;
  if (!parsePath) process.exit(2);
  const root = codexSource.extraRoot(path.dirname(childPath), "codex");
  void parsePath({ path: childPath, root }, { includeAllProviders: false }).then(
    () => process.exit(3),
    () => process.exit(0),
  );
} else {
  test("Codex compressed streaming rejects a source open error without crashing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-codex-zstd-open-error-"));
    const sessions = path.join(dir, "sessions");
    const missingFile = path.join(sessions, "missing.jsonl.zst");

    try {
      fs.mkdirSync(sessions, { recursive: true });
      fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ auth_mode: "chatgpt" }));
      const child = spawnSync(process.execPath, [__filename], {
        encoding: "utf8",
        env: { ...process.env, [CHILD_PATH_ENV]: missingFile },
        timeout: 5_000,
      });

      assert.equal(
        child.status,
        0,
        `parsePath should reject through its promise; child exited ${String(child.status)}\n${child.stderr}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Codex path parsing discards an oversized non-usage record and continues with bounded memory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-codex-line-bound-"));
    const sessions = path.join(dir, "sessions");
    const file = path.join(sessions, "oversized.jsonl");
    try {
      fs.mkdirSync(sessions, { recursive: true });
      fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ auth_mode: "chatgpt" }));
      const sessionId = "01a058dc-c4fa-7972-8ff5-77ccfd3de86f";
      const usage = JSON.stringify({
        timestamp: "2026-09-03T10:00:01.000Z",
        type: "token_usage_record",
        payload: {
          session_id: sessionId,
          response_id: "response-after-oversized-line",
          usage: { input_tokens: 80, output_tokens: 10, total_tokens: 90 },
        },
      });
      fs.writeFileSync(file, `{"oversized":"${"x".repeat(MAX_CODEX_JSONL_LINE_BYTES)}"}\n${usage}\n`);
      const root = codexSource.extraRoot(sessions, "codex");
      const session = await parseCodexRolloutPath({ path: file, root }, { includeAllProviders: false });
      assert.equal(session?.sessionId, sessionId);
      assert.equal(session?.cumulative.total, 90);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
