import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverSessionRoots, discoverSessionRootsWithStatus, sourceFor, walkFiles } from "../index";
import { opencodeSource } from "../opencode";
import { clineSource } from "../cline";
import { piSource } from "../pi";
import { ompSource } from "../omp";
import { codexSource } from "../codex";
import { hermesSource } from "../hermes";
import { MAX_AUTH_METADATA_BYTES, mergeSessions } from "../util";
import type { UserHome } from "../types";
import { normalizeExtraDir } from "../../config";

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

// oh-my-pi: pi's transcript format under ~/.omp — the default agent dir, a profile, and the XDG data dir
const OMP_ID = "01a05bf2-0000-7ce9-ae2e-0677c61a6c1d";
const ompHeader = (id: string, cwd: string) => JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-09-01T11:00:00.000Z", cwd });
const ompCodexMsg = JSON.stringify({ type: "message", id: "a", timestamp: "2026-09-01T11:01:00.000Z", message: { role: "assistant", content: "x", api: "openai-codex-responses", provider: "openai-codex", model: "gpt-5.6-sol", usage: { input: 54, output: 134, cacheRead: 1792, cacheWrite: 0, reasoning: 26, totalTokens: 1980, cost: 0 } } });
const ompClaudeMsg = JSON.stringify({ type: "message", id: "b", timestamp: "2026-09-01T11:02:00.000Z", message: { role: "assistant", content: "x", api: "anthropic-messages", provider: "anthropic", model: "claude-opus-5", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 15, cost: 0 } } });
write(path.join(home, ".omp", "agent", "sessions", "-work-demo", `2026-09-01T11-00-00-000Z_${OMP_ID}.jsonl`), [
  ompHeader(OMP_ID, "/work/demo"),
  JSON.stringify({ type: "model_change", id: "m", parentId: null, timestamp: "2026-09-01T11:00:01.000Z", provider: "openai-codex", modelId: "gpt-5.6-sol" }),
  ompCodexMsg,
  ompClaudeMsg,
].join("\n"));
write(path.join(home, ".omp", "profiles", "work", "agent", "sessions", "-work-p", "2026-09-01T11-00-00-000Z_01a05bf2-1111-7ce9-ae2e-0677c61a6c1d.jsonl"), [ompHeader("01a05bf2-1111-7ce9-ae2e-0677c61a6c1d", "/work/p"), ompCodexMsg].join("\n"));
write(path.join(home, ".local", "share", "omp", "sessions", "-work-x", "2026-09-01T11-00-00-000Z_01a05bf2-2222-7ce9-ae2e-0677c61a6c1d.jsonl"), [ompHeader("01a05bf2-2222-7ce9-ae2e-0677c61a6c1d", "/work/x"), ompCodexMsg].join("\n"));

// codex: minimal rollout
const codexDay = path.join(home, ".codex", "sessions", "2026", "09", "01");
write(path.join(home, ".codex", "auth.json"), { auth_mode: "chatgpt", tokens: { access_token: "never-retained" } });
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
    "omp:.local/share/omp/sessions",
    "omp:.omp/agent/sessions",
    "omp:.omp/profiles/work/agent/sessions",
    "opencode:.local/share/opencode/storage",
    "pi:.pi/agent/sessions",
  ]);
  const off = discoverSessionRoots({ homes, env, sources: { pi: false, omp: false, cline: false } });
  assert.deepEqual(off.map((r) => r.agent).sort(), ["codex", "hermes", "opencode"]);
});

test("hermes uses <user-home>/.hermes for Windows and WSL-visible Windows homes", () => {
  const windowsHome = path.join(scratch, "windows-hermes-home");
  const wslVisibleWindowsHome = path.join(scratch, "wsl-visible-windows-hermes-home");
  const localAppData = path.join(windowsHome, "AppData", "Local");
  write(path.join(windowsHome, ".hermes", "sessions", "windows.json"), {});
  write(path.join(wslVisibleWindowsHome, ".hermes", "sessions", "wsl.json"), {});

  const windowsRoots = hermesSource.discover({
    homes: [{ home: windowsHome, origin: "local", layout: "win32" }],
    env: { LOCALAPPDATA: localAppData },
    platform: "win32",
  });
  assert.deepEqual(windowsRoots.map((root) => root.dir), [path.join(windowsHome, ".hermes", "sessions")]);

  const wslRoots = hermesSource.discover({
    homes: [{ home: wslVisibleWindowsHome, origin: "windows", layout: "win32" }],
    env: {},
    platform: "wsl",
  });
  assert.deepEqual(wslRoots.map((root) => root.dir), [path.join(wslVisibleWindowsHome, ".hermes", "sessions")]);
});

test("extra dirs with agent/format", () => {
  const roots = discoverSessionRoots({ homes, env, sources: { codex: false, dsh: false, pi: false, omp: false, hermes: false, opencode: false, cline: false, roo: false, kilo: false }, extraSessionDirs: [{ path: piDir, agent: "mypi", format: "pi" }, { path: piDir, agent: "custom-dsh", format: "dsh" }, path.join(home, ".codex", "sessions")] });
  assert.deepEqual(roots.map((r) => [r.agent, r.format]), [["mypi", "pi"], ["custom-dsh", "dsh"], ["codex", "codex"]]);
  assert.equal(sourceFor(roots[1]).id, "dsh");
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
  assert.equal(merged.events[0].usage.output, 25); // visible output + reasoning
  assert.equal(merged.events[0].usage.reasoning, 5);
  assert.equal(merged.events[0].usage.total, 175);
  assert.equal(merged.cumulative.requests, 2);
  assert.equal(merged.startedAt, T0 - 5000);
  assert.equal(parseAll("opencode", true).length, 3);
  assert.equal(opencodeSource.multiFileSessions, true);
});

test("opencode: OAuth for a different provider cannot authorize API-key OpenAI messages", () => {
  const mixedHome = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-opencode-mixed-auth-"));
  const data = path.join(mixedHome, ".local", "share", "opencode");
  const message = path.join(data, "storage", "message", "session-mixed", "message.json");
  try {
    write(path.join(data, "auth.json"), {
      openai: { type: "api", key: "never-retained" },
      "openai-codex": { type: "oauth", refresh: "never-retained" },
    });
    write(message, {
      id: "message-mixed",
      sessionID: "session-mixed",
      role: "assistant",
      modelID: "gpt-5-codex",
      providerID: "openai",
      tokens: { input: 10, output: 2 },
      time: { completed: T0 },
    });
    const root = opencodeSource.discover({
      homes: [{ home: mixedHome, origin: "local", layout: "linux" }],
      env: { XDG_DATA_HOME: path.join(mixedHome, ".local", "share") },
      platform: "linux",
    })[0];
    assert.ok(root);
    assert.equal(opencodeSource.parse({ path: message, text: fs.readFileSync(message, "utf8"), root }, { includeAllProviders: false }), null);
    assert.equal(
      opencodeSource.parse({ path: message, text: fs.readFileSync(message, "utf8"), root }, { includeAllProviders: true })?.provider,
      "openai",
    );
  } finally {
    fs.rmSync(mixedHome, { recursive: true, force: true });
  }
});

test("opencode: OAuth usage includes reasoning and rejects malformed or overflowing counters", () => {
  const oauthHome = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-opencode-token-guards-"));
  const data = path.join(oauthHome, ".local", "share", "opencode");
  const message = path.join(data, "storage", "message", "session-oauth", "message.json");
  try {
    write(path.join(data, "auth.json"), { openai: { type: "oauth", refresh: "never-retained" } });
    write(path.join(data, "storage", "session", "project", "session-oauth.json"), {
      id: "session-oauth",
      title: "private text derived from the first user prompt",
      time: { created: T0 - 1000 },
    });
    write(message, {
      id: "message-oauth",
      sessionID: "session-oauth",
      role: "assistant",
      modelID: "gpt-5-codex",
      providerID: "openai",
      tokens: {
        total: 4,
        input: "invalid",
        output: 2,
        reasoning: 3,
        cache: { read: -10, write: "invalid" },
      },
      time: { completed: T0 },
    });
    const root = opencodeSource.discover({
      homes: [{ home: oauthHome, origin: "local", layout: "linux" }],
      env: { XDG_DATA_HOME: path.join(oauthHome, ".local", "share") },
      platform: "linux",
    })[0];
    assert.ok(root);
    assert.equal(opencodeSource.parse(
      { path: message, text: fs.readFileSync(message, "utf8"), root },
      { includeAllProviders: false },
    ), null);

    write(message, {
      id: "message-oauth",
      sessionID: "session-oauth",
      role: "assistant",
      modelID: "gpt-5-codex",
      providerID: "openai",
      tokens: { total: 4, input: 0, output: 2, reasoning: 3, cache: { read: 0, write: 0 } },
      time: { completed: T0 },
    });
    const parsed = opencodeSource.parse(
      { path: message, text: fs.readFileSync(message, "utf8"), root },
      { includeAllProviders: false },
    );
    assert.deepEqual(parsed?.events[0]?.usage, {
      input: 0,
      cached: 0,
      cacheWrite: 0,
      output: 5,
      reasoning: 3,
      total: 5,
      requests: 1,
    });
    assert.equal(parsed?.projectName, null, "prompt-derived OpenCode titles must not become uploadable metadata");
    write(message, {
      id: "message-oauth",
      sessionID: "session-oauth",
      role: "assistant",
      modelID: "gpt-5-codex",
      providerID: "openai",
      tokens: { input: Number.MAX_SAFE_INTEGER, output: 1 },
      time: { completed: T0 },
    });
    assert.equal(opencodeSource.parse(
      { path: message, text: fs.readFileSync(message, "utf8"), root },
      { includeAllProviders: false },
    ), null);
    fs.writeFileSync(path.join(data, "auth.json"), "x".repeat(MAX_AUTH_METADATA_BYTES + 1));
    assert.throws(
      () => opencodeSource.parse(
        { path: message, text: fs.readFileSync(message, "utf8"), root },
        { includeAllProviders: false },
      ),
      /OpenCode auth metadata/,
    );
  } finally {
    fs.rmSync(oauthHome, { recursive: true, force: true });
  }
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

test("native Codex rollouts require a current ChatGPT auth discriminator", () => {
  const root = discoverSessionRoots({ homes, env }).find((candidate) => candidate.agent === "codex")!;
  const file = walkFiles(root)[0];
  const text = fs.readFileSync(file, "utf8");
  const parse = () => codexSource.parse({ path: file, text, root }, { includeAllProviders: false });
  const authFile = path.join(home, ".codex", "auth.json");

  write(authFile, { auth_mode: "apikey", OPENAI_API_KEY: "never-retained" });
  assert.equal(parse(), null);

  write(authFile, { OPENAI_API_KEY: "legacy-never-retained", tokens: { access_token: "stale" } });
  assert.equal(parse(), null, "a legacy API key takes precedence over stale token fields");

  write(authFile, { tokens: { access_token: "legacy-never-retained" }, last_refresh: "2026-09-01T00:00:00Z" });
  assert.equal(parse()?.cumulative.total, 1100, "legacy token-only auth files are ChatGPT OAuth");

  write(authFile, { tokens: {} });
  assert.equal(parse(), null, "an empty legacy token object is not OAuth proof");

  write(authFile, { tokens: { access_token: "" } });
  assert.equal(parse(), null, "an empty legacy token value is not OAuth proof");

  write(authFile, { auth_mode: "chatgptAuthTokens", tokens: { access_token: "never-retained" } });
  assert.equal(parse(), null, "externally supplied ChatGPT tokens are ephemeral, not durable proof");

  write(authFile, { auth_mode: "personalAccessToken", tokens: { access_token: "never-retained" } });
  assert.equal(parse(), null, "non-OAuth Codex backend credentials are not subscription usage");

  write(authFile, {});
  assert.equal(parse(), null, "missing or ambiguous auth metadata fails closed");

  fs.writeFileSync(authFile, "x".repeat(MAX_AUTH_METADATA_BYTES + 1));
  assert.throws(parse, /Codex auth metadata/, "oversized auth metadata fails closed");
  write(authFile, { auth_mode: "chatgpt", tokens: { access_token: "never-retained" } });
});

test("omp (oh-my-pi): pi format under ~/.omp, tagged omp, codex provider only", () => {
  const all = parseAll("omp");
  assert.deepEqual(all.map((s) => s.cwd).sort(), ["/work/demo", "/work/p", "/work/x"]);
  const main = all.find((s) => s.sessionId === OMP_ID)!;
  assert.ok(main);
  assert.equal(main.agent, "omp");
  assert.equal(main.source, "omp");
  assert.equal(main.originator, "omp");
  assert.equal(main.projectName, "demo");
  assert.equal(main.events.length, 1); // anthropic message excluded
  assert.equal(main.events[0].agent, "omp");
  assert.equal(main.events[0].model, "gpt-5.6-sol");
  assert.equal(main.events[0].usage.input, 54 + 1792);
  assert.equal(main.events[0].usage.cached, 1792);
  assert.equal(main.events[0].usage.total, 1980);
  assert.equal(main.cumulative.requests, 1);
  assert.equal(parseAll("omp", true).find((s) => s.sessionId === OMP_ID)!.events.length, 2);
  assert.equal(ompSource.format, "pi");
  assert.equal(ompSource.label, "oh-my-pi");
  const root = discoverSessionRoots({ homes, env }).find((r) => r.dir.endsWith(path.join(".omp", "agent", "sessions")))!;
  assert.equal(sourceFor(root).id, "omp");
  assert.ok(ompSource.hotDirs(root).length >= 2); // root + the project subdir touched just now
  // env overrides (local homes only): $PI_CONFIG_DIR replaces ~/.omp, $PI_CODING_AGENT_SESSION_DIR adds a dir
  const custom = discoverSessionRoots({ homes, env: { ...env, PI_CONFIG_DIR: path.join(home, ".omp"), PI_CODING_AGENT_SESSION_DIR: piDir }, sources: { pi: false } });
  assert.deepEqual(custom.filter((r) => r.agent === "omp").map((r) => path.relative(home, r.dir)).sort(), [".local/share/omp/sessions", ".omp/agent/sessions", ".omp/profiles/work/agent/sessions", ".pi/agent/sessions/--work-demo--"]);
  // an extra dir declared as agent "omp" defaults to the pi format
  assert.deepEqual(normalizeExtraDir({ path: "~/omp-logs", agent: "omp" }), { path: "~/omp-logs", agent: "omp", format: "pi" });
  assert.deepEqual(normalizeExtraDir({ path: "~/dsh-logs", agent: "dsh" }), { path: "~/dsh-logs", agent: "dsh", format: "dsh" });
});

test("registry: missing dirs never throw and unknown agents fall back to generic", () => {
  const roots = discoverSessionRoots({ homes: [{ home: path.join(scratch, "nope"), origin: "local", layout: "darwin" }], env: {} });
  assert.equal(roots.length, 0);
  const extra = discoverSessionRoots({ homes: [], env: {}, extraSessionDirs: [{ path: path.join(home, ".hermes", "sessions"), agent: "custom" }] });
  assert.equal(extra[0].format, "generic");
  assert.equal(sourceFor(extra[0]).id, "generic");
});

test("source discovery reports operational directory errors instead of treating them as absence", () => {
  const errorHome = fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-discovery-error-"));
  const sessions = path.join(errorHome, ".pi", "agent", "sessions");
  const originalStat = fs.statSync;
  const mutableFs = fs as unknown as { statSync: typeof fs.statSync };
  fs.mkdirSync(sessions, { recursive: true });
  try {
    mutableFs.statSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
      if (candidate === sessions) throw Object.assign(new Error("simulated EIO"), { code: "EIO" });
      return Reflect.apply(originalStat, fs, [candidate, ...args]);
    }) as typeof fs.statSync;
    const sources = {
      codex: false, dsh: false, pi: true, omp: false, openclaw: false,
      hermes: false, opencode: false, cline: false, roo: false, kilo: false,
    };
    const result = discoverSessionRootsWithStatus({
      homes: [{ home: errorHome, origin: "local", layout: "linux" }],
      env: { HOME: errorHome },
      sources,
    });
    assert.equal(result.incompleteSources.has("pi"), true);
  } finally {
    mutableFs.statSync = originalStat;
    fs.rmSync(errorHome, { recursive: true, force: true });
  }
});
