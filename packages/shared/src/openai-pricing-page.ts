/**
 * Reads OpenAI's public pricing page into a price table.
 *
 * OpenAI publishes no pricing API. https://developers.openai.com/api/docs/pricing is an Astro site whose
 * tables are rendered from island props: every `<astro-island component-url="/_astro/pricing.*.js">`
 * carries a `props` attribute with the rows of one table, so the numbers can be read without a DOM
 * and without depending on the rendered markup. The long-context tier (2x input / 1.5x output above
 * 272K input tokens for the flagship models) is only spelled out on each model's detail page, so that
 * sentence is parsed separately (`parseLongContextRule`).
 *
 * Everything here is pure string processing so it runs unchanged in the Convex runtime and in tests.
 */
import { LONG_CONTEXT_THRESHOLD, type LongContextPrice, type ModelPrice } from "./pricing.ts";

export const OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing";
export const OPENAI_MODEL_URL_BASE = "https://developers.openai.com/api/docs/models/";

export function openAIModelPageUrl(model: string): string {
  return `${OPENAI_MODEL_URL_BASE}${encodeURIComponent(model)}`;
}

/** One row of the standard-tier text-token tables, USD per 1M tokens. */
export interface ParsedPriceRow {
  model: string;
  input: number;
  /** null when the page prints "-" (no cache discount: bill cached tokens at `input`). */
  cachedInput: number | null;
  /** null when the table has no cache-writes column or prints "-". */
  cacheWrite: number | null;
  output: number;
  /** Set when the row label reads "(<272K context length)": a long-context tier exists above this. */
  shortContextLimit: number | null;
  /** Rows OpenAI groups under "Latest models"; their long-context rule lives on the model page. */
  latest: boolean;
}

/** Explicit long-context rates from the eight-column "Short context / Long context" tables. */
export interface ParsedLongContextRow {
  model: string;
  threshold: number;
  input: number;
  cachedInput: number | null;
  cacheWrite: number | null;
  output: number;
}

export interface ParsedPricingPage {
  rows: ParsedPriceRow[];
  longContext: ParsedLongContextRow[];
}

/** "Prompts with more than 272K input tokens are priced at 2x input and cache rates and 1.5x output …" */
export interface LongContextRule {
  threshold: number;
  inputMultiplier: number;
  outputMultiplier: number;
}

/** Multipliers OpenAI has used for every long-context tier so far; applied when a model page cannot be read. */
export const DEFAULT_LONG_CONTEXT_RULE: LongContextRule = { threshold: LONG_CONTEXT_THRESHOLD, inputMultiplier: 2, outputMultiplier: 1.5 };

// ---------------------------------------------------------------------------------------------------
// Astro island props
// ---------------------------------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Astro serialises props as `[0, value]` for scalars/objects and `[1, [..]]` for arrays. */
function decodeAstro(value: Json): Json {
  if (Array.isArray(value) && value.length === 2 && (value[0] === 0 || value[0] === 1)) {
    if (value[0] === 0) return decodeAstro(value[1]);
    const items = value[1];
    return Array.isArray(items) ? items.map(decodeAstro) : [];
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: { [key: string]: Json } = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeAstro(v);
    return out;
  }
  return value;
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

interface Island {
  start: number;
  props: { [key: string]: Json };
}

function pricingIslands(html: string): Island[] {
  const out: Island[] = [];
  const re = /<astro-island\b[^>]*component-url="[^"]*\/pricing\.[^"]*\.js"[^>]*>/g;
  for (const m of html.matchAll(re)) {
    const propsAttr = /\sprops="([^"]*)"/.exec(m[0]);
    if (!propsAttr) continue;
    let decoded: Json;
    try {
      decoded = decodeAstro(JSON.parse(unescapeHtml(propsAttr[1])) as Json);
    } catch {
      continue;
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) continue;
    out.push({ start: m.index ?? 0, props: decoded });
  }
  return out;
}

/** The content-switcher pane (standard / batch / flex / fast) an island is rendered in. */
function paneOf(html: string, islandStart: number): string | null {
  const window = html.slice(Math.max(0, islandStart - 4000), islandStart);
  let last: string | null = null;
  for (const m of window.matchAll(/data-content-switcher-pane="true"\s+data-value="([a-z-]+)"/g)) last = m[1];
  return last;
}

function label(cell: Json): string | null {
  if (typeof cell === "string") return cell;
  if (cell && typeof cell === "object" && !Array.isArray(cell)) {
    if (typeof cell.__pricingHtml === "string") return cell.__pricingHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if ("label" in cell) return label(cell.label);
    if (cell.__pricingTooltipHeading && typeof cell.__pricingTooltipHeading === "object" && !Array.isArray(cell.__pricingTooltipHeading)) {
      return label(cell.__pricingTooltipHeading.label ?? null);
    }
  }
  return null;
}

function headings(props: { [key: string]: Json }): string[] {
  const h = props.headings;
  return Array.isArray(h) ? h.map((c) => label(c) ?? "") : [];
}

/** A price cell: a number, or "-" / null when the rate does not apply. Anything else is not a token price. */
function price(cell: Json): number | null | undefined {
  if (typeof cell === "number") return Number.isFinite(cell) && cell >= 0 ? cell : undefined;
  if (cell === null || cell === "-" || cell === "–" || cell === "—" || cell === "") return null;
  return undefined;
}

const SHORT_CONTEXT_LABEL = /^(\S+)\s*\(\s*[<≤]\s*(\d+(?:\.\d+)?)\s*K\s+context(?:\s+length)?\s*\)\s*$/i;

function parseModelLabel(cell: Json): { model: string; shortContextLimit: number | null } | null {
  const text = label(cell);
  if (!text) return null;
  const m = SHORT_CONTEXT_LABEL.exec(text);
  if (m) return { model: m[1].toLowerCase(), shortContextLimit: Math.round(Number(m[2]) * 1000) };
  if (!/^[a-z0-9][a-z0-9.:_-]*$/i.test(text)) return null;
  return { model: text.toLowerCase(), shortContextLimit: null };
}

/** `[model, input, cached, output]` or `[model, input, cached, cacheWrite, output]`. */
function parseTokenRow(row: Json, latest: boolean): ParsedPriceRow | null {
  if (!Array.isArray(row) || (row.length !== 4 && row.length !== 5)) return null;
  const name = parseModelLabel(row[0]);
  if (!name) return null;
  const nums = row.slice(1).map(price);
  if (nums.some((n) => n === undefined)) return null;
  const [input, cached, third, fourth] = nums as Array<number | null>;
  const cacheWrite = row.length === 5 ? third : null;
  const output = row.length === 5 ? fourth : third;
  if (typeof input !== "number" || typeof output !== "number") return null;
  return { model: name.model, input, cachedInput: cached, cacheWrite, output, shortContextLimit: name.shortContextLimit, latest };
}

function thresholdFromHeadingGroups(props: { [key: string]: Json }): number {
  const groups = props.headingGroups;
  if (Array.isArray(groups)) {
    for (const g of groups) {
      const text = JSON.stringify(g);
      const m = /[>＞]\s*(\d+(?:\.\d+)?)\s*K input tokens/.exec(text);
      if (m) return Math.round(Number(m[1]) * 1000);
    }
  }
  return LONG_CONTEXT_THRESHOLD;
}

/**
 * Extract the standard-tier text-token prices and the explicit long-context tables from the pricing
 * page HTML. Batch, flex and fast-mode panes, fine-tuning, multimodal and tool tables are ignored.
 */
export function parseOpenAIPricingPage(html: string): ParsedPricingPage {
  const rows: ParsedPriceRow[] = [];
  const longContext: ParsedLongContextRow[] = [];
  const seen = new Set<string>();

  for (const island of pricingIslands(html)) {
    const p = island.props;
    const heads = headings(p);

    // Flagship table: one island per service tier, told apart by its `tier` prop.
    if (typeof p.tier === "string") {
      if (p.tier !== "standard" || !Array.isArray(p.rows)) continue;
      const latestCount = typeof p.collapsedLatestRowCount === "number" ? p.collapsedLatestRowCount : 0;
      p.rows.forEach((row, i) => {
        const parsed = parseTokenRow(row, i < latestCount);
        if (parsed && !seen.has(parsed.model)) {
          seen.add(parsed.model);
          rows.push(parsed);
        }
      });
      continue;
    }

    // Eight-column "Short context | Long context" table (explicit long-tier rates).
    if (heads.length === 9 && /short context/i.test(heads[1]) && /long context/i.test(heads[5]) && Array.isArray(p.groups)) {
      const threshold = thresholdFromHeadingGroups(p);
      for (const g of p.groups) {
        if (!g || typeof g !== "object" || Array.isArray(g)) continue;
        const name = parseModelLabel(g.model ?? null);
        const first = Array.isArray(g.rows) ? g.rows[0] : null;
        if (!name || !Array.isArray(first) || first.length !== 8) continue;
        const nums = first.map(price);
        if (nums.some((n) => n === undefined)) continue;
        const [sIn, sCached, sWrite, sOut, lIn, lCached, lWrite, lOut] = nums as Array<number | null>;
        if (typeof sIn === "number" && typeof sOut === "number" && !seen.has(name.model)) {
          seen.add(name.model);
          rows.push({ model: name.model, input: sIn, cachedInput: sCached, cacheWrite: sWrite, output: sOut, shortContextLimit: null, latest: false });
        }
        if (typeof lIn === "number" && typeof lOut === "number") {
          longContext.push({ model: name.model, threshold, input: lIn, cachedInput: lCached, cacheWrite: lWrite, output: lOut });
        }
      }
      continue;
    }

    // Category tables ("ChatGPT" / "Codex" / "Search" …): only the standard pane, never fine-tuning.
    if (heads[0] === "Category" && heads[1] === "Model" && Array.isArray(p.groups)) {
      if (paneOf(html, island.start) !== "standard") continue;
      for (const g of p.groups) {
        if (!g || typeof g !== "object" || Array.isArray(g) || !Array.isArray(g.rows)) continue;
        for (const row of g.rows) {
          const parsed = parseTokenRow(row, false);
          if (parsed && !seen.has(parsed.model)) {
            seen.add(parsed.model);
            rows.push(parsed);
          }
        }
      }
    }
  }
  return { rows, longContext };
}

/**
 * The long-context sentence from a model detail page, e.g. "Prompts with more than 272K input tokens
 * are priced at 2x input and cache rates and 1.5x output for the full request." Null when the page
 * has no such rule (the model bills one flat rate).
 */
export function parseLongContextRule(html: string): LongContextRule | null {
  const text = unescapeHtml(html).replace(/<[^>]+>/g, " ");
  const m = /more than\s+(\d+(?:\.\d+)?)\s*K\s+input tokens\s+are priced at\s+(\d+(?:\.\d+)?)x\s+input(?:\s+and\s+cache\s+rates?)?\s+and\s+(\d+(?:\.\d+)?)x\s+output/i.exec(text);
  if (!m) return null;
  return { threshold: Math.round(Number(m[1]) * 1000), inputMultiplier: Number(m[2]), outputMultiplier: Number(m[3]) };
}

// ---------------------------------------------------------------------------------------------------
// Table assembly
// ---------------------------------------------------------------------------------------------------

export type PricingEntrySource = "openai" | "alias" | "builtin" | "override";

export interface PricingEntry extends ModelPrice {
  model: string;
  source: PricingEntrySource;
}

/** Ids OpenAI documents as aliases of another listed model. */
export const MODEL_ALIASES: Record<string, string> = { "gpt-5.6": "gpt-5.6-sol" };

function scaled(rule: LongContextRule, p: ModelPrice): LongContextPrice {
  return {
    threshold: rule.threshold,
    input: p.input * rule.inputMultiplier,
    cachedInput: p.cachedInput * rule.inputMultiplier,
    output: p.output * rule.outputMultiplier,
    ...(p.cacheWrite === undefined ? {} : { cacheWrite: p.cacheWrite * rule.inputMultiplier }),
  };
}

export interface BuildPricingOptions {
  /** Rates for models the page no longer lists (kept, marked `builtin`). */
  seed: Record<string, ModelPrice>;
  /** Long-context rules read from model pages, keyed by model id; `null` = the page states no rule. */
  longRules?: Record<string, LongContextRule | null>;
}

/**
 * Turn a parsed page into the effective price list: page rows win, `-codex` ids inherit their base
 * model's rate, documented aliases follow their target, and seed rows fill in whatever the page has
 * dropped. Long-context tiers come from (in order) the explicit long-context table, the model page's
 * rule, or — for rows labelled "<272K context length" — OpenAI's standing 2x / 1.5x rule.
 */
export function buildPricingEntries(page: ParsedPricingPage, opts: BuildPricingOptions): PricingEntry[] {
  const table = new Map<string, PricingEntry>();
  for (const [model, p] of Object.entries(opts.seed)) table.set(model, { model, ...p, source: "builtin" });

  const explicitLong = new Map(page.longContext.map((r) => [r.model, r]));
  for (const row of page.rows) {
    const base: ModelPrice = {
      input: row.input,
      cachedInput: row.cachedInput ?? row.input,
      output: row.output,
      ...(row.cacheWrite === null ? {} : { cacheWrite: row.cacheWrite }),
    };
    const explicit = explicitLong.get(row.model);
    const rule = opts.longRules?.[row.model];
    let long: LongContextPrice | undefined;
    if (explicit) {
      long = {
        threshold: explicit.threshold,
        input: explicit.input,
        cachedInput: explicit.cachedInput ?? explicit.input,
        output: explicit.output,
        ...(explicit.cacheWrite === null ? {} : { cacheWrite: explicit.cacheWrite }),
      };
    } else if (rule) {
      long = scaled(rule, base);
    } else if (rule === undefined && row.shortContextLimit !== null) {
      long = scaled({ ...DEFAULT_LONG_CONTEXT_RULE, threshold: row.shortContextLimit }, base);
    }
    table.set(row.model, { model: row.model, ...base, ...(long ? { long } : {}), source: "openai" });
  }

  for (const [alias, target] of Object.entries(MODEL_ALIASES)) {
    const t = table.get(target);
    if (t && t.source === "openai") {
      const { model: _m, source: _s, ...p } = t;
      table.set(alias, { model: alias, ...p, source: "alias" });
    }
  }
  for (const entry of [...table.values()]) {
    if (entry.source !== "openai" && entry.source !== "alias") continue;
    if (!/^gpt-/.test(entry.model) || entry.model.includes("codex")) continue;
    const codex = `${entry.model}-codex`;
    const existing = table.get(codex);
    if (existing && existing.source === "openai") continue;
    const { model: _m, source: _s, ...p } = entry;
    table.set(codex, { model: codex, ...p, source: "alias" });
  }

  return [...table.values()].sort((a, b) => a.model.localeCompare(b.model));
}

/** Sanity gate before a fetched table replaces the current one. */
export function validatePricingEntries(entries: PricingEntry[]): string | null {
  const fromPage = entries.filter((e) => e.source === "openai");
  if (fromPage.length < 10) return `only ${fromPage.length} models were read from the pricing page`;
  if (!fromPage.some((e) => /^gpt-\d/.test(e.model))) return "no gpt-* model was read from the pricing page";
  for (const e of entries) {
    const rates = [e.input, e.cachedInput, e.output, e.cacheWrite ?? 0];
    if (e.long) rates.push(e.long.input, e.long.cachedInput, e.long.output, e.long.cacheWrite ?? 0, e.long.threshold);
    if (rates.some((r) => !Number.isFinite(r) || r < 0)) return `invalid rate for ${e.model}`;
    if (e.input === 0 && e.output === 0) return `zero rate for ${e.model}`;
  }
  return null;
}

/** Stable digest of a table so identical fetches do not create new snapshots. */
export function pricingEntriesKey(entries: PricingEntry[]): string {
  return JSON.stringify(
    [...entries]
      .sort((a, b) => a.model.localeCompare(b.model))
      .map((e) => [e.model, e.source, e.input, e.cachedInput, e.cacheWrite ?? null, e.output, e.long ? [e.long.threshold, e.long.input, e.long.cachedInput, e.long.cacheWrite ?? null, e.long.output] : null]),
  );
}

export function entriesToTable(entries: Iterable<PricingEntry>): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  for (const { model, source: _s, ...price } of entries) out[model] = price;
  return out;
}
