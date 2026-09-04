import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_SOURCES, type SourcesConfig } from "../config";
import { hermesSource } from "../sources/hermes";
import { kiloSource } from "../sources/kilo";
import { openclawSource } from "../sources/openclaw";
import { openSqliteReadOnly, openSqliteReadOnlyOrThrow } from "../sources/sqlite";
import type { SessionRoot, SourceContext } from "../sources/types";
import { SessionStore } from "../store";

type Database = {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown };
  close(): void;
};
type DatabaseConstructor = new (file: string) => Database;

let DatabaseSync: DatabaseConstructor | null = null;
try {
  // SQLite is unavailable on the Node 16 compatibility runtime.
  DatabaseSync = (require("node:sqlite") as { DatabaseSync: DatabaseConstructor }).DatabaseSync;
} catch {
  /* SQLite-only regressions are skipped when the optional built-in is unavailable. */
}
const sqliteTest = DatabaseSync ? test : test.skip;

const T0 = Date.parse("2026-09-01T10:00:00.000Z");

function disabledSources(): SourcesConfig {
  const sources = { ...DEFAULT_SOURCES };
  for (const source of Object.keys(sources) as Array<keyof SourcesConfig>) sources[source] = false;
  return sources;
}

function context(home: string, env: NodeJS.ProcessEnv = {}): SourceContext {
  return { homes: [{ home, origin: "local", layout: "linux" }], platform: "linux", env: { HOME: home, ...env } };
}

function storeFor(root: SessionRoot): SessionStore {
  const store = new SessionStore(() => ({ extraSessionDirs: [], sources: disabledSources(), trackAllProviders: false }));
  store.roots = [root];
  return store;
}

function storeWithOpenClawDiscovery(): SessionStore {
  const sources = disabledSources();
  sources.openclaw = true;
  return new SessionStore(() => ({ extraSessionDirs: [], sources, trackAllProviders: false }));
}

function storeWithHermesDiscovery(): SessionStore {
  const sources = disabledSources();
  sources.hermes = true;
  return new SessionStore(() => ({ extraSessionDirs: [], sources, trackAllProviders: false }));
}

function corruptWithNewVersion(file: string): void {
  fs.writeFileSync(file, "this is not a SQLite database and must not replace the last good snapshot");
  const next = new Date(fs.statSync(file).mtimeMs + 2_000);
  fs.utimesSync(file, next, next);
}

sqliteTest("SQLite discovery probes stay nullable while parser opens preserve operational failures", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-sqlite-open-"));
  const missing = path.join(dir, "missing.db");
  try {
    assert.equal(openSqliteReadOnly(missing), null);
    assert.throws(() => openSqliteReadOnlyOrThrow(missing));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

sqliteTest("Kilo keeps its last good snapshot when a changed database cannot be queried", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-kilo-last-good-"));
  const dataHome = path.join(home, "xdg");
  const dataDir = path.join(dataHome, "kilo");
  const dbPath = path.join(dataDir, "kilo.db");

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "auth.json"), JSON.stringify({ openai: { type: "oauth" } }));
    const db = new (DatabaseSync as DatabaseConstructor)(dbPath);
    db.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)");
    db.prepare("INSERT INTO message VALUES (?, ?, ?)").run("m1", "s1", JSON.stringify({
      role: "assistant",
      providerID: "openai",
      modelID: "gpt-5.3-codex",
      time: { created: T0 },
      tokens: { input: 10, output: 2, total: 12 },
    }));
    db.close();

    const [root] = kiloSource.discover(context(home, { XDG_DATA_HOME: dataHome })).filter((candidate) => !candidate.text);
    assert.ok(root);
    const store = storeFor(root);
    assert.equal(await store.refreshShallow(), true);
    assert.equal(store.sessions()[0]?.cumulative.total, 12);
    const lastGood = store.files.get(dbPath);
    assert.ok(lastGood);

    corruptWithNewVersion(dbPath);
    assert.equal(await store.refreshShallow(), false);
    assert.strictEqual(store.files.get(dbPath), lastGood);
    assert.equal(store.sessions()[0]?.cumulative.total, 12);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

sqliteTest("OpenClaw keeps its last good snapshot when a changed database cannot be queried", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-openclaw-last-good-"));
  const stateDir = path.join(home, "state");
  const runtimeDir = path.join(stateDir, "agents", "main", "agent");
  const dbPath = path.join(runtimeDir, "openclaw-agent.sqlite");

  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const db = new (DatabaseSync as DatabaseConstructor)(dbPath);
    db.exec("CREATE TABLE transcript_events (event_json TEXT, created_at INTEGER)");
    db.prepare("INSERT INTO transcript_events VALUES (?, ?)").run(JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      message: {
        role: "assistant",
        api: "openai-chatgpt-responses",
        provider: "openai",
        model: "gpt-5.3-codex",
        usage: { input: 10, output: 2, totalTokens: 12 },
      },
    }), T0);
    db.close();

    const [root] = openclawSource.discover(context(home, { OPENCLAW_STATE_DIR: stateDir }));
    assert.ok(root);
    assert.equal(root.text, false);
    const store = storeFor(root);
    assert.equal(await store.refreshShallow(), true);
    assert.equal(store.sessions()[0]?.cumulative.total, 12);
    const lastGood = store.files.get(dbPath);
    assert.ok(lastGood);

    corruptWithNewVersion(dbPath);
    assert.equal(await store.refreshShallow(), false);
    assert.strictEqual(store.files.get(dbPath), lastGood);
    assert.equal(store.sessions()[0]?.cumulative.total, 12);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

sqliteTest("Hermes keeps its last good snapshot when a changed database cannot be queried", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-hermes-last-good-"));
  const hermesHome = path.join(home, "hermes-home");
  const dbPath = path.join(hermesHome, "state.db");

  try {
    fs.mkdirSync(hermesHome, { recursive: true });
    const db = new (DatabaseSync as DatabaseConstructor)(dbPath);
    db.exec("CREATE TABLE session_model_usage (session_id TEXT, model TEXT, billing_provider TEXT, input_tokens INTEGER, output_tokens INTEGER)");
    db.prepare("INSERT INTO session_model_usage VALUES (?, ?, ?, ?, ?)").run("s1", "gpt-5.3-codex", "openai-codex", 20, 4);
    db.close();

    const [root] = hermesSource.discover(context(home, { HERMES_HOME: hermesHome }));
    assert.ok(root);
    const store = storeFor(root);
    assert.equal(await store.refreshShallow(), true);
    assert.equal(store.sessions()[0]?.cumulative.total, 24);
    const lastGood = store.files.get(dbPath);
    assert.ok(lastGood);

    corruptWithNewVersion(dbPath);
    assert.equal(await store.refreshShallow(), false);
    assert.strictEqual(store.files.get(dbPath), lastGood);
    assert.equal(store.sessions()[0]?.cumulative.total, 24);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

sqliteTest("OpenClaw deep discovery retains an unreadable database root and its last good snapshot", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-openclaw-deep-last-good-"));
  const stateDir = path.join(home, "state");
  const runtimeDir = path.join(stateDir, "agents", "main", "agent");
  const dbPath = path.join(runtimeDir, "openclaw-agent.sqlite");
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;

  try {
    process.env.OPENCLAW_STATE_DIR = stateDir;
    fs.mkdirSync(runtimeDir, { recursive: true });
    const db = new (DatabaseSync as DatabaseConstructor)(dbPath);
    db.exec("CREATE TABLE transcript_events (event_json TEXT, created_at INTEGER)");
    db.prepare("INSERT INTO transcript_events VALUES (?, ?)").run(JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      message: {
        role: "assistant",
        api: "openai-chatgpt-responses",
        provider: "openai",
        model: "gpt-5.3-codex",
        usage: { input: 20, output: 4, totalTokens: 24 },
      },
    }), T0);
    db.close();

    const store = storeWithOpenClawDiscovery();
    assert.equal(await store.refreshDeep(), true);
    assert.equal(store.sessions()[0]?.cumulative.total, 24);
    const lastGood = store.files.get(dbPath);
    assert.ok(lastGood);

    corruptWithNewVersion(dbPath);
    assert.equal(await store.refreshDeep(), false);
    assert.equal(store.roots.some((root) => !root.text && root.exts.includes("openclaw-agent.sqlite")), true);
    assert.strictEqual(store.files.get(dbPath), lastGood);
    assert.equal(store.sessions()[0]?.cumulative.total, 24);
  } finally {
    if (previousStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = previousStateDir;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

sqliteTest("Hermes deep discovery retains an unreadable database root and its last good snapshot", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-hermes-deep-last-good-"));
  const hermesHome = path.join(home, "hermes-home");
  const dbPath = path.join(hermesHome, "state.db");
  const previousHermesHome = process.env.HERMES_HOME;

  try {
    process.env.HERMES_HOME = hermesHome;
    fs.mkdirSync(hermesHome, { recursive: true });
    const db = new (DatabaseSync as DatabaseConstructor)(dbPath);
    db.exec("CREATE TABLE session_model_usage (session_id TEXT, model TEXT, billing_provider TEXT, input_tokens INTEGER, output_tokens INTEGER)");
    db.prepare("INSERT INTO session_model_usage VALUES (?, ?, ?, ?, ?)").run("s1", "gpt-5.3-codex", "openai-codex", 30, 6);
    db.close();

    const store = storeWithHermesDiscovery();
    assert.equal(await store.refreshDeep(), true);
    assert.equal(store.sessions()[0]?.cumulative.total, 36);
    const lastGood = store.files.get(dbPath);
    assert.ok(lastGood);

    corruptWithNewVersion(dbPath);
    assert.equal(await store.refreshDeep(), false);
    assert.equal(store.roots.some((root) => !root.text && root.exts.includes("state.db")), true);
    assert.strictEqual(store.files.get(dbPath), lastGood);
    assert.equal(store.sessions()[0]?.cumulative.total, 36);
  } finally {
    if (previousHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = previousHermesHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
