import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openclawSource } from "../openclaw";
import { kiloSource } from "../kilo";
import { hermesSource } from "../hermes";
import { sqliteFileVersion } from "../sqlite";
import type { SourceContext, SourceDefinition } from "../types";
import { MAX_AUTH_METADATA_BYTES } from "../util";

type Database = { exec(sql: string): void; prepare(sql: string): { run(...params: unknown[]): unknown }; close(): void };
type DatabaseConstructor = new (file: string) => Database;
let DatabaseSync: DatabaseConstructor | null = null;
try {
  // Kept dynamic so the Node 16 compatibility suite can load this file and skip SQLite-only cases.
  DatabaseSync = (require("node:sqlite") as { DatabaseSync: DatabaseConstructor }).DatabaseSync;
} catch {
  /* `node:sqlite` is optional at runtime. */
}
const sqliteTest = DatabaseSync ? test : test.skip;

const T0 = Date.parse("2026-09-01T10:00:00.000Z");

function scratchHome(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ctrack-${name}-`));
}

function context(home: string, env: NodeJS.ProcessEnv = {}): SourceContext {
  return { homes: [{ home, origin: "local", layout: "linux" }], platform: "linux", env: { HOME: home, ...env } };
}

function platformContext(
  home: string,
  layout: "darwin" | "win32" | "linux",
  env: NodeJS.ProcessEnv = {},
): SourceContext {
  return {
    homes: [{ home, origin: "local", layout }],
    platform: layout,
    env: { HOME: home, ...env },
  };
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function parseRoot(source: SourceDefinition, root: ReturnType<SourceDefinition["discover"]>[number], includeAllProviders = false) {
  const file = path.join(root.dir, root.exts[0]);
  return source.parse({ path: file, text: root.text ? fs.readFileSync(file, "utf8") : "", root }, { includeAllProviders });
}

sqliteTest("OpenClaw prefers its SQLite transcript mirror and filters API-key OpenAI", () => {
  const home = scratchHome("openclaw");
  const state = path.join(home, "state");
  const agentDir = path.join(state, "agents", "main", "agent");
  const dbPath = path.join(agentDir, "openclaw-agent.sqlite");
  fs.mkdirSync(agentDir, { recursive: true });
  const db = new (DatabaseSync as DatabaseConstructor)(dbPath);
  db.exec("CREATE TABLE session_windows (session_id TEXT PRIMARY KEY, model_provider TEXT, model TEXT, agent_harness_id TEXT, created_at INTEGER, updated_at INTEGER)");
  db.exec("CREATE TABLE transcript_events (session_id TEXT, seq INTEGER, event_json TEXT, created_at INTEGER, PRIMARY KEY(session_id, seq))");
  const insert = db.prepare("INSERT INTO transcript_events VALUES (?, ?, ?, ?)");
  insert.run("s1", 1, JSON.stringify({ type: "message", timestamp: new Date(T0).toISOString(), message: { role: "assistant", api: "openai-chatgpt-responses", provider: "openai", model: "gpt-5.3-codex", usage: { input: 50, cacheRead: 20, cacheWrite: 5, output: 15, reasoningTokens: 4, totalTokens: 90 }, timestamp: T0 } }), T0);
  insert.run("s1", 2, JSON.stringify({ type: "message", timestamp: new Date(T0 + 1000).toISOString(), message: { role: "assistant", api: "openai-responses", provider: "openai", model: "gpt-5.3-codex", usage: { input: 9, output: 1, totalTokens: 10 }, timestamp: T0 + 1000 } }), T0 + 1000);
  db.close();

  // A mirrored native rollout exists too; choosing both would double-count the same call.
  writeJson(path.join(agentDir, "codex-home", "sessions", "2026", "09", "01", "rollout-duplicate.jsonl"), {});
  const roots = openclawSource.discover(context(home, { OPENCLAW_STATE_DIR: state }));
  assert.equal(roots.length, 1);
  assert.equal(roots[0].text, false);
  const session = parseRoot(openclawSource, roots[0]);
  assert.ok(session);
  assert.equal(session.agent, "openclaw");
  assert.equal(session.source, "openclaw");
  assert.equal(session.events.length, 1);
  assert.deepEqual(session.events[0].usage, { input: 75, cached: 20, cacheWrite: 5, output: 15, reasoning: 4, total: 90, requests: 1 });
});

sqliteTest("OpenClaw counts fork-copied history once by durable event or message ID", () => {
  const home = scratchHome("openclaw-fork-dedupe");
  const state = path.join(home, "state");
  const agentDir = path.join(state, "agents", "main", "agent");
  const dbPath = path.join(agentDir, "openclaw-agent.sqlite");
  fs.mkdirSync(agentDir, { recursive: true });
  const db = new (DatabaseSync as DatabaseConstructor)(dbPath);
  db.exec("CREATE TABLE transcript_events (session_id TEXT, seq INTEGER, event_json TEXT, created_at INTEGER, PRIMARY KEY(session_id, seq))");
  const insert = db.prepare("INSERT INTO transcript_events VALUES (?, ?, ?, ?)");
  const secret = "private prompt and assistant content must never be retained";
  const parentEvent = {
    type: "message",
    id: "event-parent",
    timestamp: new Date(T0).toISOString(),
    message: {
      role: "assistant",
      api: "openai-chatgpt-responses",
      provider: "openai",
      model: "gpt-5.3-codex",
      content: secret,
      usage: { input: 10, output: 2, totalTokens: 12 },
    },
  };
  const messageIdEvent = {
    type: "message",
    timestamp: new Date(T0 + 1_000).toISOString(),
    message: {
      id: "message-parent",
      role: "assistant",
      api: "openai-chatgpt-responses",
      provider: "openai",
      model: "gpt-5.3-codex",
      usage: { input: 4, output: 1, totalTokens: 5 },
    },
  };
  const childEvent = {
    type: "message",
    id: "event-child",
    timestamp: new Date(T0 + 2_000).toISOString(),
    message: {
      role: "assistant",
      api: "openai-chatgpt-responses",
      provider: "openai",
      model: "gpt-5.3-codex",
      usage: { input: 6, output: 1, totalTokens: 7 },
    },
  };
  const idlessEvent = {
    type: "message",
    timestamp: new Date(T0 + 3_000).toISOString(),
    message: {
      role: "assistant",
      api: "openai-chatgpt-responses",
      provider: "openai",
      model: "gpt-5.3-codex",
      usage: { input: 2, output: 1, totalTokens: 3 },
    },
  };
  insert.run("parent", 1, JSON.stringify(parentEvent), T0);
  insert.run("child", 1, JSON.stringify(parentEvent), T0 + 1);
  insert.run("parent", 2, JSON.stringify(messageIdEvent), T0 + 1_000);
  insert.run("child", 2, JSON.stringify(messageIdEvent), T0 + 1_001);
  insert.run("child", 3, JSON.stringify(childEvent), T0 + 2_000);
  insert.run("parent", 3, JSON.stringify(idlessEvent), T0 + 3_000);
  insert.run("child", 4, JSON.stringify(idlessEvent), T0 + 3_001);
  db.close();

  const roots = openclawSource.discover(context(home, { OPENCLAW_STATE_DIR: state }));
  assert.equal(roots.length, 1);
  const session = parseRoot(openclawSource, roots[0]);
  assert.ok(session);
  assert.equal(session.events.length, 5, "copied IDs dedupe, while records without a durable ID stay independent");
  assert.equal(session.cumulative.total, 30);
  assert.equal(session.cumulative.requests, 5);
  assert.equal(JSON.stringify(session).includes(secret), false);
  assert.equal(JSON.stringify(session).includes("content"), false);
});

test("OpenClaw discovers managed Codex rollouts for diagnostics when no transcript DB exists", () => {
  const home = scratchHome("openclaw-rollout");
  const codexHome = path.join(home, ".openclaw", "agents", "worker", "agent", "codex-home");
  const sessions = path.join(codexHome, "sessions");
  const rolloutFile = path.join(sessions, "rollout-managed.jsonl");
  fs.mkdirSync(sessions, { recursive: true });
  writeJson(path.join(codexHome, "auth.json"), { auth_mode: "chatgpt", tokens: { access_token: "decoy" } });
  writeJson(rolloutFile, {
    timestamp: "2026-09-01T10:00:00.000Z",
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } },
  });
  const roots = openclawSource.discover(context(home));
  assert.equal(roots.length, 1);
  assert.equal(roots[0].dir, sessions);
  assert.equal(roots[0].format, "codex");
  assert.equal(roots[0].agent, "openclaw");
  assert.equal(
    openclawSource.parse(
      { path: rolloutFile, text: fs.readFileSync(rolloutFile, "utf8"), root: roots[0] },
      { includeAllProviders: false },
    ),
    null,
    "OpenClaw injects ChatGPT tokens in memory, so a managed codex-home/auth.json is not OAuth proof",
  );
});

test("OpenClaw discovers bounded named profiles and both configured agentDir roster shapes", () => {
  const home = scratchHome("openclaw-profiles");
  const conventionalSessions = path.join(home, ".openclaw-team", "agents", "main", "agent", "codex-home", "sessions");
  const entriesRuntime = path.join(home, "custom-agents", "entries-agent");
  const listRuntime = path.join(home, "custom-agents", "list-agent");
  const entriesSessions = path.join(entriesRuntime, "codex-home", "sessions");
  const listSessions = path.join(listRuntime, "codex-home", "sessions");
  fs.mkdirSync(conventionalSessions, { recursive: true });
  fs.mkdirSync(entriesSessions, { recursive: true });
  fs.mkdirSync(listSessions, { recursive: true });

  const entriesState = path.join(home, ".openclaw-entries");
  fs.mkdirSync(entriesState, { recursive: true });
  fs.writeFileSync(path.join(entriesState, "openclaw.json"), `{
    // JSON5 comments and trailing commas are valid OpenClaw config.
    agents: { entries: { coder: { agentDir: ${JSON.stringify(entriesRuntime)}, }, }, },
    secrets: { decoy: "private-value-that-must-not-be-retained", },
  }\n`);

  const listState = path.join(home, ".openclaw-list");
  fs.mkdirSync(listState, { recursive: true });
  fs.writeFileSync(path.join(listState, "openclaw.json"), `{
    agents: { list: [{ id: "worker", agentDir: ${JSON.stringify(listRuntime)} }] },
  }\n`);

  const roots = openclawSource.discover(context(home));
  assert.deepEqual(
    roots.map((root) => root.dir).sort(),
    [conventionalSessions, entriesSessions, listSessions].sort(),
  );
  assert.equal(JSON.stringify(roots).includes("private-value-that-must-not-be-retained"), false);
});

sqliteTest("OpenClaw discovers relocated agent databases from its shared registry", () => {
  const home = scratchHome("openclaw-registry");
  const state = path.join(home, ".openclaw");
  const agentDatabasePath = path.join(state, "relocated", "worker.sqlite");
  const stateDatabasePath = path.join(state, "state", "openclaw.sqlite");
  fs.mkdirSync(path.dirname(agentDatabasePath), { recursive: true });
  fs.mkdirSync(path.dirname(stateDatabasePath), { recursive: true });

  const agentDatabase = new (DatabaseSync as DatabaseConstructor)(agentDatabasePath);
  agentDatabase.exec("CREATE TABLE transcript_events (event_json TEXT, created_at INTEGER)");
  agentDatabase.prepare("INSERT INTO transcript_events VALUES (?, ?)").run(JSON.stringify({
    timestamp: new Date(T0).toISOString(),
    message: {
      role: "assistant",
      api: "openai-chatgpt-responses",
      provider: "openai",
      model: "gpt-5.3-codex",
      usage: { input: 12, output: 3, totalTokens: 15 },
    },
  }), T0);
  agentDatabase.close();

  const stateDatabase = new (DatabaseSync as DatabaseConstructor)(stateDatabasePath);
  stateDatabase.exec("CREATE TABLE agent_databases (agent_id TEXT, path TEXT, schema_version INTEGER, last_seen_at INTEGER, size_bytes INTEGER, PRIMARY KEY (agent_id, path))");
  stateDatabase.prepare("INSERT INTO agent_databases VALUES (?, ?, ?, ?, ?)").run(
    "worker",
    path.join("relocated", "worker.sqlite"),
    19,
    T0,
    fs.statSync(agentDatabasePath).size,
  );
  stateDatabase.close();

  const roots = openclawSource.discover(context(home));
  assert.equal(roots.length, 1);
  assert.equal(roots[0].dir, path.dirname(agentDatabasePath));
  assert.deepEqual(roots[0].exts, [path.basename(agentDatabasePath)]);
  assert.equal(roots[0].text, false);
  assert.equal(parseRoot(openclawSource, roots[0])?.cumulative.total, 15);
});

sqliteTest("OpenClaw ignores an unsupported transcript schema and keeps diagnostic rollout discovery", () => {
  const home = scratchHome("openclaw-stale-db");
  const runtime = path.join(home, ".openclaw", "agents", "worker", "agent");
  const sessions = path.join(runtime, "codex-home", "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const db = new (DatabaseSync as DatabaseConstructor)(path.join(runtime, "openclaw-agent.sqlite"));
  db.exec("CREATE TABLE transcript_events (obsolete_payload TEXT)");
  db.close();

  const roots = openclawSource.discover(context(home));
  assert.equal(roots.length, 1);
  assert.equal(roots[0].dir, sessions);
  assert.equal(roots[0].format, "codex");
});

sqliteTest("Kilo reads current database messages only while OpenAI auth is OAuth", () => {
  const home = scratchHome("kilo");
  const data = path.join(home, "xdg", "kilo");
  fs.mkdirSync(data, { recursive: true });
  writeJson(path.join(data, "auth.json"), { openai: { type: "oauth", refresh: "not-read-by-test" } });
  const dbPath = path.join(data, "kilo.db");
  const db = new (DatabaseSync as DatabaseConstructor)(dbPath);
  db.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)");
  insert.run("m1", "s1", T0, T0, JSON.stringify({ id: "m1", sessionID: "s1", role: "assistant", time: { created: T0, completed: T0 + 1 }, modelID: "gpt-5.3-codex", providerID: "openai", tokens: { total: 90, input: 50, output: 15, reasoning: 4, cache: { read: 20, write: 5 } } }));
  insert.run("m2", "s1", T0 + 1000, T0 + 1000, JSON.stringify({ id: "m2", sessionID: "s1", role: "assistant", time: { created: T0 + 1000 }, modelID: "claude", providerID: "anthropic", tokens: { total: 10, input: 7, output: 3, reasoning: 0, cache: { read: 0, write: 0 } } }));
  insert.run("m3", "s1", T0 + 2000, T0 + 2000, JSON.stringify({ id: "m3", sessionID: "s1", role: "assistant", time: { created: T0 + 2000 }, modelID: "gpt-5.3-codex", providerID: "openai", tokens: { input: Number.MAX_SAFE_INTEGER, output: 1 } }));
  insert.run("m4", "s1", T0 + 3000, T0 + 3000, JSON.stringify({ id: "m4", sessionID: "s1", role: "assistant", time: { created: T0 + 3000 }, modelID: "gpt-5.3-codex", providerID: "openai", tokens: { input: 1.5, output: 1 } }));
  db.close();

  const [root] = kiloSource.discover(context(home, { XDG_DATA_HOME: path.join(home, "xdg") })).filter((item) => !item.text);
  assert.ok(root);
  const oauth = parseRoot(kiloSource, root);
  assert.ok(oauth);
  assert.equal(oauth.events.length, 1);
  assert.deepEqual(oauth.events[0].usage, { input: 75, cached: 20, cacheWrite: 5, output: 19, reasoning: 4, total: 94, requests: 1 });

  fs.writeFileSync(path.join(data, "auth.json"), "x".repeat(MAX_AUTH_METADATA_BYTES + 1));
  assert.throws(() => parseRoot(kiloSource, root), /Kilo auth metadata/);

  writeJson(path.join(data, "auth.json"), { openai: { type: "api", key: "not-read-by-test" } });
  assert.equal(parseRoot(kiloSource, root)?.events.length, 0);
  assert.equal(parseRoot(kiloSource, root, true)?.events.length, 2);
});

sqliteTest("Kilo rehydrates the current session_message discriminator and model reference", () => {
  const home = scratchHome("kilo-current-schema");
  const data = path.join(home, "xdg", "kilo");
  fs.mkdirSync(data, { recursive: true });
  writeJson(path.join(data, "auth.json"), { openai: { type: "oauth", refresh: "secret" } });
  const db = new (DatabaseSync as DatabaseConstructor)(path.join(data, "kilo.db"));
  db.exec("CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)");
  db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?)").run("m-current", "s-current", "assistant", JSON.stringify({
    time: { created: T0, completed: T0 + 10 },
    model: { id: "gpt-5.3-codex", providerID: "openai" },
    tokens: { input: 30, output: 6, total: 36 },
  }));
  db.close();

  const [root] = kiloSource.discover(context(home, { XDG_DATA_HOME: path.join(home, "xdg") })).filter((item) => !item.text);
  assert.ok(root);
  const session = parseRoot(kiloSource, root);
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.equal(session.events[0].model, "gpt-5.3-codex");
  assert.equal(session.events[0].provider, "openai-codex");
});

sqliteTest("Kilo streams message rows and gives the current table precedence over legacy duplicates", () => {
  const home = scratchHome("kilo-table-precedence");
  const data = path.join(home, "xdg", "kilo");
  fs.mkdirSync(data, { recursive: true });
  writeJson(path.join(data, "auth.json"), { openai: { type: "oauth" } });
  const db = new (DatabaseSync as DatabaseConstructor)(path.join(data, "kilo.db"));
  db.exec("CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)");
  db.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)");
  db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?)").run("shared", "s1", "assistant", JSON.stringify({
    time: { created: T0 },
    model: { id: "gpt-5.3-codex", providerID: "openai" },
    tokens: { input: 10, output: 2, total: 12 },
  }));
  db.prepare("INSERT INTO message VALUES (?, ?, ?)").run("shared", "s1", JSON.stringify({
    role: "assistant",
    time: { created: T0 },
    modelID: "gpt-5.3-codex",
    providerID: "openai",
    tokens: { input: 999, output: 1, total: 1_000 },
  }));
  db.close();

  const [root] = kiloSource.discover(context(home, { XDG_DATA_HOME: path.join(home, "xdg") })).filter((item) => !item.text);
  assert.ok(root);
  const session = parseRoot(kiloSource, root);
  assert.equal(session?.events.length, 1);
  assert.equal(session?.cumulative.total, 12);
  assert.equal(session?.lineCount, 1);
});

sqliteTest("Kilo matches OAuth to the exact provider and honors the environment override", () => {
  const home = scratchHome("kilo-auth-precedence");
  const data = path.join(home, "xdg", "kilo");
  fs.mkdirSync(data, { recursive: true });
  writeJson(path.join(data, "auth.json"), {
    openai: { type: "api", key: "file-secret" },
    "openai-codex": { type: "oauth", refresh: "other-provider-secret" },
  });
  const dbPath = path.join(data, "kilo.db");
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

  const env = { XDG_DATA_HOME: path.join(home, "xdg") };
  const [fileRoot] = kiloSource.discover(context(home, env)).filter((item) => !item.text);
  assert.ok(fileRoot);
  assert.equal(parseRoot(kiloSource, fileRoot)?.events.length, 0, "another provider's OAuth must not authorize openai rows");

  const envSecret = "env-secret-that-must-not-be-retained";
  const [envRoot] = kiloSource.discover(context(home, {
    ...env,
    KILO_AUTH_CONTENT: JSON.stringify({ openai: { type: "oauth", refresh: envSecret } }),
  })).filter((item) => !item.text);
  assert.ok(envRoot);
  assert.equal(parseRoot(kiloSource, envRoot)?.events.length, 1);
  assert.equal(JSON.stringify(envRoot).includes(envSecret), false);
});

test("Kilo discovers legacy channel databases only when the matching current name is absent", () => {
  const home = scratchHome("kilo-db-names");
  const data = path.join(home, "xdg", "kilo");
  fs.mkdirSync(data, { recursive: true });
  for (const name of ["kilo.db", "opencode.db", "kilo-beta.db", "opencode-beta.db", "opencode-nightly.db", "unrelated.db"]) {
    fs.writeFileSync(path.join(data, name), "");
  }
  const roots = kiloSource.discover(context(home, { XDG_DATA_HOME: path.join(home, "xdg") })).filter((item) => !item.text);
  assert.deepEqual(roots.map((root) => root.exts[0]).sort(), ["kilo-beta.db", "kilo.db", "opencode-nightly.db"]);
});

test("Kilo discovers its native macOS and Windows data directories", () => {
  const macHome = scratchHome("kilo-macos-path");
  const macData = path.join(macHome, "Library", "Application Support", "kilo");
  fs.mkdirSync(macData, { recursive: true });
  fs.writeFileSync(path.join(macData, "kilo.db"), "");
  const macRoots = kiloSource.discover(platformContext(macHome, "darwin")).filter((root) => !root.text);
  assert.deepEqual(macRoots.map((root) => path.join(root.dir, root.exts[0])), [path.join(macData, "kilo.db")]);

  const winHome = scratchHome("kilo-windows-path");
  const localAppData = path.join(winHome, "LocalAppData");
  const winData = path.join(localAppData, "kilo");
  fs.mkdirSync(winData, { recursive: true });
  fs.writeFileSync(path.join(winData, "kilo.db"), "");
  const winRoots = kiloSource
    .discover(platformContext(winHome, "win32", { LOCALAPPDATA: localAppData }))
    .filter((root) => !root.text);
  assert.deepEqual(winRoots.map((root) => path.join(root.dir, root.exts[0])), [path.join(winData, "kilo.db")]);

  const visibleWinHome = scratchHome("kilo-wsl-windows-path");
  const visibleWinData = path.join(visibleWinHome, "AppData", "Local", "kilo");
  fs.mkdirSync(visibleWinData, { recursive: true });
  fs.writeFileSync(path.join(visibleWinData, "kilo.db"), "");
  const visibleRoots = kiloSource.discover({
    homes: [{ home: visibleWinHome, origin: "windows", layout: "win32" }],
    platform: "wsl",
    env: { HOME: visibleWinHome, LOCALAPPDATA: path.join(visibleWinHome, "must-not-apply-to-wsl-visible-home") },
  }).filter((root) => !root.text);
  assert.deepEqual(visibleRoots.map((root) => path.join(root.dir, root.exts[0])), [path.join(visibleWinData, "kilo.db")]);
});

sqliteTest("KILO_DB selects an external database while auth stays in the platform data directory", () => {
  const home = scratchHome("kilo-external-db");
  const data = path.join(home, "Library", "Application Support", "kilo");
  const external = path.join(home, "external", "custom.db");
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.dirname(external), { recursive: true });
  writeJson(path.join(data, "auth.json"), { openai: { type: "oauth" } });
  const db = new (DatabaseSync as DatabaseConstructor)(external);
  db.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)");
  db.prepare("INSERT INTO message VALUES (?, ?, ?)").run("m1", "s1", JSON.stringify({
    role: "assistant",
    providerID: "openai",
    modelID: "gpt-5.3-codex",
    time: { created: T0 },
    tokens: { input: 10, output: 2, total: 12 },
  }));
  db.close();

  const [root] = kiloSource
    .discover(platformContext(home, "darwin", { KILO_DB: external }))
    .filter((candidate) => !candidate.text);
  assert.ok(root);
  assert.equal(path.join(root.dir, root.exts[0]), external);
  assert.equal(parseRoot(kiloSource, root)?.cumulative.total, 12);
});

sqliteTest("Hermes reads canonical model aggregates once and honors billing_provider", () => {
  const home = scratchHome("hermes");
  const hermesHome = path.join(home, "hermes-home");
  fs.mkdirSync(hermesHome, { recursive: true });
  const dbPath = path.join(hermesHome, "state.db");
  const db = new (DatabaseSync as DatabaseConstructor)(dbPath);
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL, last_activity_at REAL, cwd TEXT)");
  db.exec("CREATE TABLE session_model_usage (session_id TEXT, model TEXT, billing_provider TEXT, api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, first_seen REAL, last_seen REAL)");
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run("s1", T0 / 1000, (T0 + 5000) / 1000, "/work/hermes");
  const insert = db.prepare("INSERT INTO session_model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run("s1", "gpt-5.3-codex", "openai-codex", 3, 100, 15, 20, 5, 4, T0 / 1000, (T0 + 5000) / 1000);
  insert.run("s1", "claude", "anthropic", 1, 10, 2, 0, 0, 0, T0 / 1000, (T0 + 5000) / 1000);
  insert.run("s1", "overflow", "openai-codex", 1, Number.MAX_SAFE_INTEGER, 1, 0, 0, 0, T0 / 1000, (T0 + 6000) / 1000);
  insert.run("s1", "bad-reasoning", "openai-codex", 1, 10, 2, 0, 0, 3, T0 / 1000, (T0 + 7000) / 1000);
  db.close();
  writeJson(path.join(hermesHome, "sessions", "duplicate.jsonl"), {
    provider: "openai-codex",
    usage: { input_tokens: 999, output_tokens: 999 },
  });

  const roots = hermesSource.discover(context(home, { HERMES_HOME: hermesHome }));
  assert.equal(roots.length, 1, "the canonical database must suppress mirrored session snapshots");
  const root = roots.find((item) => !item.text);
  assert.ok(root);
  const session = parseRoot(hermesSource, root);
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.deepEqual(session.events[0].usage, { input: 125, cached: 20, cacheWrite: 5, output: 15, reasoning: 4, total: 140, requests: 3 });
  assert.equal(session.cumulative.requests, 3);
});

sqliteTest("Hermes reconciles positive session residuals without double-counting model rows", () => {
  const home = scratchHome("hermes-residuals");
  const hermesHome = path.join(home, "hermes-home");
  fs.mkdirSync(hermesHome, { recursive: true });
  const db = new (DatabaseSync as DatabaseConstructor)(path.join(hermesHome, "state.db"));
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, billing_provider TEXT, billing_mode TEXT, api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, started_at REAL, last_activity_at REAL, cwd TEXT)");
  db.exec("CREATE TABLE session_model_usage (session_id TEXT, model TEXT, billing_provider TEXT, billing_mode TEXT, api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, first_seen REAL, last_seen REAL)");
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "s1", "gpt-5.4-codex", "openai-codex", "subscription_included", 8,
    160, 30, 35, 7, 9, T0 / 1000, (T0 + 9000) / 1000, "/work/hermes",
  );
  const insert = db.prepare("INSERT INTO session_model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run("s1", "gpt-5.3-codex", "openai-codex", "subscription_included", 3, 100, 15, 20, 5, 4, T0 / 1000, (T0 + 5000) / 1000);
  insert.run("s1", "gpt-5.3-codex", "openai", "subscription_included", 2, 20, 5, 10, 1, 2, T0 / 1000, (T0 + 6000) / 1000);
  db.close();

  const [root] = hermesSource.discover(context(home, { HERMES_HOME: hermesHome }));
  assert.ok(root);
  const session = parseRoot(hermesSource, root);
  assert.ok(session);
  assert.equal(session.events.length, 2, "billing mode alone is not OAuth proof, but the excluded row is still deducted before residual accounting");
  assert.deepEqual(session.events.map((event) => event.model), ["gpt-5.3-codex", "gpt-5.4-codex"]);
  assert.deepEqual(session.events[1].usage, {
    input: 46,
    cached: 5,
    cacheWrite: 1,
    output: 10,
    reasoning: 0,
    total: 56,
    requests: 3,
  });
  assert.deepEqual(session.cumulative, {
    input: 171,
    cached: 25,
    cacheWrite: 6,
    output: 25,
    reasoning: 4,
    total: 196,
    requests: 6,
  });
});

sqliteTest("Hermes preserves a request-only session residual", () => {
  const home = scratchHome("hermes-request-residual");
  const hermesHome = path.join(home, "hermes-home");
  fs.mkdirSync(hermesHome, { recursive: true });
  const db = new (DatabaseSync as DatabaseConstructor)(path.join(hermesHome, "state.db"));
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, billing_provider TEXT, api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER)");
  db.exec("CREATE TABLE session_model_usage (session_id TEXT, model TEXT, billing_provider TEXT, api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER)");
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)").run("s1", "gpt-5.3-codex", "openai-codex", 5, 10, 2);
  db.prepare("INSERT INTO session_model_usage VALUES (?, ?, ?, ?, ?, ?)").run("s1", "gpt-5.3-codex", "openai-codex", 2, 10, 2);
  db.close();

  const [root] = hermesSource.discover(context(home, { HERMES_HOME: hermesHome }));
  assert.ok(root);
  const session = parseRoot(hermesSource, root);
  assert.ok(session);
  assert.equal(session.events.length, 2);
  assert.deepEqual(session.events[1].usage, {
    input: 0,
    cached: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    total: 0,
    requests: 3,
  });
  assert.equal(session.cumulative.requests, 5);
  assert.equal(session.cumulative.total, 12);
});

sqliteTest("Hermes reads a canonical minimum schema with optional columns absent", () => {
  const home = scratchHome("hermes-minimum-schema");
  const hermesHome = path.join(home, "hermes-home");
  fs.mkdirSync(hermesHome, { recursive: true });
  const db = new (DatabaseSync as DatabaseConstructor)(path.join(hermesHome, "state.db"));
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, billing_provider TEXT, input_tokens INTEGER, output_tokens INTEGER)");
  db.exec("CREATE TABLE session_model_usage (session_id TEXT, model TEXT, billing_provider TEXT, input_tokens INTEGER, output_tokens INTEGER)");
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)").run("s1", "gpt-5.3-codex", "openai-codex", 12, 3);
  db.prepare("INSERT INTO session_model_usage VALUES (?, ?, ?, ?, ?)").run("s1", "gpt-5.3-codex", "openai-codex", 12, 3);
  db.close();

  const [root] = hermesSource.discover(context(home, { HERMES_HOME: hermesHome }));
  assert.ok(root);
  const session = parseRoot(hermesSource, root);
  assert.ok(session);
  assert.equal(session.events.length, 1);
  assert.deepEqual(session.events[0].usage, {
    input: 12,
    cached: 0,
    cacheWrite: 0,
    output: 3,
    reasoning: 0,
    total: 15,
    requests: 1,
  });
});

sqliteTest("Hermes keeps legacy snapshots when session_model_usage is only a partial schema", () => {
  const home = scratchHome("hermes-partial-model-schema");
  const hermesHome = path.join(home, "hermes-home");
  const sessions = path.join(hermesHome, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, "session.jsonl"), "{}\n");
  const db = new (DatabaseSync as DatabaseConstructor)(path.join(hermesHome, "state.db"));
  db.exec("CREATE TABLE session_model_usage (session_id TEXT, model TEXT, input_tokens INTEGER)");
  db.close();

  const roots = hermesSource.discover(context(home, { HERMES_HOME: hermesHome }));
  assert.equal(roots.length, 1);
  assert.equal(roots[0].dir, sessions);
  assert.equal(roots[0].text, true);
});

sqliteTest("SQLite-backed profiles retain distinct non-path session identities", () => {
  const home = scratchHome("sqlite-identities");
  const hermesHome = path.join(home, "hermes-home");
  const ids: string[] = [];
  for (const profile of ["one", "two"]) {
    const dir = path.join(hermesHome, "profiles", profile);
    fs.mkdirSync(dir, { recursive: true });
    const db = new (DatabaseSync as DatabaseConstructor)(path.join(dir, "state.db"));
    db.exec("CREATE TABLE usage (input_tokens INTEGER, output_tokens INTEGER, provider TEXT, created_at INTEGER)");
    db.prepare("INSERT INTO usage VALUES (?, ?, ?, ?)").run(10, 2, "openai-codex", T0);
    db.close();
  }

  const roots = hermesSource.discover(context(home, { HERMES_HOME: hermesHome })).filter((root) => !root.text);
  assert.equal(roots.length, 2);
  for (const root of roots) {
    const session = parseRoot(hermesSource, root);
    assert.ok(session);
    ids.push(session.sessionId);
    assert.equal(session.sessionId.includes(hermesHome), false);
  }
  assert.equal(new Set(ids).size, 2);
});

sqliteTest("Hermes uses session snapshots when state.db has no recognized usage schema", () => {
  const home = scratchHome("hermes-stale-db");
  const hermesHome = path.join(home, "hermes-home");
  const sessions = path.join(hermesHome, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, "session.jsonl"), "{}\n");
  const db = new (DatabaseSync as DatabaseConstructor)(path.join(hermesHome, "state.db"));
  db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)");
  db.close();

  const roots = hermesSource.discover(context(home, { HERMES_HOME: hermesHome }));
  assert.equal(roots.length, 1);
  assert.equal(roots[0].dir, sessions);
  assert.equal(roots[0].text, true);
});

test("SQLite file version includes WAL changes", () => {
  const dir = scratchHome("sqlite-version");
  const dbPath = path.join(dir, "usage.db");
  fs.writeFileSync(dbPath, "db");
  const before = sqliteFileVersion(dbPath, fs.statSync(dbPath));
  fs.writeFileSync(`${dbPath}-wal`, "wal");
  const withWal = sqliteFileVersion(dbPath, fs.statSync(dbPath));
  assert.equal(withWal.size, before.size + 3);
  fs.appendFileSync(`${dbPath}-wal`, "-next");
  const changed = sqliteFileVersion(dbPath, fs.statSync(dbPath));
  assert.notDeepEqual(changed, withWal);
});
