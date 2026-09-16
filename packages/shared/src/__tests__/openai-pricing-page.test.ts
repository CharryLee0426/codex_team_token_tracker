import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_LONG_CONTEXT_RULE,
  buildPricingEntries,
  entriesToTable,
  parseLongContextRule,
  parseOpenAIPricingPage,
  pricingEntriesKey,
  validatePricingEntries,
} from "../openai-pricing-page.ts";
import { DEFAULT_PRICING, LONG_CONTEXT_THRESHOLD, computeAggregateCost, computeCost, resolvePrice } from "../pricing.ts";
import { bucketEvents } from "../aggregate.ts";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const PAGE = fixture("openai-pricing-page.html");

test("reads the standard-tier text-token tables from the pricing page", () => {
  const page = parseOpenAIPricingPage(PAGE);
  const rows = new Map(page.rows.map((r) => [r.model, r]));

  // Flagship table, five columns (cache writes) for the latest models …
  assert.deepEqual(rows.get("gpt-6-astra"), {
    model: "gpt-6-astra", input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50, shortContextLimit: null, latest: true,
  });
  // … four columns for older rows, with the "<272K context length" label lifted off the id.
  assert.deepEqual(rows.get("gpt-5.5"), {
    model: "gpt-5.5", input: 5, cachedInput: 0.5, cacheWrite: null, output: 30, shortContextLimit: 272_000, latest: false,
  });
  // "-" in the cached column means no cache discount.
  assert.equal(rows.get("gpt-5.5-pro")?.cachedInput, null);
  assert.equal(rows.get("gpt-5-pro")?.cachedInput, null);
  // Specialized categories (standard pane only): the fast-mode pane prices gpt-5.3-codex at 3.5.
  assert.deepEqual(rows.get("gpt-5.3-codex"), {
    model: "gpt-5.3-codex", input: 1.75, cachedInput: 0.175, cacheWrite: null, output: 14, shortContextLimit: null, latest: false,
  });
  assert.equal(rows.get("chat-latest")?.input, 5);
  assert.equal(rows.get("gpt-5-search-api")?.output, 10);
  // Batch / flex / fast tiers, embeddings ("-" output), moderation ("Free") and fine-tuning are not token prices.
  assert.equal(rows.get("gpt-5.6-sol")?.input, 4, "standard, not the 2 (batch) or 8 (fast) tier");
  assert.equal(rows.has("text-embedding-3-small"), false);
  assert.equal(rows.has("omni-moderation-latest"), false);
  assert.equal(rows.has("gpt-4.1-2025-04-14"), false);
  assert.ok(page.rows.length >= 30);

  // Explicit long-context table (sol + the cyber models), threshold from the heading tooltip.
  const long = new Map(page.longContext.map((r) => [r.model, r]));
  assert.deepEqual(long.get("gpt-5.6-sol"), { model: "gpt-5.6-sol", threshold: 272_000, input: 8, cachedInput: 0.8, cacheWrite: 10, output: 30 });
  assert.equal(long.has("gpt-5.6-cyber"), false, "a '-' long tier is no tier");
  assert.equal(rows.get("gpt-5.6-cyber")?.cacheWrite, 15.625);
});

test("reads the long-context rule off a model page", () => {
  assert.deepEqual(parseLongContextRule(fixture("openai-model-gpt-6-astra.html")), { threshold: 272_000, inputMultiplier: 2, outputMultiplier: 1.5 });
  assert.equal(parseLongContextRule(fixture("openai-model-gpt-5.4-mini.html")), null);
  assert.deepEqual(
    parseLongContextRule("<p>Prompts with more than 400K input tokens are priced at 3x input and 2x output for the full request.</p>"),
    { threshold: 400_000, inputMultiplier: 3, outputMultiplier: 2 },
  );
});

test("builds the effective table: page rows win, aliases follow, seed fills the gaps", () => {
  const page = parseOpenAIPricingPage(PAGE);
  const entries = buildPricingEntries(page, {
    seed: { ...DEFAULT_PRICING, "gpt-6-astra": { input: 1, cachedInput: 1, output: 1 } },
    longRules: { "gpt-6-astra": { threshold: 272_000, inputMultiplier: 2, outputMultiplier: 1.5 }, "gpt-5.6-luna": null },
  });
  assert.equal(validatePricingEntries(entries), null);
  const by = new Map(entries.map((e) => [e.model, e]));

  // The page beats the seed, and the model page's rule builds the long tier (cache writes scale with input).
  assert.deepEqual(by.get("gpt-6-astra"), {
    model: "gpt-6-astra", source: "openai", input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50,
    long: { threshold: 272_000, input: 20, cachedInput: 2, cacheWrite: 25, output: 75 },
  });
  // The explicit long-context table wins over any rule.
  assert.deepEqual(by.get("gpt-5.6-sol")?.long, { threshold: 272_000, input: 8, cachedInput: 0.8, cacheWrite: 10, output: 30 });
  // A "<272K" label with no model page consulted gets OpenAI's standing 2x / 1.5x rule.
  assert.deepEqual(by.get("gpt-5.5")?.long, { threshold: 272_000, input: 10, cachedInput: 1, output: 45 });
  assert.deepEqual(by.get("gpt-5.5-pro")?.long, { threshold: 272_000, input: 60, cachedInput: 60, output: 270 });
  // A model page that states no rule leaves the model flat, label or not.
  assert.equal(by.get("gpt-5.6-luna")?.long, undefined);
  assert.equal(by.get("gpt-5.4-mini")?.long, undefined);
  // `-codex` ids inherit the base rate; documented aliases follow their target.
  assert.equal(by.get("gpt-5.5-codex")?.source, "alias");
  assert.deepEqual(by.get("gpt-5.5-codex")?.long, by.get("gpt-5.5")?.long);
  assert.equal(by.get("gpt-5.3-codex")?.source, "openai", "listed under Codex on the page, not an alias");
  assert.equal(by.get("gpt-5.6")?.source, "alias");
  assert.equal(by.get("gpt-5.6")?.input, 4);
  // Models the page dropped stay from the seed.
  assert.equal(by.get("codex-mini-latest")?.source, "builtin");
  assert.equal(by.get("gpt-5.1-codex-mini")?.source, "builtin");

  // The fetched table prices exactly like the hand-maintained seed for the models both know.
  const table = entriesToTable(entries);
  for (const model of ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.3-codex", "gpt-4.1-mini", "o3"]) {
    assert.deepEqual(table[model], DEFAULT_PRICING[model], model);
  }
  // Stable digest: same page, same key; a rate change moves it.
  assert.equal(pricingEntriesKey(entries), pricingEntriesKey(buildPricingEntries(page, { seed: DEFAULT_PRICING, longRules: { "gpt-6-astra": DEFAULT_LONG_CONTEXT_RULE, "gpt-5.6-luna": null } })));
  assert.notEqual(pricingEntriesKey(entries), pricingEntriesKey(buildPricingEntries(page, { seed: DEFAULT_PRICING })));
});

test("rejects a table that does not look like OpenAI's price list", () => {
  assert.match(validatePricingEntries(buildPricingEntries({ rows: [], longContext: [] }, { seed: DEFAULT_PRICING })) ?? "", /only 0 models/);
  const junk = parseOpenAIPricingPage("<html><body>maintenance</body></html>");
  assert.deepEqual(junk, { rows: [], longContext: [] });
});

test("aggregate cost bills the long-context share at the long tier and nothing else", () => {
  const astra = resolvePrice("gpt-6-astra").price;
  const short = { input: 100_000, cached: 40_000, cacheWrite: 10_000, output: 5_000, reasoning: 1_000, total: 105_000, requests: 3 };
  const long = { input: 300_000, cached: 200_000, cacheWrite: 0, output: 2_000, reasoning: 500, total: 302_000, requests: 1 };
  const sum = { input: 400_000, cached: 240_000, cacheWrite: 10_000, output: 7_000, reasoning: 1_500, total: 407_000, requests: 4 };

  const perRequest = computeCost(short, astra) + computeCost(long, astra);
  assert.ok(Math.abs(computeAggregateCost(sum, astra, long) - perRequest) < 1e-9);
  // No split → standard tier for the whole aggregate, although its summed input crosses the threshold.
  assert.ok(Math.abs(computeAggregateCost(sum, astra) - computeCost(sum, { ...astra, long: undefined })) < 1e-9);
  assert.ok(computeAggregateCost(sum, astra) < computeAggregateCost(sum, astra, long));
  // A flat-rate model ignores the split.
  const mini = resolvePrice("gpt-5.4-mini").price;
  assert.ok(Math.abs(computeAggregateCost(sum, mini, long) - computeAggregateCost(sum, mini)) < 1e-12);
});

test("hour buckets split out the requests that ran long", () => {
  const hour = 1_780_000_000_000 - (1_780_000_000_000 % 3_600_000);
  const mk = (input: number) => ({ ts: hour + 1000, model: "gpt-6-astra", agent: "codex", usage: { input, cached: 0, cacheWrite: 0, output: 10, reasoning: 0, total: input + 10, requests: 1 } });
  const buckets = [...bucketEvents([mk(1000), mk(LONG_CONTEXT_THRESHOLD), mk(LONG_CONTEXT_THRESHOLD + 1)]).values()];
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].usage.requests, 3);
  assert.deepEqual(buckets[0].long, { input: LONG_CONTEXT_THRESHOLD + 1, cached: 0, cacheWrite: 0, output: 10, reasoning: 0, total: LONG_CONTEXT_THRESHOLD + 11, requests: 1 });
  // The device's own display cost equals what the backend computes from the uploaded split.
  assert.ok(Math.abs(buckets[0].cost - computeAggregateCost(buckets[0].usage, resolvePrice("gpt-6-astra").price, buckets[0].long)) < 1e-9);
});
