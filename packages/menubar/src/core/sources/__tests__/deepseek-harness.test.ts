import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import * as zlib from "node:zlib";

import { DEFAULT_SOURCES } from "../../config";
import { computeStats } from "../../stats";
import { sourceFor } from "../index";
import { deepseekHarnessSource } from "../deepseek-harness";
import type { SessionRoot, SourceContext, SourceFile } from "../types";
import { MAX_AUTH_METADATA_BYTES } from "../util";

type ZstdRuntime = {
  constants?: Record<string, number>;
  zstdCompressSync?: (buffer: Uint8Array, options?: unknown) => Uint8Array;
};

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-source-"));
const zstdRuntime = zlib as unknown as ZstdRuntime;
const zstdTest = zstdRuntime.zstdCompressSync ? test : test.skip;
const zstdChecksumTest = zstdRuntime.zstdCompressSync && zstdRuntime.constants?.ZSTD_c_checksumFlag !== undefined
  ? test
  : test.skip;

after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function mkdir(relativePath: string): string {
  const absolutePath = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(absolutePath, { recursive: true });
  return absolutePath;
}

function context(home: string, env: NodeJS.ProcessEnv = {}): SourceContext {
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
    text: root.text ? fs.readFileSync(filePath, "utf8") : "",
  };
}

function header(id: string, createdAt: number, cwd = "/work/dsh") {
  return { type: "session", version: 0, id, createdAt, cwd, delegationDepth: 0 };
}

function writeOauth(dshHome: string): void {
  fs.mkdirSync(dshHome, { recursive: true });
  fs.writeFileSync(path.join(dshHome, ".credentials.yaml"), [
    "version: 1",
    "records:",
    "  llm-pi-ai/openai-codex:",
    "    kind: grant",
    "    payload:",
    "      type: oauth",
    "      access: private-token-not-retained",
    "",
  ].join("\n"));
}

function assistant(
  time: number,
  provider: string,
  usage: Record<string, number>,
  model = "gpt-5-codex",
  step = 1,
) {
  return {
    type: "assistant/message",
    seq: 3,
    time,
    data: {
      turn: 1,
      step,
      message: {
        id: `assistant-${time}`,
        role: "assistant",
        content: [{ type: "text", text: "private response" }],
        source: { kind: "model", provider, model },
      },
      usage,
    },
  };
}

test("discovers DSH_HOME session logs as separate plaintext and zstd roots", () => {
  const home = mkdir("discover/home");
  const defaultSessions = mkdir("discover/home/.dsh/sessions");
  const overrideSessions = mkdir("discover/override/sessions");
  const tildeSessions = mkdir("discover/home/custom-dsh/sessions");

  assert.equal(DEFAULT_SOURCES.dsh, true);

  const defaultRoots = deepseekHarnessSource.discover(context(home));
  assert.deepEqual(
    defaultRoots.map((root) => [root.dir, root.exts, root.text]),
    [
      [defaultSessions, ["session.jsonl"], true],
      [defaultSessions, ["session.jsonl.zstd"], false],
    ],
  );

  const overrideRoots = deepseekHarnessSource.discover(
    context(home, { DSH_HOME: path.dirname(overrideSessions) }),
  );
  assert.deepEqual(overrideRoots.map((root) => root.dir), [overrideSessions, overrideSessions]);
  assert.ok(overrideRoots.every((root) => root.source === "dsh" && root.agent === "dsh"));
  assert.ok(overrideRoots.every((root) => sourceFor(root) === deepseekHarnessSource));

  const tildeRoots = deepseekHarnessSource.discover(context(home, { DSH_HOME: "~/custom-dsh" }));
  assert.ok(tildeRoots.every((root) => root.dir === tildeSessions));

  const relativeHome = path.relative(process.cwd(), path.dirname(overrideSessions));
  const relativeRoots = deepseekHarnessSource.discover(context(home, { DSH_HOME: relativeHome }));
  assert.deepEqual(relativeRoots.map((root) => root.dir), [overrideSessions, overrideSessions]);
});

test("parses only exact openai-codex model usage and preserves disjoint buckets", () => {
  const sessions = mkdir("plain/.dsh/sessions");
  const sessionDir = mkdir("plain/.dsh/sessions/--work-dsh--/session-one");
  const filePath = path.join(sessionDir, "session.jsonl");
  writeOauth(path.join(fixtureRoot, "plain", ".dsh"));
  const createdAt = Date.UTC(2026, 8, 3, 18);
  const records = [
    header("session-one", createdAt),
    { type: "user/message", seq: 1, time: createdAt + 100, data: { message: { role: "user", content: "private prompt" } } },
    assistant(createdAt + 1_000, "openai-codex", {
      inputTokens: 100,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      outputTokens: 25,
      reasoningTokens: 5,
      totalTokens: 175,
    }),
    assistant(createdAt + 2_000, "openai", { inputTokens: 80, outputTokens: 20 }, "gpt-5-codex", 2),
    assistant(createdAt + 3_000, "anthropic", { inputTokens: 60, outputTokens: 15 }, "claude-sonnet-4", 3),
  ];
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

  const root = deepseekHarnessSource
    .discover(context(path.join(fixtureRoot, "plain")))
    .find((candidate) => candidate.text);
  assert.ok(root);
  assert.equal(root.dir, sessions);

  const parsed = deepseekHarnessSource.parse(sourceFile(filePath, root), {
    includeAllProviders: false,
  });
  assert.ok(parsed);
  assert.equal(parsed.sessionId, "session-one");
  assert.equal(parsed.source, "dsh");
  assert.equal(parsed.agent, "dsh");
  assert.equal(parsed.cwd, "/work/dsh");
  assert.equal(parsed.projectName, "dsh");
  assert.equal(parsed.startedAt, createdAt);
  assert.equal(parsed.lastActivityAt, createdAt + 3_000);
  assert.equal(parsed.lineCount, records.length);
  assert.deepEqual(parsed.events, [
    {
      ts: createdAt + 1_000,
      model: "gpt-5-codex",
      agent: "dsh",
      provider: "openai-codex",
      usage: {
        input: 150,
        cached: 40,
        cacheWrite: 10,
        output: 25,
        reasoning: 5,
        total: 175,
        requests: 1,
      },
    },
  ]);
  assert.deepEqual(parsed.cumulative, parsed.events[0].usage);

  const allProviders = deepseekHarnessSource.parse(sourceFile(filePath, root), {
    includeAllProviders: true,
  });
  assert.ok(allProviders);
  assert.deepEqual(
    allProviders.events.map((event) => event.provider),
    ["openai-codex", "openai", "anthropic"],
  );
});

test("streams plaintext logs with the same committed-record and error semantics", async () => {
  const home = mkdir("streaming");
  const dshHome = path.join(home, ".dsh");
  const sessionDir = mkdir("streaming/.dsh/sessions/project/session-streaming");
  const filePath = path.join(sessionDir, "session.jsonl");
  const createdAt = Date.UTC(2026, 8, 3, 18, 15);
  writeOauth(dshHome);
  fs.writeFileSync(filePath, [
    JSON.stringify(header("session-streaming", createdAt)),
    JSON.stringify(assistant(createdAt + 1_000, "openai-codex", { inputTokens: 10, outputTokens: 2 })),
    '{"type":',
  ].join("\n"));

  const root = deepseekHarnessSource.discover(context(home)).find((candidate) => candidate.text);
  assert.ok(root);
  const parsePath = deepseekHarnessSource.parsePath;
  assert.ok(parsePath);

  const synchronous = deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false });
  const streamed = await parsePath({ path: filePath, root }, { includeAllProviders: false });
  assert.deepEqual(streamed, synchronous, "both parsers should ignore the same uncommitted final tail");

  fs.appendFileSync(filePath, "\n");
  assert.throws(
    () => deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false }),
    /invalid DeepSeek Harness JSONL record at line 3/,
  );
  await assert.rejects(
    parsePath({ path: filePath, root }, { includeAllProviders: false }),
    /invalid DeepSeek Harness JSONL record at line 3/,
  );
});

test("bounds memory used by a single streamed DSH JSONL record", async () => {
  const home = mkdir("streaming-line-limit");
  const dshHome = path.join(home, ".dsh");
  const sessionDir = mkdir("streaming-line-limit/.dsh/sessions/project/session-line-limit");
  const filePath = path.join(sessionDir, "session.jsonl");
  writeOauth(dshHome);
  fs.writeFileSync(filePath, `${JSON.stringify(header("session-line-limit", Date.UTC(2026, 8, 3, 18, 20)))}\n`);
  fs.appendFileSync(filePath, Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
  fs.appendFileSync(filePath, "\n");

  const root = deepseekHarnessSource.discover(context(home)).find((candidate) => candidate.text);
  assert.ok(root);
  const parsePath = deepseekHarnessSource.parsePath;
  assert.ok(parsePath);
  await assert.rejects(
    parsePath({ path: filePath, root }, { includeAllProviders: false }),
    /DeepSeek Harness JSONL record exceeds the streaming line-size limit/,
  );
});

test("DSH fails closed unless current metadata identifies the route as OAuth", () => {
  const home = mkdir("auth");
  const dshHome = mkdir("auth/.dsh");
  const sessionDir = mkdir("auth/.dsh/sessions/project/session-auth");
  const filePath = path.join(sessionDir, "session.jsonl");
  const createdAt = Date.UTC(2026, 8, 3, 18, 30);
  fs.writeFileSync(filePath, `${[
    header("session-auth", createdAt),
    assistant(createdAt + 1_000, "openai-codex", { inputTokens: 10, outputTokens: 2 }),
  ].map((record) => JSON.stringify(record)).join("\n")}\n`);

  fs.writeFileSync(path.join(dshHome, ".credentials.yaml"), [
    "version: 1",
    "records:",
    "  llm-pi-ai/openai-codex:",
    "    kind: api-key",
    "    key: must-not-be-retained",
    "",
  ].join("\n"));
  let root = deepseekHarnessSource.discover(context(home)).find((candidate) => candidate.text);
  assert.ok(root);
  assert.equal(deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false })?.events.length, 0);

  writeOauth(dshHome);
  fs.writeFileSync(path.join(dshHome, "settings.yaml"), [
    "llm-pi-ai:",
    "  providers:",
    "    openai-codex:",
    "      apiKeyEnv: OPENAI_API_KEY",
    "",
  ].join("\n"));
  root = deepseekHarnessSource.discover(context(home)).find((candidate) => candidate.text);
  assert.ok(root);
  assert.equal(deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false })?.events.length, 0);
  const diagnostic = deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: true });
  assert.ok(diagnostic);
  assert.deepEqual(diagnostic.events.map((event) => event.provider), ["openai-codex-unverified"]);
  assert.deepEqual(
    computeStats({ sessions: [diagnostic], now: createdAt + 2_000 }).sessions,
    [],
    "trackAllProviders diagnostics must never turn an API-key route into uploadable Codex OAuth usage",
  );
  assert.equal(JSON.stringify(root).includes("must-not-be-retained"), false);

  fs.writeFileSync(path.join(dshHome, "settings.yaml"), "llm-pi-ai: [\n");
  root = deepseekHarnessSource.discover(context(home)).find((candidate) => candidate.text);
  assert.ok(root);
  assert.throws(
    () => deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false }),
    /Invalid or unreadable DeepSeek Harness settings metadata/,
  );
});

test("DSH rejects oversized auth sidecars before parsing or retaining their contents", () => {
  const home = mkdir("auth-size-limit");
  const dshHome = mkdir("auth-size-limit/.dsh");
  const sessionDir = mkdir("auth-size-limit/.dsh/sessions/project/session-auth-size-limit");
  const filePath = path.join(sessionDir, "session.jsonl");
  const createdAt = Date.UTC(2026, 8, 3, 18, 35);
  fs.writeFileSync(filePath, `${[
    header("session-auth-size-limit", createdAt),
    assistant(createdAt + 1_000, "openai-codex", { inputTokens: 10, outputTokens: 2 }),
  ].map((record) => JSON.stringify(record)).join("\n")}\n`);
  writeOauth(dshHome);

  const oversized = Buffer.alloc(MAX_AUTH_METADATA_BYTES + 1, 0x20);
  fs.writeFileSync(path.join(dshHome, "settings.yaml"), oversized);
  const settingsRoot = deepseekHarnessSource.discover(context(home)).find((candidate) => candidate.text);
  assert.ok(settingsRoot);
  assert.throws(
    () => deepseekHarnessSource.parse(sourceFile(filePath, settingsRoot), { includeAllProviders: true }),
    /Invalid or unreadable DeepSeek Harness settings metadata/,
  );

  fs.writeFileSync(path.join(dshHome, "settings.yaml"), "");
  fs.writeFileSync(path.join(dshHome, ".credentials.yaml"), oversized);
  const credentialsRoot = deepseekHarnessSource.discover(context(home)).find((candidate) => candidate.text);
  assert.ok(credentialsRoot);
  assert.throws(
    () => deepseekHarnessSource.parse(sourceFile(filePath, credentialsRoot), { includeAllProviders: true }),
    /Invalid or unreadable DeepSeek Harness credential metadata/,
  );
});

test("DSH replaces usage samples within an attempt and adds retry attempts", () => {
  const home = mkdir("attempts");
  const dshHome = path.join(home, ".dsh");
  const sessionDir = mkdir("attempts/.dsh/sessions/project/session-attempts");
  const filePath = path.join(sessionDir, "session.jsonl");
  const createdAt = Date.UTC(2026, 8, 3, 18, 45);
  writeOauth(dshHome);
  const records = [
    header("session-attempts", createdAt),
    {
      type: "request/header", seq: 1, time: createdAt + 10,
      data: { header: { config: { provider: "openai-codex", model: "gpt-5-codex" } }, reason: "initial" },
    },
    {
      type: "assistant/chunk", seq: 2, time: createdAt + 20,
      data: { turn: 1, step: 1, chunk: { type: "usage", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } } },
    },
    assistant(createdAt + 30, "openai-codex", { inputTokens: 14, outputTokens: 5, totalTokens: 19 }),
    {
      type: "assistant/chunk", seq: 4, time: createdAt + 40,
      data: { turn: 1, step: 2, chunk: { type: "usage", usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 } } },
    },
    { type: "llm/retry-started", seq: 5, time: createdAt + 50, data: { turn: 1, step: 2, retry: 1 } },
    {
      ...assistant(createdAt + 60, "openai-codex", { inputTokens: 25, outputTokens: 4, totalTokens: 29 }),
      seq: 6,
      data: {
        ...assistant(createdAt + 60, "openai-codex", { inputTokens: 25, outputTokens: 4, totalTokens: 29 }).data,
        turn: 1,
        step: 2,
      },
    },
  ];
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

  const root = deepseekHarnessSource.discover(context(home)).find((candidate) => candidate.text);
  assert.ok(root);
  const parsed = deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false });
  assert.ok(parsed);
  assert.deepEqual(parsed.events.map((event) => event.usage.total), [19, 23, 29]);
  assert.equal(parsed.cumulative.total, 71);
  assert.equal(parsed.cumulative.requests, 3);
});

test("DSH skips seeded events, clears malformed request routes, and validates complete usage totals", () => {
  const home = mkdir("validation");
  const dshHome = path.join(home, ".dsh");
  const sessionDir = mkdir("validation/.dsh/sessions/project/session-validation");
  const filePath = path.join(sessionDir, "session.jsonl");
  const createdAt = Date.UTC(2026, 8, 3, 18, 50);
  writeOauth(dshHome);
  const records = [
    { ...header("session-validation", createdAt), seedLength: 3 },
    {
      type: "request/header", seq: 1, time: createdAt + 10,
      data: { header: { config: { provider: "openai-codex", model: "inherited-model" } } },
    },
    { ...assistant(createdAt + 20, "openai-codex", { inputTokens: 50, outputTokens: 5 }, "inherited-model"), seq: 2 },
    {
      type: "assistant/chunk", seq: 3, time: createdAt + 30,
      data: { turn: 1, step: 1, chunk: { type: "usage", usage: { inputTokens: 40, outputTokens: 4 } } },
    },
    {
      type: "request/header", seq: 4, time: createdAt + 40,
      data: { header: { config: { provider: "openai-codex", model: "gpt-5-codex" } } },
    },
    {
      type: "assistant/chunk", seq: 5, time: createdAt + 50,
      data: {
        turn: 1,
        step: 2,
        chunk: {
          type: "usage",
          usage: { inputTokens: 10, cacheReadTokens: 3, cacheWriteTokens: 2, outputTokens: 2, totalTokens: 18 },
        },
      },
    },
    { type: "request/header", seq: 6, time: createdAt + 60, data: { header: { config: { provider: "openai-codex" } } } },
    {
      type: "assistant/chunk", seq: 7, time: createdAt + 70,
      data: { turn: 1, step: 3, chunk: { type: "usage", usage: { inputTokens: 30, outputTokens: 3 } } },
    },
    {
      type: "request/header", seq: 8, time: createdAt + 80,
      data: { header: { config: { provider: "openai-codex", model: "gpt-5-codex" } } },
    },
    {
      type: "assistant/chunk", seq: 9, time: createdAt + 90,
      data: {
        turn: 1,
        step: 4,
        chunk: {
          type: "usage",
          usage: { inputTokens: 10, cacheReadTokens: 3, outputTokens: 2, totalTokens: 17 },
        },
      },
    },
  ];
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

  const root = deepseekHarnessSource.discover(context(home)).find((candidate) => candidate.text);
  assert.ok(root);
  const parsed = deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false });
  assert.ok(parsed);
  assert.equal(parsed.events.length, 1);
  assert.deepEqual(parsed.events[0].usage, {
    input: 15,
    cached: 3,
    cacheWrite: 0,
    output: 2,
    reasoning: 0,
    total: 17,
    requests: 1,
  });
});

test("rejects an empty compressed DSH log so the store can retain last-good usage", () => {
  const home = mkdir("zstd-empty");
  const dshHome = path.join(home, ".dsh");
  const sessionDir = mkdir("zstd-empty/.dsh/sessions/project/session-empty");
  const filePath = path.join(sessionDir, "session.jsonl.zstd");
  writeOauth(dshHome);
  fs.writeFileSync(filePath, Buffer.alloc(0));

  const root = deepseekHarnessSource.discover(context(home)).find((candidate) => !candidate.text);
  assert.ok(root);
  assert.throws(
    () => deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false }),
    /empty DeepSeek Harness compressed log/,
  );
});

test("bundled Zstandard decoding works on the Node 16 compatibility runtime", () => {
  const home = mkdir("zstd-node16");
  const dshHome = path.join(home, ".dsh");
  const sessionDir = mkdir("zstd-node16/.dsh/sessions/project/session-node16-zstd");
  const filePath = path.join(sessionDir, "session.jsonl.zstd");
  writeOauth(dshHome);
  // Three independently compressed, checksummed frames generated from the canonical DSH records
  // below. Keeping the fixture bytes static lets the decoder run where Node itself cannot compress
  // Zstandard yet, notably the supported Node 16 compatibility runtime.
  const frames = [
    "KLUv/SR6NQMAMsYVG4C5OcCPWMSK7SBSLKmTgTNa8gvNeh9iDlaiJ4AGQjfrvLCY2sVwxNPnRhM5NPYgD+NDyiApKQkS9BLyu7wxPufq4ggkT7aOVD6E7QmfF1OqV6PvKNaMBABZBRkuPJ9btC1NhqLY1Q==",
    "KLUv/WQKAH0FANILJB9gSdsGBqvolR4S8r+Z7C+hgQoCycZJWGu0AAHggjgBhvde0W6P5uR5abIF7dhSCGJ3fE+AaIY88Qqa9iAUWsr2+aZJJWxjxx80rbJUcjS3fDwwyPfSXnscf9h2/CGS+pJMm48nv5rrL3nUKB2NMccUBEZhGAMnr4rqY0AeQfl4RRCzKgC9ULNiRs8rW+gvAQoAaow1+PKc2aRoPiFsBKJlcxzcC65EoHh4FTN051en",
    "KLUv/WQKAH0FACKMJB9gSdsGBqvolR4S8jEx2V9CAxUEko0jRj8nGkWQJSACAO89o90ezcnzUsMWtGNLJYjd8T0BolnyxCtoWoRQaCnb55smlbCNHX/QtMpSBqS55eOBQb6X9lrk+MO24w+R1Jc8njzT5mORX831lzxqlI7GmGMOwXGOY6DIq6L6aOQRlI/XBDGrEtALNStm9Lyyhf4SCQBqjDX48pzZpGg+IWwEomVzHNwLrhRBhDOuHKvC",
  ];
  fs.writeFileSync(filePath, Buffer.concat(frames.map((frame) => Buffer.from(frame, "base64"))));

  const root = deepseekHarnessSource.discover(context(home)).find((candidate) => !candidate.text);
  assert.ok(root);
  const previousDecoder = process.env.CODEX_TRACKER_FORCE_FZSTD;
  try {
    process.env.CODEX_TRACKER_FORCE_FZSTD = "1";
    const parsed = deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false });
    assert.ok(parsed);
    assert.equal(parsed.sessionId, "session-node16-zstd");
    assert.equal(parsed.events.length, 2);
    assert.equal(parsed.cumulative.total, 35);
  } finally {
    if (previousDecoder === undefined) delete process.env.CODEX_TRACKER_FORCE_FZSTD;
    else process.env.CODEX_TRACKER_FORCE_FZSTD = previousDecoder;
  }
});

zstdTest("decodes every independently compressed frame in a concatenated DSH log", () => {
  const sessions = mkdir("zstd/.dsh/sessions");
  const sessionDir = mkdir("zstd/.dsh/sessions/--work-dsh--/session-zstd");
  const filePath = path.join(sessionDir, "session.jsonl.zstd");
  writeOauth(path.join(fixtureRoot, "zstd", ".dsh"));
  const createdAt = Date.UTC(2026, 8, 3, 19);
  const checksumParam = zstdRuntime.constants?.ZSTD_c_checksumFlag;
  const options = checksumParam === undefined ? undefined : { params: { [checksumParam]: 1 } };
  const compress = (text: string) => Buffer.from(zstdRuntime.zstdCompressSync!(Buffer.from(`${text}\n`), options));
  fs.writeFileSync(
    filePath,
    Buffer.concat([
      compress(JSON.stringify(header("session-zstd", createdAt))),
      compress(JSON.stringify(assistant(createdAt + 1_000, "openai-codex", { inputTokens: 10, outputTokens: 2 }))),
      compress(JSON.stringify(assistant(createdAt + 2_000, "openai-codex", { inputTokens: 20, outputTokens: 3 }, "gpt-5-codex", 2))),
    ]),
  );

  const root = deepseekHarnessSource
    .discover(context(path.join(fixtureRoot, "zstd")))
    .find((candidate) => !candidate.text);
  assert.ok(root);
  assert.equal(root.dir, sessions);

  const previousDecoder = process.env.CODEX_TRACKER_FORCE_FZSTD;
  let parsed;
  try {
    process.env.CODEX_TRACKER_FORCE_FZSTD = "1";
    parsed = deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false });
  } finally {
    if (previousDecoder === undefined) delete process.env.CODEX_TRACKER_FORCE_FZSTD;
    else process.env.CODEX_TRACKER_FORCE_FZSTD = previousDecoder;
  }
  assert.ok(parsed);
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.cumulative.input, 30);
  assert.equal(parsed.cumulative.output, 5);
  assert.equal(parsed.cumulative.total, 35);

  fs.appendFileSync(filePath, Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
  assert.throws(
    () => deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false }),
    /incomplete Zstandard frame header/,
    "an incomplete final frame must fail closed rather than count a partial log",
  );
});

zstdTest("bounds a compressed JSONL record across frames while preserving ordinary frame splits", () => {
  const home = mkdir("zstd-cross-frame-line");
  const dshHome = path.join(home, ".dsh");
  const sessionDir = mkdir("zstd-cross-frame-line/.dsh/sessions/project/session-cross-frame");
  const filePath = path.join(sessionDir, "session.jsonl.zstd");
  const createdAt = Date.UTC(2026, 8, 3, 19, 10);
  writeOauth(dshHome);
  const compress = (part: string) => Buffer.from(zstdRuntime.zstdCompressSync!(Buffer.from(part)));
  const headerLine = JSON.stringify(header("session-cross-frame", createdAt));
  const usageLine = JSON.stringify(
    assistant(createdAt + 1_000, "openai-codex", { inputTokens: 10, outputTokens: 2 }),
  );
  fs.writeFileSync(filePath, Buffer.concat([
    compress(headerLine.slice(0, 23)),
    compress(`${headerLine.slice(23)}\n`),
    compress(usageLine.slice(0, 41)),
    compress(`${usageLine.slice(41)}\n`),
  ]));

  const root = deepseekHarnessSource.discover(context(home)).find((candidate) => !candidate.text);
  assert.ok(root);
  const parsed = deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false });
  assert.equal(parsed?.cumulative.total, 12);

  const megabyte = "x".repeat(1024 * 1024);
  fs.writeFileSync(filePath, Buffer.concat([
    compress(`${headerLine}\n`),
    compress('{"type":"diagnostic","content":"'),
    ...Array.from({ length: 17 }, () => compress(megabyte)),
    compress('"}\n'),
  ]));
  assert.throws(
    () => deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false }),
    /DeepSeek Harness JSONL record exceeds the streaming line-size limit/,
  );
});

zstdChecksumTest("rejects a DSH frame with a corrupted content checksum", () => {
  const home = mkdir("zstd-checksum");
  const dshHome = path.join(home, ".dsh");
  const sessionDir = mkdir("zstd-checksum/.dsh/sessions/project/session-checksum");
  const filePath = path.join(sessionDir, "session.jsonl.zstd");
  writeOauth(dshHome);
  const createdAt = Date.UTC(2026, 8, 3, 19, 15);
  const checksumParam = zstdRuntime.constants!.ZSTD_c_checksumFlag;
  const options = { params: { [checksumParam]: 1 } };
  const compressed = Buffer.from(zstdRuntime.zstdCompressSync!(
    Buffer.from(`${JSON.stringify(header("session-checksum", createdAt))}\n`),
    options,
  ));
  compressed[compressed.length - 1] ^= 0xff;
  fs.writeFileSync(filePath, compressed);

  const root = deepseekHarnessSource.discover(context(home)).find((candidate) => !candidate.text);
  assert.ok(root);
  assert.throws(
    () => deepseekHarnessSource.parse(sourceFile(filePath, root), { includeAllProviders: false }),
    /checksum/i,
  );
});
