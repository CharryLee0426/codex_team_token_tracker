import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_SOURCES, type SourcesConfig } from "../config";
import { SessionStore } from "../store";

const SESSION_ID = "01a06b18-7591-7d80-8d06-039ea669de02";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function disabledSources(): SourcesConfig {
  const sources = { ...DEFAULT_SOURCES };
  for (const source of Object.keys(sources) as Array<keyof SourcesConfig>) sources[source] = false;
  return sources;
}

function codexOnlySources(): SourcesConfig {
  return { ...disabledSources(), codex: true };
}

function rollout(usage = { input: 100, cached: 40, output: 20 }): string {
  return [
    JSON.stringify({
      timestamp: "2026-09-03T10:00:00.000Z",
      type: "session_meta",
      payload: { id: SESSION_ID, cwd: "/work/project" },
    }),
    JSON.stringify({
      timestamp: "2026-09-03T10:00:01.000Z",
      type: "turn_context",
      payload: { model: "gpt-5.6-sol" },
    }),
    JSON.stringify({
      timestamp: "2026-09-03T10:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: usage.input,
            cached_input_tokens: usage.cached,
            output_tokens: usage.output,
            total_tokens: usage.input + usage.output,
          },
        },
      },
    }),
  ].join("\n");
}

function storeFor(dir: string): SessionStore {
  return new SessionStore(() => ({
    extraSessionDirs: [{ path: dir, agent: "codex", format: "codex" }],
    sources: disabledSources(),
    trackAllProviders: true,
  }));
}

function growPastFileLimit(file: string): void {
  const paddingLine = `${" ".repeat(64 * 1024 - 1)}\n`;
  const paddingChunk = paddingLine.repeat(64);
  while (fs.statSync(file).size <= MAX_FILE_BYTES) fs.appendFileSync(file, paddingChunk);
}

test("invalid Codex auth metadata retains last-good, but removed OAuth proof evicts it", async () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-auth-transition-"));
  const sessions = path.join(codexHome, "sessions");
  const auth = path.join(codexHome, "auth.json");
  const file = path.join(sessions, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const previousCodexHome = process.env.CODEX_HOME;

  try {
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(auth, JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "never-retained" } }));
    fs.writeFileSync(file, rollout());
    process.env.CODEX_HOME = codexHome;
    const store = new SessionStore(() => ({
      extraSessionDirs: [],
      sources: codexOnlySources(),
      trackAllProviders: false,
    }));

    await store.refreshDeep();
    const [initial] = store.sessions();
    assert.ok(initial);
    assert.equal(initial.cumulative.total, 120);

    fs.writeFileSync(auth, "{");
    assert.equal(await store.refreshDeep(), false);
    assert.strictEqual(store.sessions()[0], initial, "a torn auth rewrite should not erase a valid snapshot");

    fs.unlinkSync(auth);
    assert.equal(await store.refreshDeep(), true);
    assert.deepEqual(store.sessions(), [], "missing OAuth proof must fail closed instead of retaining old usage");
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("invalidates the file index for a full refresh without blanking the current snapshot", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-reset-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);

  try {
    fs.writeFileSync(file, rollout());
    const store = storeFor(dir);
    await store.refreshDeep();
    assert.equal(store.sessions()[0]?.cumulative.total, 120);

    store.reset();
    assert.equal(store.sessions()[0]?.cumulative.total, 120, "a full-sync rescan must not expose an empty intermediate index");

    await store.refreshDeep();
    assert.equal(store.sessions()[0]?.cumulative.total, 120);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("retries a failed forced reparse even when the rollout version is unchanged", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-forced-retry-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const promiseFs = fs.promises as unknown as {
    readFile(path: fs.PathLike, encoding: BufferEncoding): Promise<string>;
  };
  const originalReadFile = promiseFs.readFile;

  try {
    fs.writeFileSync(file, rollout());
    const store = storeFor(dir);
    await store.refreshDeep();
    assert.equal(store.sessions()[0]?.cumulative.total, 120);

    let readAttempts = 0;
    promiseFs.readFile = async (target, encoding) => {
      readAttempts++;
      if (readAttempts === 1) {
        const error = new Error("simulated transient read failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return originalReadFile(target, encoding);
    };

    store.reset();
    await store.refreshDeep();
    assert.equal(readAttempts, 1);
    assert.equal(store.sessions()[0]?.cumulative.total, 120, "the failed forced read should retain last-good usage");

    await store.refreshDeep();
    assert.equal(readAttempts, 2, "the ordinary refresh should retry the failed forced reparse");
    assert.equal(store.sessions()[0]?.cumulative.total, 120);
  } finally {
    promiseFs.readFile = originalReadFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("allows an explicit full refresh to apply an authoritative downward correction", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-correction-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const promiseFs = fs.promises as unknown as {
    readFile(path: fs.PathLike, encoding: BufferEncoding): Promise<string>;
  };
  const originalReadFile = promiseFs.readFile;
  let releaseForcedRead = () => {};
  let forcedRefresh: Promise<boolean> | null = null;

  try {
    fs.writeFileSync(file, rollout());
    const store = storeFor(dir);
    await store.refreshDeep();
    assert.equal(store.sessions()[0]?.cumulative.total, 120);

    fs.writeFileSync(file, rollout({ input: 60, cached: 20, output: 20 }));
    let markForcedReadCaptured = () => {};
    const forcedReadCaptured = new Promise<void>((resolve) => {
      markForcedReadCaptured = resolve;
    });
    const allowForcedReadToFinish = new Promise<void>((resolve) => {
      releaseForcedRead = resolve;
    });
    let readCount = 0;
    promiseFs.readFile = async (target, encoding) => {
      const text = await originalReadFile(target, encoding);
      readCount++;
      if (readCount === 1) {
        markForcedReadCaptured();
        await allowForcedReadToFinish;
      }
      return text;
    };

    store.reset();
    assert.equal(store.sessions()[0]?.cumulative.total, 120, "the old snapshot remains visible while the full refresh runs");
    forcedRefresh = store.refreshDeep();
    await forcedReadCaptured;

    await store.refreshDeep();
    assert.equal(store.sessions()[0]?.cumulative.total, 120, "an ordinary overlapping refresh must not publish the lower value");

    releaseForcedRead();
    await forcedRefresh;
    assert.equal(store.sessions()[0]?.cumulative.total, 80, "the completed full refresh should publish the corrected value");
  } finally {
    releaseForcedRead();
    await forcedRefresh?.catch(() => {});
    promiseFs.readFile = originalReadFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("retains the last valid Codex usage when a forced refresh sees a partial usage prefix", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-forced-prefix-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const rows = [
    JSON.stringify({
      timestamp: "2026-09-03T10:00:00.000Z",
      type: "session_meta",
      payload: { id: SESSION_ID, cwd: "/work/project" },
    }),
    JSON.stringify({
      timestamp: "2026-09-03T10:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 } },
      },
    }),
    JSON.stringify({
      timestamp: "2026-09-03T10:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { input_tokens: 300, output_tokens: 0, total_tokens: 300 } },
      },
    }),
  ];

  try {
    fs.writeFileSync(file, rows.join("\n"));
    const store = storeFor(dir);
    await store.refreshDeep();

    const [before] = store.sessions();
    assert.ok(before);
    assert.equal(before.cumulative.total, 300);
    assert.equal(before.cumulative.requests, 2);
    assert.equal(before.lineCount, 3);

    fs.writeFileSync(file, rows.slice(0, 2).join("\n"));
    store.reset();
    await store.refreshDeep();

    const [after] = store.sessions();
    assert.ok(after, "a forced scan of a partial prefix should retain the complete snapshot");
    assert.deepEqual(after.cumulative, before.cumulative);
    assert.equal(after.lineCount, before.lineCount);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("does not let an older overlapping refresh overwrite a newer Codex snapshot", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-overlap-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const promiseFs = fs.promises as unknown as {
    readFile(path: fs.PathLike, encoding: BufferEncoding): Promise<string>;
  };
  const originalReadFile = promiseFs.readFile;
  let releaseOlderRead = () => {};
  let olderRefresh: Promise<boolean> | null = null;

  try {
    fs.writeFileSync(file, rollout({ input: 80, cached: 20, output: 20 }));
    const store = storeFor(dir);
    let readCount = 0;
    let markOlderReadCaptured = () => {};
    const olderReadCaptured = new Promise<void>((resolve) => {
      markOlderReadCaptured = resolve;
    });
    const allowOlderReadToFinish = new Promise<void>((resolve) => {
      releaseOlderRead = resolve;
    });

    promiseFs.readFile = async (target, encoding) => {
      const text = await originalReadFile(target, encoding);
      readCount++;
      if (readCount === 1) {
        markOlderReadCaptured();
        await allowOlderReadToFinish;
      }
      return text;
    };

    olderRefresh = store.refreshDeep();
    await olderReadCaptured;

    fs.writeFileSync(file, rollout({ input: 180, cached: 40, output: 20 }));
    await store.refreshDeep();
    assert.equal(store.sessions()[0]?.cumulative.total, 200, "the newer refresh should commit first");

    releaseOlderRead();
    await olderRefresh;
    assert.equal(store.sessions()[0]?.cumulative.total, 200, "the delayed stale parse must not replace newer usage");
  } finally {
    releaseOlderRead();
    await olderRefresh?.catch(() => {});
    promiseFs.readFile = originalReadFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("does not let an older deep scan delete a file indexed by a newer scan", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-overlap-delete-"));
  const firstId = "01a06b18-7591-7d80-8d06-039ea669de01";
  const secondId = "01a06b18-7591-7d80-8d06-039ea669de02";
  const firstFile = path.join(dir, `rollout-2026-09-03T10-00-00-${firstId}.jsonl`);
  const secondFile = path.join(dir, `rollout-2026-09-03T10-00-01-${secondId}.jsonl`);
  const promiseFs = fs.promises as unknown as {
    readFile(path: fs.PathLike, encoding: BufferEncoding): Promise<string>;
  };
  const originalReadFile = promiseFs.readFile;
  let releaseOlderRead = () => {};
  let olderRefresh: Promise<boolean> | null = null;
  const sessionText = (sessionId: string, total: number) => [
    JSON.stringify({
      timestamp: "2026-09-03T10:00:00.000Z",
      type: "session_meta",
      payload: { id: sessionId, cwd: "/work/project" },
    }),
    JSON.stringify({
      timestamp: "2026-09-03T10:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { input_tokens: total, output_tokens: 0, total_tokens: total } },
      },
    }),
  ].join("\n");

  try {
    fs.writeFileSync(firstFile, sessionText(firstId, 100));
    const store = storeFor(dir);
    let markOlderReadCaptured = () => {};
    const olderReadCaptured = new Promise<void>((resolve) => {
      markOlderReadCaptured = resolve;
    });
    const allowOlderReadToFinish = new Promise<void>((resolve) => {
      releaseOlderRead = resolve;
    });
    let blockFirstRead = true;
    promiseFs.readFile = async (target, encoding) => {
      const text = await originalReadFile(target, encoding);
      if (blockFirstRead) {
        blockFirstRead = false;
        markOlderReadCaptured();
        await allowOlderReadToFinish;
      }
      return text;
    };

    olderRefresh = store.refreshDeep();
    await olderReadCaptured;

    fs.writeFileSync(secondFile, sessionText(secondId, 200));
    await store.refreshDeep();
    assert.deepEqual(store.sessions().map((session) => session.sessionId).sort(), [firstId, secondId]);

    releaseOlderRead();
    await olderRefresh;
    assert.deepEqual(
      store.sessions().map((session) => session.sessionId).sort(),
      [firstId, secondId],
      "the stale directory snapshot must not delete a session committed by the newer scan",
    );
  } finally {
    releaseOlderRead();
    await olderRefresh?.catch(() => {});
    promiseFs.readFile = originalReadFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("retains the last valid Codex session when a rollout grows past 50 MiB", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-last-good-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);

  try {
    fs.writeFileSync(file, rollout());
    const store = storeFor(dir);

    await store.refreshDeep();
    const [before] = store.sessions();
    assert.ok(before, "the valid rollout should be indexed");
    assert.equal(before.sessionId, SESSION_ID);
    assert.equal(before.cumulative.total, 120);

    fs.truncateSync(file, MAX_FILE_BYTES + 1);
    await store.refreshShallow();

    const [after] = store.sessions();
    assert.ok(after, "the last valid session should remain indexed when the changed rollout cannot be reparsed");
    assert.equal(after.sessionId, SESSION_ID);
    assert.deepEqual(after.cumulative, before.cumulative);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parses an already-oversized Codex rollout when building a fresh index", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-oversized-fresh-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);

  try {
    fs.writeFileSync(file, `${rollout()}\n`);
    growPastFileLimit(file);
    assert.ok(fs.statSync(file).size > MAX_FILE_BYTES);

    const store = storeFor(dir);
    await store.refreshDeep();

    const [session] = store.sessions();
    assert.ok(session, "a fresh index should parse a valid rollout even when it is already larger than 50 MiB");
    assert.equal(session.sessionId, SESSION_ID);
    assert.equal(session.cumulative.total, 120);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const transientRolloutContents = [
  { state: "empty", text: "" },
  { state: "metadata-only", text: rollout().split("\n", 1)[0] },
];

for (const transient of transientRolloutContents) {
  test(`retains the last valid Codex usage after a transient ${transient.state} rewrite`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-transient-"));
    const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);

    try {
      fs.writeFileSync(file, rollout());
      const store = storeFor(dir);
      await store.refreshDeep();

      const [before] = store.sessions();
      assert.ok(before, "the complete rollout should be indexed before the transient rewrite");
      assert.equal(before.cumulative.total, 120);

      fs.writeFileSync(file, transient.text);
      await store.refreshShallow();

      const [after] = store.sessions();
      assert.ok(after, `the ${transient.state} rewrite should not remove the last valid session`);
      assert.equal(after.sessionId, SESSION_ID);
      assert.deepEqual(after.cumulative, before.cumulative);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`retains the last valid Codex usage when a forced refresh sees a transient ${transient.state} rewrite`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-forced-transient-"));
    const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);

    try {
      fs.writeFileSync(file, rollout());
      const store = storeFor(dir);
      await store.refreshDeep();

      const [before] = store.sessions();
      assert.ok(before, "the complete rollout should be indexed before the forced transient rewrite");
      assert.equal(before.cumulative.total, 120);

      fs.writeFileSync(file, transient.text);
      store.reset();
      assert.equal(store.sessions()[0]?.cumulative.total, 120, "reset should keep the last-good snapshot visible");
      await store.refreshDeep();

      const [after] = store.sessions();
      assert.ok(after, `the forced ${transient.state} refresh should not remove the last valid session`);
      assert.equal(after.sessionId, SESSION_ID);
      assert.deepEqual(after.cumulative, before.cumulative);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
