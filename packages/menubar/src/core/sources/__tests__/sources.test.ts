import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverSessionRoots, sourceFor, walkFiles } from "../index";
import { opencodeSource } from "../opencode";
import { clineSource } from "../cline";
import { piSource } from "../pi";
import { codexSource } from "../codex";
import { hermesSource } from "../hermes";
import { mergeSessions } from "../util";
import type { UserHome } from "../types";

const scratch = process.env.CODEX_TRACKER_TEST_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-sources-"));
const home = path.join(scratch, "home");
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
const homes: UserHome[] = [{ home, origin: "local", layout: "linux" }];
const env = { HOME: home, XDG_DATA_HOME: path.join(home, ".local", "share"), XDG_CONFIG_HOME: path.join(home, ".config") };

function write(p: string, content: string | object) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content));
}

// --- fixtures ---
const T0 = Date.parse("2026-09-01T10:00:00Z");
// opencode: two assistant messages in one session (codex-auth via openai oauth), one deepseek message
const ocData = path.join(home, ".local", "share", "opencode");
write(path.join(ocData, "auth.json"), { openai: { type: "oauth", refresh: "x" } });
write(path.join(ocData, "storage", "session", "proj1", "ses_1.json"), { id: "ses_1", projectID: "proj1", directory: "/work/demo-app", title: "demo", time: { created: T0 - 5000, updated: T0 + 60000 } });
write(path.join(ocData, "storage", "message", "ses_1", "msg_1.json"), { id: "msg_1", sessionID: "ses_1", role: "assistant", modelID: "gpt-5.2-codex", providerID: "openai", tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 40, write: 10 } }, time: { created: T0, completed: T0 + 1000 } });
write(path.join(ocData, "storage", "message", "ses_1", "msg_2.json"), { id: "msg_2", sessionID: "ses_1", role: "assistant", modelID: "gpt-5.2-codex", providerID: "openai", tokens: { input: 50, output: 10, reasoning: 0, cache: { read: 150, write: 0 } }, time: { created: T0 + 30000, completed: T0 + 31000 } });
write(path.join(ocData, "storage", "message", "ses_1", "msg_u.json"), { id: "msg_u", sessionID: "ses_1", role: "user", time: { created: T0 - 1000 } });
write(path.join(ocData, "storage", "message", "ses_2", "msg_3.json"), { id: "msg_3", sessionID: "ses_2", role: "assistant", modelID: "deepseek-chat", providerID: "deepseek", tokens: { input: 9, output: 9, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: T0, completed: T0 } });

// cline: one task with two completed requests (one codex provider, one anthropic) and one in-flight
const clineTasks = path.join(home, ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "tasks");
write(path.join(clineTasks, "1756720000000", "task_metadata.json"), {
  model_usage: [
    { ts: T0 - 10, model_id: "gpt-5.2-codex", model_provider_id: "openai-codex", mode: "act" },
    { ts: T0 + 20000, model_id: "claude-sonnet-4", model_provider_id: "anthropic", mode: "act" },
  ],
});
write(path.join(clineTasks, "1756720000000", "ui_messages.json"), [
  { ts: T0, type: "say", say: "task", text: "do the thing" },
  { ts: T0 + 100, type: "say", say: "api_req_started", text: JSON.stringify({ request: "…", tokensIn: 1000, tokensOut: 50, cacheWrites: 200, cacheReads: 300, cost: 0.01 }) },
  { ts: T0 + 25000, type: "say", say: "api_req_started", text: JSON.stringify({ request: "…", tokensIn: 10, tokensOut: 5, cacheWrites: 0, cacheReads: 0, cost: 0 }) },
  { ts: T0 + 30000, type: "say", say: "api_req_started", text: JSON.stringify({ request: "still running" }) },
]);

// pi: one session with codex + deepseek messages
const piDir = path.join(home, ".pi", "agent", "sessions", "--work-demo--");
write(path.join(piDir, "2026-09-01T10-00-00-000Z_01a05bf2-a72b-7ce9-ae2e-0677c61a6c1d.jsonl"), [
  JSON.stringify({ type: "session", version: 3, id: "01a05bf2-a72b-7ce9-ae2e-0677c61a6c1d", timestamp: "2026-09-01T10:00:00.000Z", cwd: "/work/demo" }),
  JSON.stringify({ type: "message", id: "a", timestamp: "2026-09-01T10:01:00.000Z", message: { role: "assistant", content: "x", api: "openai-codex-responses", provider: "openai-codex", model: "gpt-5.6-sol", usage: { input: 54, output: 134, cacheRead: 1792, cacheWrite: 0, reasoning: 26, totalTokens: 1980 } } }),
  JSON.stringify({ type: "message", id: "b", timestamp: "2026-09-01T10:02:00.000Z", message: { role: "assistant", content: "x", api: "openai-completions", provider: "deepseek", model: "deepseek-chat", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 15 } } }),
].join("\n"));

// codex: minimal rollout
const codexDay = path.join(home, ".codex", "sessions", "2026", "09", "01");
write(path.join(codexDay, "rollout-2026-09-01T10-00-00-01a058dc-c4fa-7972-8ff5-77ccfd3de86f.jsonl"), [
  JSON.stringify({ timestamp: "2026-09-01T10:00:00.000Z", type: "session_meta", payload: { id: "01a058dc-c4fa-7972-8ff5-77ccfd3de86f", timestamp: "2026-09-01T10:00:00.000Z", cwd: "/work/codex-proj", originator: "codex_cli_rs", cli_version: "0.148.0", source: "cli" } }),
  JSON.stringify({ timestamp: "2026-09-01T10:00:01.000Z", type: "turn_context", payload: { cwd: "/work/codex-proj", model: "gpt-5.6-sol" } }),
  JSON.stringify({ timestamp: "2026-09-01T10:00:05.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 1100 }, last_token_usage: { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 1100 } } } }),
].join("\n"));

// hermes: generic JSON document
write(path.join(home, ".hermes", "sessions", "abc.json"), {
  id: "abc", cwd: "/work/hermes-proj",
  messages: [{ role: "assistant", created_at: "2026-09-01T10:00:00Z", model: "gpt-5.2-codex", provider: "openai-codex", usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 } } }],
});

test("discovers every source root under a synthetic home", () => {
  const roots = discoverSessionRoots({ homes, env });
  const ids = roots.map((r) => `${r.agent}:${path.relative(home, r.dir)}`).sort();
  assert.deepEqual(ids, [
    "cline:.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
    "codex:.codex/sessions",
    "hermes:.hermes/sessions",
    "opencode:.local/share/opencode/storage",
    "pi:.pi/agent/sessions",
  ]);
  const off = discoverSessionRoots({ homes, env, sources: { pi: false, cline: false } });
  assert.deepEqual(off.map((r) => r.agent).sort(), ["codex", "hermes", "opencode"]);
});

test("extra dirs with agent/format", () => {
  const roots = discoverSessionRoots({ homes, env, sources: { codex: false, pi: false, hermes: false, opencode: false, cline: false, roo: false, kilo: false }, extraSessionDirs: [{ path: piDir, agent: "mypi", format: "pi" }, path.join(home, ".codex", "sessions")] });
  assert.deepEqual(roots.map((r) => [r.agent, r.format]), [["mypi", "pi"], ["codex", "codex"]]);
});

function parseAll(agent: string, includeAllProviders = false) {
  const roots = discoverSessionRoots({ homes, env }).filter((r) => r.agent === agent);
  const out = [];
  for (const root of roots) {
    const def = sourceFor(root);
    for (const p of walkFiles(root)) {
      const s = def.parse({ path: p, text: fs.readFileSync(p, "utf8"), root }, { includeAllProviders });
      if (s) out.push(s);
    }
  }
  return out;
}

test("opencode: one file per message, oauth openai counts, merged by session", () => {
  const parts = parseAll("opencode");
  assert.equal(parts.length, 2); // deepseek + user message skipped
  const merged = mergeSessions(parts);
  assert.equal(merged.sessionId, "ses_1");
  assert.equal(merged.agent, "opencode");
  assert.equal(merged.projectName, "demo-app");
  assert.equal(merged.events.length, 2);
  assert.equal(merged.events[0].usage.input, 150); // 100 + 40 read + 10 write
  assert.equal(merged.events[0].usage.cached, 40);
  assert.equal(merged.events[0].usage.cacheWrite, 10);
  assert.equal(merged.events[0].usage.total, 170);
  assert.equal(merged.cumulative.requests, 2);
  assert.equal(merged.startedAt, T0 - 5000);
  assert.equal(parseAll("opencode", true).length, 3);
  assert.equal(opencodeSource.multiFileSessions, true);
});

test("cline: api_req_started entries with per-request model attribution", () => {
  const [s] = parseAll("cline");
  assert.ok(s);
  assert.equal(s.sessionId, "1756720000000");
  assert.equal(s.agent, "cline");
  assert.equal(s.events.length, 1); // anthropic request excluded, in-flight skipped
  assert.equal(s.events[0].model, "gpt-5.2-codex");
  assert.equal(s.events[0].usage.input, 1500);
  assert.equal(s.events[0].usage.cached, 300);
  assert.equal(s.events[0].usage.cacheWrite, 200);
  assert.equal(s.events[0].usage.output, 50);
  const all = parseAll("cline", true)[0];
  assert.equal(all.events.length, 2);
  assert.equal(all.events[1].model, "claude-sonnet-4");
  assert.equal(clineSource.format, "cline");
});

test("pi, codex and hermes parse through the registry", () => {
  const [pi] = parseAll("pi");
  assert.equal(pi.events.length, 1);
  assert.equal(pi.events[0].usage.cached, 1792);
  assert.equal(piSource.id, "pi");
  const [codex] = parseAll("codex");
  assert.equal(codex.agent, "codex");
  assert.equal(codex.events[0].usage.total, 1100);
  assert.equal(codexSource.hotDirs(discoverSessionRoots({ homes, env }).find((r) => r.agent === "codex")!).length >= 2, true);
  const [hermes] = parseAll("hermes");
  assert.equal(hermes.agent, "hermes");
  assert.equal(hermes.events[0].usage.cached, 40);
  assert.equal(hermesSource.format, "generic");
});

test("registry: missing dirs never throw and unknown agents fall back to generic", () => {
  const roots = discoverSessionRoots({ homes: [{ home: path.join(scratch, "nope"), origin: "local", layout: "darwin" }], env: {} });
  assert.equal(roots.length, 0);
  const extra = discoverSessionRoots({ homes: [], env: {}, extraSessionDirs: [{ path: path.join(home, ".hermes", "sessions"), agent: "custom" }] });
  assert.equal(extra[0].format, "generic");
  assert.equal(sourceFor(extra[0]).id, "generic");
});
