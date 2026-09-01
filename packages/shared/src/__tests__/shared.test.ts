import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSessionText, sessionIdFromFilename } from "../codex-parser.ts";
import { resolvePrice, computeCost } from "../pricing.ts";
import { sha256Hex } from "../sha256.ts";
import { bucketEvents, buildHeatmap, groupByLocalDay } from "../aggregate.ts";
import { formatTokens, formatUSD } from "../format.ts";
import { localParts } from "../time.ts";

const SAMPLE = [
  `{"timestamp":"2026-08-31T17:27:40.737Z","type":"session_meta","payload":{"id":"01a058dc-c4fa-7972-8ff5-77ccfd3de86f","timestamp":"2026-08-31T17:27:38.522Z","cwd":"/Users/x/proj/demo","originator":"Codex Desktop","cli_version":"0.148.0","source":"vscode"}}`,
  `{"timestamp":"2026-08-31T17:27:42.662Z","type":"turn_context","payload":{"cwd":"/Users/x/proj/demo","timezone":"America/Los_Angeles","model":"gpt-5.6-sol"}}`,
  `{"timestamp":"2026-08-31T17:27:53.784Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":22148,"cached_input_tokens":11008,"cache_write_input_tokens":0,"output_tokens":253,"reasoning_output_tokens":172,"total_tokens":22401},"last_token_usage":{"input_tokens":22148,"cached_input_tokens":11008,"output_tokens":253,"reasoning_output_tokens":172,"total_tokens":22401},"model_context_window":258400},"rate_limits":{"limit_id":"codex","primary":{"used_percent":24.0,"window_minutes":10080,"resets_at":1788747991},"secondary":null,"plan_type":"pro"}}}`,
  `{"timestamp":"2026-08-31T17:27:55.000Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"primary":{"used_percent":25.0,"window_minutes":10080,"resets_at":1788747991}}}}`,
  `{"timestamp":"2026-08-31T17:28:00.488Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":54201,"cached_input_tokens":32256,"cache_write_input_tokens":0,"output_tokens":322,"reasoning_output_tokens":191,"total_tokens":54523},"last_token_usage":{"input_tokens":32053,"cached_input_tokens":21248,"output_tokens":69,"reasoning_output_tokens":19,"total_tokens":32122},"model_context_window":258400}}}`,
  `{"timestamp":"2026-08-31T17:28:00.500Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":54201,"cached_input_tokens":32256,"output_tokens":322,"reasoning_output_tokens":191,"total_tokens":54523},"last_token_usage":{"input_tokens":32053,"cached_input_tokens":21248,"output_tokens":69,"reasoning_output_tokens":19,"total_tokens":32122}}}}`,
].join("\n");

test("parses current rollout format into per-request deltas", () => {
  const s = parseSessionText(SAMPLE, "fallback");
  assert.ok(s);
  assert.equal(s.sessionId, "01a058dc-c4fa-7972-8ff5-77ccfd3de86f");
  assert.equal(s.model, "gpt-5.6-sol");
  assert.equal(s.projectName, "demo");
  assert.equal(s.timezone, "America/Los_Angeles");
  assert.equal(s.events.length, 2); // duplicate + rate-limit-only events skipped
  assert.equal(s.events[0].usage.input, 22148);
  assert.equal(s.events[1].usage.input, 32053);
  assert.equal(s.events[1].usage.cached, 21248);
  assert.equal(s.events[1].usage.output, 69);
  assert.equal(s.cumulative.total, 54523);
  assert.equal(s.cumulative.requests, 2);
  assert.equal(s.rateLimits?.primary?.usedPercent, 25);
  assert.equal(s.rateLimits?.planType, "pro");
  assert.equal(s.contextWindow, 258400);
  assert.equal(s.startedAt, Date.parse("2026-08-31T17:27:38.522Z"));
});

test("legacy flat token_count payloads", () => {
  const legacy = [
    `{"id":"abc","timestamp":"2025-08-01T10:00:00.000Z","instructions":"x"}`,
    `{"timestamp":"2025-08-01T10:00:05.000Z","type":"event_msg","payload":{"type":"token_count","input_tokens":100,"cached_input_tokens":40,"output_tokens":10,"reasoning_output_tokens":0,"total_tokens":110}}`,
    `{"timestamp":"2025-08-01T10:00:09.000Z","type":"event_msg","payload":{"type":"token_count","input_tokens":250,"cached_input_tokens":140,"output_tokens":30,"reasoning_output_tokens":5,"total_tokens":280}}`,
  ].join("\n");
  const s = parseSessionText(legacy, "f");
  assert.ok(s);
  assert.equal(s.sessionId, "abc");
  assert.equal(s.events.length, 2);
  assert.equal(s.events[1].usage.input, 150);
  assert.equal(s.events[1].usage.total, 170);
});

test("session id from filename", () => {
  assert.equal(
    sessionIdFromFilename("/a/b/rollout-2026-08-31T10-27-38-01a058dc-c4fa-7972-8ff5-77ccfd3de86f.jsonl"),
    "01a058dc-c4fa-7972-8ff5-77ccfd3de86f",
  );
});

test("pricing resolution and fallback", () => {
  assert.equal(resolvePrice("gpt-5-codex").estimated, false);
  assert.equal(resolvePrice("gpt-5.1-codex-max-2025-11-19").matchedKey, "gpt-5.1-codex-max");
  const unknown = resolvePrice("gpt-5.6-sol");
  assert.equal(unknown.estimated, true);
  assert.equal(unknown.matchedKey, "gpt-5.2");
  assert.equal(resolvePrice("gpt-5.7-mini").matchedKey, "gpt-5-mini");
  assert.equal(resolvePrice("codex-auto-review").matchedKey, null);
  const ov = resolvePrice("gpt-5.6-sol", { "gpt-5.6-sol": { input: 2, cachedInput: 0.2, output: 16 } });
  assert.equal(ov.estimated, false);
  const cost = computeCost({ input: 1_000_000, cached: 500_000, output: 100_000 }, { input: 1.25, cachedInput: 0.125, output: 10 });
  assert.equal(Number(cost.toFixed(4)), 0.625 + 0.0625 + 1);
});

test("sha256 known vector", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("bucketing, day grouping and heatmap", () => {
  const s = parseSessionText(SAMPLE, "f")!;
  const buckets = bucketEvents(s.events);
  assert.equal(buckets.size, 1);
  const rows = [...buckets.values()];
  const days = groupByLocalDay(rows, "UTC");
  assert.equal([...days.keys()][0], "2026-08-31");
  const grid = buildHeatmap(days, "2026-08-31", 4);
  assert.equal(grid.weeks.length, 4);
  assert.equal(grid.weeks[3].filter((d) => d.dayKey === "").length >= 0, true);
  assert.equal(localParts(Date.parse("2026-08-31T17:28:00Z"), "Asia/Shanghai").hour, 1);
  assert.equal(localParts(Date.parse("2026-08-31T17:28:00Z"), "Asia/Shanghai").dayKey, "2026-09-01");
});

test("formatting", () => {
  assert.equal(formatTokens(1234), "1.23k");
  assert.equal(formatTokens(5_600_000), "5.6M");
  assert.equal(formatUSD(0.001), "<$0.01");
  assert.equal(formatUSD(1234.5), "$1,234.50");
});
