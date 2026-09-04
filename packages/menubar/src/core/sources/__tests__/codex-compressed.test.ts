import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { codexSource, parseCodexRolloutPath } from "../codex";

const SESSION_ID = "01a058dc-c4fa-7972-8ff5-77ccfd3de86f";
const ZSTD_FIXTURE = Buffer.from(
  "KLUv/WBQAEUGAMJMKCBQZ6wDQUqF/nMNxeNGZVkEHDszeQ0xgvopxgMaM4vtNXNOVRArnzxSJZ93pAdrbcDLR5qsRyYf2BxdJdaxeTC205zH7bAu2Piwpg9PKoA5f9DtsXFwXsJI8NGdIelGaI4ZQVLBuSQdiIKkdQKcuCUFXaVfb8sX620fQrHw6CubYc1bYuz49YYKeXQCVQ3QpWqAoEnRZDj0+DpkVsZmFvlFDQBBKI5NzuCRqkFR3LuAVdOYFzovHBQjB+gEh8F6QcUxV+cE",
  "base64",
);

function compressedFixture(): { dir: string; file: string; root: ReturnType<typeof codexSource.extraRoot> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-codex-zstd-"));
  const sessions = path.join(dir, "sessions");
  const file = path.join(sessions, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl.zst`);
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ auth_mode: "chatgpt" }));
  fs.writeFileSync(file, ZSTD_FIXTURE);
  return { dir, file, root: codexSource.extraRoot(sessions, "codex") };
}

function assertUsage(session: Awaited<ReturnType<typeof parseCodexRolloutPath>>): void {
  assert.ok(session);
  assert.equal(session.sessionId, SESSION_ID);
  assert.equal(session.cumulative.total, 90);
  assert.equal(session.events.length, 1);
}

test("Codex streams compressed current rollouts through the pure-JS fallback", async () => {
  const fixture = compressedFixture();
  try {
    assertUsage(await parseCodexRolloutPath(
      { path: fixture.file, root: fixture.root },
      { includeAllProviders: false },
      {},
    ));
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("Codex compressed parsing is hermetic and works through the runtime-default path", async () => {
  const fixture = compressedFixture();
  try {
    assert.equal(codexSource.preferParsePath?.(fixture.file), true);
    assert.ok(codexSource.parsePath);
    assertUsage(await codexSource.parsePath(
      { path: fixture.file, root: fixture.root },
      { includeAllProviders: false },
    ));
    assertUsage(codexSource.parse(
      { path: fixture.file, text: "", root: fixture.root },
      { includeAllProviders: false },
    ));
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
