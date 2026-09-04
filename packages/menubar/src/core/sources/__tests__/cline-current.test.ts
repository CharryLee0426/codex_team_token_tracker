import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { clineSource } from "../cline";
import type { SessionRoot, SourceContext, SourceFile } from "../types";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cline-current-"));

after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function mkdir(relativePath: string): string {
  const absolutePath = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(absolutePath, { recursive: true });
  return absolutePath;
}

function discoveryCtx(home: string, env: NodeJS.ProcessEnv = {}): SourceContext {
  return {
    env,
    homes: [{ home, origin: "local", layout: "linux" }],
    platform: "linux",
  };
}

function sourceFile(filePath: string, root: SessionRoot): SourceFile {
  return {
    path: filePath,
    root,
    text: fs.readFileSync(filePath, "utf8"),
  };
}

test("discovers current Cline sessions and legacy tasks with local override precedence", () => {
  const home = mkdir("override/home");
  const clineDir = mkdir("override/cline-dir");
  const dataDir = mkdir("override/data-dir");
  const sessionDir = mkdir("override/session-dir");
  const vscodeRoot = mkdir(
    "override/home/.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
  );

  mkdir("override/home/.cline/data/sessions");
  mkdir("override/home/.cline/data/tasks");
  mkdir("override/cline-dir/data/sessions");
  mkdir("override/cline-dir/data/tasks");
  mkdir("override/data-dir/sessions");
  const dataTasks = mkdir("override/data-dir/tasks");

  const roots = clineSource.discover(
    discoveryCtx(home, {
      CLINE_DIR: clineDir,
      CLINE_DATA_DIR: dataDir,
      CLINE_SESSION_DATA_DIR: sessionDir,
    }),
  );
  const byDir = new Map(roots.map((root) => [root.dir, root]));

  assert.deepEqual(new Set(byDir.keys()), new Set([sessionDir, dataTasks, vscodeRoot]));
  assert.deepEqual(byDir.get(sessionDir)?.exts, [".messages.json"]);
  assert.equal(byDir.get(sessionDir)?.source, "cline");
  assert.equal(byDir.get(sessionDir)?.agent, "cline");
  assert.deepEqual(byDir.get(dataTasks)?.exts, ["ui_messages.json"]);
});

test("falls back from CLINE_DATA_DIR to CLINE_DIR/data and then ~/.cline/data", () => {
  const home = mkdir("fallback/home");
  const clineDir = mkdir("fallback/cline-dir");
  const clineSessions = mkdir("fallback/cline-dir/data/sessions");
  const clineTasks = mkdir("fallback/cline-dir/data/tasks");
  const defaultSessions = mkdir("fallback/home/.cline/data/sessions");
  const defaultTasks = mkdir("fallback/home/.cline/data/tasks");

  const clineDirRoots = clineSource.discover(
    discoveryCtx(home, { CLINE_DIR: clineDir }),
  );
  assert.deepEqual(
    new Set(clineDirRoots.map((root) => root.dir)),
    new Set([clineSessions, clineTasks]),
  );

  const defaultRoots = clineSource.discover(discoveryCtx(home));
  assert.deepEqual(
    new Set(defaultRoots.map((root) => root.dir)),
    new Set([defaultSessions, defaultTasks]),
  );
});

test("parses v1 Cline envelopes without double-counting cache or reasoning tokens", async () => {
  const home = mkdir("envelope/home");
  const sessionsDir = mkdir("envelope/sessions");
  const sessionDir = mkdir("envelope/sessions/session-1");
  const filePath = path.join(sessionDir, "session-1.messages.json");
  const startedAt = Date.UTC(2026, 8, 3, 12);
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      updated_at: new Date(startedAt + 5_000).toISOString(),
      agent: "lead",
      sessionId: "session-1",
      origin: { source: "cline", mode: "task" },
      messages: [
        { role: "user", ts: startedAt, content: [{ type: "text", text: "private" }] },
        {
          role: "assistant",
          ts: startedAt + 1_000,
          modelInfo: { id: "gpt-5-codex", provider: "openai-codex" },
          metrics: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 40,
            cacheWriteTokens: 10,
            cost: 0,
          },
        },
        {
          role: "assistant",
          ts: startedAt + 2_000,
          modelInfo: { id: "claude-sonnet-4", provider: "anthropic" },
          metrics: { inputTokens: 50, outputTokens: 10 },
        },
        {
          role: "assistant",
          ts: startedAt + 3_000,
          modelInfo: { id: "gpt-5-codex", provider: "openai-codex-cli" },
          metrics: { inputTokens: 70, outputTokens: 30 },
        },
        {
          role: "assistant",
          ts: startedAt + 4_000,
          modelInfo: { id: "gpt-5-codex", provider: "openai-codex" },
          metrics: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 11 },
        },
        {
          role: "assistant",
          ts: startedAt + 5_000,
          modelInfo: { id: "gpt-5-codex", provider: "openai-codex" },
          metrics: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 },
        },
      ],
    }),
  );

  const root = clineSource
    .discover(discoveryCtx(home, { CLINE_SESSION_DATA_DIR: sessionsDir }))
    .find((candidate) => candidate.exts.includes(".messages.json"));
  assert.ok(root);

  const parsed = await clineSource.parse(sourceFile(filePath, root), {
    includeAllProviders: false,
  });
  assert.ok(parsed);
  assert.equal(parsed.source, "cline");
  assert.equal(parsed.agent, "cline");
  assert.equal(parsed.sessionId, "session-1");
  assert.equal(parsed.startedAt, startedAt);
  assert.equal(parsed.lastActivityAt, startedAt + 1_000);
  assert.equal(parsed.provider, "openai-codex");
  assert.equal(parsed.model, "gpt-5-codex");
  assert.equal(parsed.lineCount, 6);
  assert.deepEqual(parsed.events, [
    {
      ts: startedAt + 1_000,
      model: "gpt-5-codex",
      agent: "cline",
      provider: "openai-codex",
      usage: {
        input: 100,
        cached: 40,
        cacheWrite: 10,
        output: 20,
        reasoning: 0,
        total: 120,
        requests: 1,
      },
    },
  ]);
  assert.equal(parsed.cumulative.input, 100);
  assert.equal(parsed.cumulative.cached, 40);
  assert.equal(parsed.cumulative.cacheWrite, 10);
  assert.equal(parsed.cumulative.output, 20);
  assert.equal(parsed.cumulative.reasoning, 0);
  assert.equal(parsed.cumulative.total, 120);
  assert.equal(parsed.cumulative.requests, 1);

  assert.ok(clineSource.parsePath);
  const streamed = await clineSource.parsePath({ path: filePath, root }, { includeAllProviders: false });
  assert.deepEqual(streamed, parsed);

  const allProviders = await clineSource.parse(sourceFile(filePath, root), {
    includeAllProviders: true,
  });
  assert.ok(allProviders);
  assert.deepEqual(
    allProviders.events.map((event) => event.provider),
    ["openai-codex", "anthropic"],
  );
});

test("legacy Cline-family messages require the exact OAuth provider", async () => {
  const home = mkdir("legacy/home");
  const tasksDir = mkdir("legacy/data/tasks");
  const taskDir = mkdir("legacy/data/tasks/task-1");
  const messagesPath = path.join(taskDir, "ui_messages.json");
  const metadataPath = path.join(taskDir, "task_metadata.json");
  const startedAt = Date.UTC(2026, 8, 3, 14);

  const providers = [
    "openai-codex",
    "openai",
    undefined,
    "openai-codex-cli",
    "anthropic",
  ];
  fs.writeFileSync(
    metadataPath,
    JSON.stringify({
      model_usage: providers.map((provider, index) => ({
        ts: startedAt + index * 1_000 - 100,
        model_id: index === 4 ? "claude-sonnet-4" : "gpt-5-codex",
        ...(provider ? { model_provider_id: provider } : {}),
      })),
    }),
  );
  fs.writeFileSync(
    messagesPath,
    JSON.stringify(
      providers.map((_, index) => ({
        ts: startedAt + index * 1_000,
        type: "say",
        say: "api_req_started",
        text: JSON.stringify({
          tokensIn: 15,
          tokensOut: 5,
          cacheReads: 3,
          cacheWrites: 2,
        }),
      })),
    ),
  );

  const root = clineSource
    .discover(discoveryCtx(home, { CLINE_DATA_DIR: path.dirname(tasksDir) }))
    .find((candidate) => candidate.dir === tasksDir);
  assert.ok(root);

  const parsed = await clineSource.parse(sourceFile(messagesPath, root), {
    includeAllProviders: false,
  });
  assert.ok(parsed);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.provider, "openai-codex");
  assert.equal(parsed.model, "gpt-5-codex");
  assert.equal(parsed.lastActivityAt, startedAt);
  assert.deepEqual(parsed.events[0], {
    ts: startedAt,
    model: "gpt-5-codex",
    agent: "cline",
    provider: "openai-codex",
    usage: {
      input: 20,
      cached: 3,
      cacheWrite: 2,
      output: 5,
      reasoning: 0,
      total: 25,
      requests: 1,
    },
  });

  assert.ok(clineSource.parsePath);
  const streamed = await clineSource.parsePath({ path: messagesPath, root }, { includeAllProviders: false });
  assert.deepEqual(streamed, parsed);

  const allProviders = await clineSource.parse(sourceFile(messagesPath, root), {
    includeAllProviders: true,
  });
  assert.ok(allProviders);
  assert.deepEqual(
    allProviders.events.map((event) => event.provider),
    ["openai-codex", "openai", "unknown", "anthropic"],
  );
});

test("streaming current Cline parsing matches JSON.parse for duplicate message properties", async () => {
  const home = mkdir("duplicate/home");
  const sessionsDir = mkdir("duplicate/sessions");
  const sessionDir = mkdir("duplicate/sessions/session-duplicate");
  const filePath = path.join(sessionDir, "session-duplicate.messages.json");
  const startedAt = Date.UTC(2026, 8, 3, 16);
  const first = JSON.stringify({
    role: "assistant",
    ts: startedAt,
    modelInfo: { id: "discarded", provider: "openai-codex" },
    metrics: { inputTokens: 100, outputTokens: 20 },
  });
  const last = JSON.stringify({
    role: "assistant",
    ts: startedAt + 1_000,
    modelInfo: { id: "kept", provider: "openai-codex" },
    metrics: { inputTokens: 3, outputTokens: 2 },
  });
  fs.writeFileSync(
    filePath,
    `{"version":1,"messages":[${first}],"messages":[${last}],"sessionId":"session-duplicate"}`,
  );

  const root = clineSource
    .discover(discoveryCtx(home, { CLINE_SESSION_DATA_DIR: sessionsDir }))
    .find((candidate) => candidate.exts.includes(".messages.json"));
  assert.ok(root);

  const parsed = clineSource.parse(sourceFile(filePath, root), { includeAllProviders: false });
  assert.ok(parsed);
  assert.equal(parsed.model, "kept");
  assert.equal(parsed.lineCount, 1);
  assert.equal(parsed.cumulative.total, 5);

  assert.ok(clineSource.parsePath);
  const streamed = await clineSource.parsePath({ path: filePath, root }, { includeAllProviders: false });
  assert.deepEqual(streamed, parsed);
});

test("current Cline parsing does not retain content or oversized accounting metadata", async () => {
  const home = mkdir("bounded/home");
  const sessionsDir = mkdir("bounded/sessions");
  const sessionDir = mkdir("bounded/sessions/session-bounded");
  const filePath = path.join(sessionDir, "session-bounded.messages.json");
  const privateContent = `private-${"x".repeat(8 * 1024)}`;
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      sessionId: "s".repeat(8 * 1024),
      messages: [{
        role: "assistant",
        ts: Date.UTC(2026, 8, 3, 17),
        content: privateContent,
        modelInfo: { id: "m".repeat(8 * 1024), provider: "openai-codex" },
        metrics: { inputTokens: 3, outputTokens: 2 },
      }],
    }),
  );

  const root = clineSource
    .discover(discoveryCtx(home, { CLINE_SESSION_DATA_DIR: sessionsDir }))
    .find((candidate) => candidate.exts.includes(".messages.json"));
  assert.ok(root);

  const parsed = clineSource.parse(sourceFile(filePath, root), { includeAllProviders: false });
  assert.ok(parsed);
  assert.equal(parsed.sessionId, "session-bounded");
  assert.equal(parsed.model, "unknown");
  assert.equal(parsed.cumulative.total, 5);
  assert.equal(JSON.stringify(parsed).includes(privateContent), false);

  assert.ok(clineSource.parsePath);
  const streamed = await clineSource.parsePath({ path: filePath, root }, { includeAllProviders: false });
  assert.deepEqual(streamed, parsed);
});

test("malformed current Cline snapshots fail parsing instead of looking authoritatively empty", async () => {
  const sessionsDir = mkdir("malformed/sessions");
  const sessionDir = mkdir("malformed/sessions/session-torn");
  const filePath = path.join(sessionDir, "session-torn.messages.json");
  fs.writeFileSync(filePath, "{\"version\":1,\"messages\":[");
  const root = clineSource
    .discover(discoveryCtx(mkdir("malformed/home"), { CLINE_SESSION_DATA_DIR: sessionsDir }))
    .find((candidate) => candidate.exts.includes(".messages.json"));
  assert.ok(root);

  assert.throws(
    () => clineSource.parse(sourceFile(filePath, root), { includeAllProviders: false }),
    /Cline JSON/,
  );
  assert.ok(clineSource.parsePath);
  await assert.rejects(
    clineSource.parsePath({ path: filePath, root }, { includeAllProviders: false }),
    /Cline JSON/,
  );
});
