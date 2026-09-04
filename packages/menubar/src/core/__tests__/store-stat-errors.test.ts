import assert from "node:assert/strict";
import fs, { type PathLike } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_SOURCES, type SourcesConfig } from "../config";
import { SessionStore } from "../store";

const SESSION_ID = "01a06b18-7591-7d80-8d06-039ea669de02";

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

function failStatFor(file: string, code: "EIO" | "EACCES"): () => void {
  const originalStat = fs.promises.stat;
  fs.promises.stat = (async (candidate: PathLike, ...args: unknown[]) => {
    if (candidate === file) throw Object.assign(new Error(`simulated ${code}`), { code });
    return Reflect.apply(originalStat, fs.promises, [candidate, ...args]);
  }) as typeof fs.promises.stat;
  return () => {
    fs.promises.stat = originalStat;
  };
}

for (const code of ["EIO", "EACCES"] as const) {
  test(`retains the last-good session when stat fails with ${code}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-stat-error-"));
    const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);

    try {
      fs.writeFileSync(file, rollout());
      const store = storeFor(dir);
      await store.refreshDeep();

      const [before] = store.sessions();
      assert.ok(before, "the valid rollout should be indexed before the stat failure");

      const restoreStat = failStatFor(file, code);
      try {
        await store.refreshShallow();
      } finally {
        restoreStat();
      }

      const [after] = store.sessions();
      assert.ok(after, `a transient ${code} stat failure must not remove the indexed session`);
      assert.equal(store.fileCount, 1);
      assert.deepEqual(after.cumulative, before.cumulative);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("retries a forced reparse after a transient stat error on an unchanged rollout", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-forced-stat-retry-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const promiseFs = fs.promises as unknown as {
    stat(path: PathLike): Promise<fs.Stats>;
    readFile(path: PathLike, encoding: BufferEncoding): Promise<string>;
  };
  const originalStat = promiseFs.stat;
  const originalReadFile = promiseFs.readFile;

  try {
    fs.writeFileSync(file, rollout());
    const store = storeFor(dir);
    await store.refreshDeep();
    assert.equal(store.sessions()[0]?.cumulative.total, 120);

    let failNextStat = true;
    let readAttempts = 0;
    promiseFs.stat = async (target) => {
      if (target === file && failNextStat) {
        failNextStat = false;
        throw Object.assign(new Error("simulated transient EIO"), { code: "EIO" });
      }
      return originalStat(target);
    };
    promiseFs.readFile = async (target, encoding) => {
      readAttempts++;
      return originalReadFile(target, encoding);
    };

    store.reset();
    await store.refreshDeep();
    assert.equal(readAttempts, 0);
    assert.equal(store.sessions()[0]?.cumulative.total, 120, "the failed forced stat should retain last-good usage");

    await store.refreshDeep();
    assert.equal(readAttempts, 1, "the ordinary refresh should retry parsing after the forced stat failure");
    assert.equal(store.sessions()[0]?.cumulative.total, 120);
  } finally {
    promiseFs.stat = originalStat;
    promiseFs.readFile = originalReadFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const code of ["ENOENT", "ENOTDIR"] as const) {
  test(`does not let a stale ${code} stat failure delete a newer same-path commit`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-stale-stat-"));
    const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
    const promiseFs = fs.promises as unknown as {
      stat(path: PathLike): Promise<fs.Stats>;
    };
    const originalStat = promiseFs.stat;
    let releaseStaleStat = () => {};
    let staleRefresh: Promise<boolean> | null = null;

    try {
      fs.writeFileSync(file, rollout());
      const store = storeFor(dir);
      await store.refreshDeep();
      assert.equal(store.sessions()[0]?.cumulative.total, 120);

      let markStaleStatCaptured = () => {};
      const staleStatCaptured = new Promise<void>((resolve) => {
        markStaleStatCaptured = resolve;
      });
      const allowStaleStatToFail = new Promise<void>((resolve) => {
        releaseStaleStat = resolve;
      });
      let blockFirstStat = true;
      promiseFs.stat = async (target) => {
        if (target === file && blockFirstStat) {
          blockFirstStat = false;
          markStaleStatCaptured();
          await allowStaleStatToFail;
          throw Object.assign(new Error(`simulated stale ${code}`), { code });
        }
        return originalStat(target);
      };

      staleRefresh = store.refreshShallow();
      await staleStatCaptured;

      fs.writeFileSync(file, rollout({ input: 180, cached: 40, output: 20 }));
      await store.refreshShallow();
      assert.equal(store.sessions()[0]?.cumulative.total, 200, "the newer scan should commit first");

      releaseStaleStat();
      await staleRefresh;
      assert.equal(store.fileCount, 1);
      assert.equal(
        store.sessions()[0]?.cumulative.total,
        200,
        `the stale ${code} result must not delete the newer entry`,
      );
    } finally {
      releaseStaleStat();
      await staleRefresh?.catch(() => {});
      promiseFs.stat = originalStat;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("retains indexed sessions when an active root has a transient readdir EIO", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-readdir-error-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const originalReadDir = fs.readdirSync;

  try {
    fs.writeFileSync(file, rollout());
    const store = storeFor(dir);
    await store.refreshDeep();

    const [before] = store.sessions();
    assert.ok(before);
    assert.equal(before.cumulative.total, 120);

    fs.readdirSync = ((candidate: PathLike, ...args: unknown[]) => {
      if (candidate === dir) throw Object.assign(new Error("simulated readdir EIO"), { code: "EIO" });
      return Reflect.apply(originalReadDir, fs, [candidate, ...args]);
    }) as typeof fs.readdirSync;
    await store.refreshDeep();

    const [after] = store.sessions();
    assert.ok(after, "a failed root enumeration must not look like a successfully empty directory");
    assert.equal(store.fileCount, 1);
    assert.deepEqual(after.cumulative, before.cumulative);
  } finally {
    fs.readdirSync = originalReadDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("retries a forced reparse after an incomplete root walk recovers at the same file version", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-forced-walk-retry-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const originalReadDir = fs.readdirSync;
  const promiseFs = fs.promises as unknown as {
    readFile(path: PathLike, encoding: BufferEncoding): Promise<string>;
  };
  const originalReadFile = promiseFs.readFile;

  try {
    fs.writeFileSync(file, rollout());
    const store = storeFor(dir);
    await store.refreshDeep();
    let failNextWalk = true;
    let readAttempts = 0;
    fs.readdirSync = ((candidate: PathLike, ...args: unknown[]) => {
      if (candidate === dir && failNextWalk) {
        failNextWalk = false;
        throw Object.assign(new Error("simulated root-walk EIO"), { code: "EIO" });
      }
      return Reflect.apply(originalReadDir, fs, [candidate, ...args]);
    }) as typeof fs.readdirSync;
    promiseFs.readFile = async (target, encoding) => {
      if (target === file) readAttempts++;
      return originalReadFile(target, encoding);
    };

    store.reset();
    await store.refreshDeep();
    assert.equal(readAttempts, 0);
    assert.equal(store.sessions()[0]?.cumulative.total, 120);

    await store.refreshDeep();
    assert.equal(readAttempts, 1, "the recovered deep scan must retain the forced reparse intent");
  } finally {
    fs.readdirSync = originalReadDir;
    promiseFs.readFile = originalReadFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("retains indexed sessions when built-in Codex root discovery has a transient stat EIO", async () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-root-stat-error-"));
  const sessionsDir = path.join(codexHome, "sessions");
  const file = path.join(sessionsDir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const originalCodexHome = process.env.CODEX_HOME;
  const originalStat = fs.statSync;
  const mutableFs = fs as unknown as { statSync: typeof fs.statSync };
  let failNextRootStat = true;

  try {
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: {} }));
    fs.writeFileSync(file, rollout());
    process.env.CODEX_HOME = codexHome;
    const store = new SessionStore(() => ({
      extraSessionDirs: [],
      sources: codexOnlySources(),
      trackAllProviders: true,
    }));
    await store.refreshDeep();

    const [before] = store.sessions();
    assert.ok(before);
    assert.equal(before.cumulative.total, 120);

    mutableFs.statSync = ((candidate: PathLike, ...args: unknown[]) => {
      if (candidate === sessionsDir && failNextRootStat) {
        failNextRootStat = false;
        throw Object.assign(new Error("simulated one-shot root stat EIO"), { code: "EIO" });
      }
      return Reflect.apply(originalStat, fs, [candidate, ...args]);
    }) as typeof fs.statSync;
    await store.refreshDeep();

    const [after] = store.sessions();
    assert.ok(after, "a failed root discovery must not look like an intentionally removed source root");
    assert.equal(store.fileCount, 1);
    assert.deepEqual(after.cumulative, before.cumulative);
  } finally {
    mutableFs.statSync = originalStat;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("retries a forced reparse after incomplete source discovery recovers at the same file version", async () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-forced-discovery-retry-"));
  const sessionsDir = path.join(codexHome, "sessions");
  const file = path.join(sessionsDir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const originalCodexHome = process.env.CODEX_HOME;
  const originalStat = fs.statSync;
  const mutableFs = fs as unknown as { statSync: typeof fs.statSync };
  const promiseFs = fs.promises as unknown as {
    readFile(path: PathLike, encoding: BufferEncoding): Promise<string>;
  };
  const originalReadFile = promiseFs.readFile;

  try {
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: {} }));
    fs.writeFileSync(file, rollout());
    process.env.CODEX_HOME = codexHome;
    const store = new SessionStore(() => ({
      extraSessionDirs: [],
      sources: codexOnlySources(),
      trackAllProviders: false,
    }));
    await store.refreshDeep();

    let failNextDiscovery = true;
    let readAttempts = 0;
    mutableFs.statSync = ((candidate: PathLike, ...args: unknown[]) => {
      if (candidate === sessionsDir && failNextDiscovery) {
        failNextDiscovery = false;
        throw Object.assign(new Error("simulated discovery EIO"), { code: "EIO" });
      }
      return Reflect.apply(originalStat, fs, [candidate, ...args]);
    }) as typeof fs.statSync;
    promiseFs.readFile = async (target, encoding) => {
      if (target === file) readAttempts++;
      return originalReadFile(target, encoding);
    };

    store.reset();
    await store.refreshDeep();
    assert.equal(readAttempts, 0);
    assert.equal(store.sessions()[0]?.cumulative.total, 120);

    await store.refreshDeep();
    assert.equal(readAttempts, 1, "the recovered source must still receive the forced reparse");
  } finally {
    mutableFs.statSync = originalStat;
    promiseFs.readFile = originalReadFile;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("removes indexed sessions when the built-in Codex root is actually removed", async () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-root-removed-"));
  const sessionsDir = path.join(codexHome, "sessions");
  const file = path.join(sessionsDir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const originalCodexHome = process.env.CODEX_HOME;

  try {
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: {} }));
    fs.writeFileSync(file, rollout());
    process.env.CODEX_HOME = codexHome;
    const store = new SessionStore(() => ({
      extraSessionDirs: [],
      sources: codexOnlySources(),
      trackAllProviders: false,
    }));
    await store.refreshDeep();
    assert.equal(store.fileCount, 1);

    fs.rmSync(sessionsDir, { recursive: true, force: true });
    await store.refreshDeep();

    assert.equal(store.fileCount, 0);
    assert.deepEqual(store.sessions(), []);
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("removes indexed sessions when the built-in Codex source is disabled", async () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-root-disabled-"));
  const sessionsDir = path.join(codexHome, "sessions");
  const file = path.join(sessionsDir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);
  const originalCodexHome = process.env.CODEX_HOME;
  const sources = codexOnlySources();

  try {
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: {} }));
    fs.writeFileSync(file, rollout());
    process.env.CODEX_HOME = codexHome;
    const store = new SessionStore(() => ({
      extraSessionDirs: [],
      sources,
      trackAllProviders: false,
    }));
    await store.refreshDeep();
    assert.equal(store.fileCount, 1);

    sources.codex = false;
    await store.refreshDeep();

    assert.equal(store.fileCount, 0);
    assert.deepEqual(store.sessions(), []);
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("removes an indexed session after a successful deep scan confirms the file is gone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-deep-missing-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);

  try {
    fs.writeFileSync(file, rollout());
    const store = storeFor(dir);
    await store.refreshDeep();
    assert.equal(store.fileCount, 1);

    fs.unlinkSync(file);
    await store.refreshDeep();

    assert.equal(store.fileCount, 0);
    assert.deepEqual(store.sessions(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removes an indexed session when stat fails with ENOENT", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-store-stat-missing-"));
  const file = path.join(dir, `rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`);

  try {
    fs.writeFileSync(file, rollout());
    const store = storeFor(dir);
    await store.refreshDeep();
    assert.equal(store.fileCount, 1);

    fs.unlinkSync(file);
    await store.refreshShallow();

    assert.equal(store.fileCount, 0);
    assert.deepEqual(store.sessions(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
