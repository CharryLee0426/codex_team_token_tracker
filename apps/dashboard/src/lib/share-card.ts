import { formatInt, formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared/format";
import type { Summary } from "./analytics";
import type { RangeBounds } from "./ranges";
import { initials } from "./utils";

/**
 * The share-card export contract, mirroring the native viewers' `UsageShareSnapshot`: aggregates for
 * the selected range plus the identity the person chose to share (their own name and avatar, or the
 * organization's). Never account IDs, emails, devices, sessions or transcript content. The image is
 * rendered locally in the browser and only leaves it when the user copies, downloads or shares it.
 */
export interface UsageShareSnapshot {
  scope: "personal" | "team";
  summary: Summary;
  bounds: RangeBounds;
  /** Daily token totals inside the range, oldest first (the trend strip). */
  dailyTotals: number[];
  /** Display name of the person (personal) or the organization (team). */
  name: string | null;
  /** Avatar of the person or the organization; must be CORS-readable or it falls back to initials. */
  imageUrl: string | null;
  /** Team: members with usage in range. Personal: connected devices. */
  count: number | null;
  capturedAt: number;
  /** Where the board lives, printed in the footer (host only). */
  site: string;
  demo: boolean;
  stale: boolean;
}

/** Localized copy the renderer prints; the caller resolves it with next-intl so the renderer stays pure. */
export interface ShareCardStrings {
  brand: string;
  scope: string;
  range: string;
  totalTokens: string;
  cost: string;
  requests: string;
  cacheHit: string;
  inputOutput: string;
  /** Third-row label: "Active members" (team) or "Devices" (personal). */
  count: string;
  models: string;
  demo: string;
  stale: string;
  capturedAt: string;
}

export interface ShareCardFonts {
  sans: string;
  mono: string;
}

/** Logical size of the card in CSS pixels; the bitmap is `scale` times larger. */
export const SHARE_CARD_WIDTH = 400;
export const SHARE_CARD_SCALE = 3;

// Fixed palette (the same mint → lavender wash and navy ink as the native cards) so a shared image
// looks alike wherever it was made, independent of the viewer's theme.
const INK = "#172438";
const INK_SOFT = "rgba(23, 36, 56, 0.7)";
const INK_LINE = "rgba(23, 36, 56, 0.15)";
const WASH_FROM = "#d4faed";
const WASH_TO = "#ebf0ff";
const PAD = 28;
const RADIUS = 24;
const MAX_TREND_BARS = 60;

interface Ctx {
  c: CanvasRenderingContext2D;
  fonts: ShareCardFonts;
}

function font(ctx: Ctx, size: number, weight: number | string = 400, family: "sans" | "mono" = "sans"): string {
  return `${weight} ${size}px ${ctx.fonts[family]}`;
}

/** Shrinks the font until the text fits `maxWidth`, down to `minSize`. Returns the size used. */
function fitText(ctx: Ctx, text: string, size: number, weight: number | string, maxWidth: number, minSize: number, family: "sans" | "mono" = "sans"): number {
  let s = size;
  ctx.c.font = font(ctx, s, weight, family);
  while (s > minSize && ctx.c.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.c.font = font(ctx, s, weight, family);
  }
  return s;
}

function ellipsize(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.c.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1) {
    chars.pop();
    const candidate = chars.join("") + "…";
    if (ctx.c.measureText(candidate).width <= maxWidth) return candidate;
  }
  return "…";
}

function roundedRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** The orbit mark from the site header: a hub with a satellite on an inclined ring. */
function drawLogoMark(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  c.save();
  c.fillStyle = INK;
  roundedRect(c, x, y, size, size, size * 0.28);
  c.fill();
  c.translate(x + size / 2, y + size / 2);
  const k = (size * 0.64) / 24;
  c.scale(k, k);
  c.strokeStyle = WASH_FROM;
  c.fillStyle = WASH_FROM;
  c.lineWidth = 1.6;
  c.save();
  c.rotate((-28 * Math.PI) / 180);
  c.beginPath();
  c.ellipse(0, 0, 9, 4.2, 0, 0, Math.PI * 2);
  c.stroke();
  c.restore();
  c.beginPath();
  c.arc(0, 0, 2.6, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(7.4, -3.8, 1.7, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function drawAvatar(ctx: Ctx, image: HTMLImageElement | null, name: string | null, x: number, y: number, size: number): void {
  const { c } = ctx;
  c.save();
  c.beginPath();
  c.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  c.closePath();
  c.clip();
  if (image) {
    c.drawImage(image, x, y, size, size);
  } else {
    c.fillStyle = "rgba(23, 36, 56, 0.12)";
    c.fillRect(x, y, size, size);
    c.fillStyle = INK;
    c.font = font(ctx, size * 0.38, 600);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(initials(name), x + size / 2, y + size / 2 + size * 0.02);
  }
  c.restore();
  c.beginPath();
  c.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  c.strokeStyle = INK_LINE;
  c.lineWidth = 1;
  c.stroke();
}

function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

interface Metric {
  value: string;
  label: string;
}

function metricsFor(s: UsageShareSnapshot, t: ShareCardStrings): Metric[][] {
  const u = s.summary.usage;
  return [
    [
      { value: formatUSD(s.summary.cost), label: t.cost },
      { value: formatInt(u.requests), label: t.requests },
    ],
    [
      { value: formatPercent(s.summary.cacheHit), label: t.cacheHit },
      { value: `↓ ${formatTokens(u.input)}  ↑ ${formatTokens(u.output)}`, label: t.inputOutput },
    ],
    [
      { value: s.count === null ? "—" : formatInt(s.count), label: t.count },
      { value: formatInt(s.summary.models), label: t.models },
    ],
  ];
}

/**
 * Paints the card onto `canvas` at SHARE_CARD_SCALE and returns the bitmap size in CSS pixels.
 * Height follows the content. Async only because the avatar has to load first.
 */
export async function renderShareCard(canvas: HTMLCanvasElement, snapshot: UsageShareSnapshot, strings: ShareCardStrings, fonts: ShareCardFonts): Promise<{ width: number; height: number }> {
  const avatar = await loadImage(snapshot.imageUrl);
  const c2d = canvas.getContext("2d");
  if (!c2d) throw new Error("canvas 2d context unavailable");
  const ctx: Ctx = { c: c2d, fonts };
  const c = c2d;
  const W = SHARE_CARD_WIDTH;
  const inner = W - PAD * 2;
  const metrics = metricsFor(snapshot, strings);
  const showTrend = snapshot.dailyTotals.length > 1 && snapshot.dailyTotals.some((v) => v > 0);
  const flags = [snapshot.demo ? strings.demo : null, snapshot.stale ? strings.stale : null].filter((f): f is string => !!f);

  // Measure first: the layout is fixed except for the optional trend strip and footer flags.
  const TREND_H = 40;
  const height =
    PAD + // top
    18 + // brand row
    24 +
    48 + // identity row
    18 + // range line
    22 +
    58 + // hero figure
    6 +
    18 + // hero label
    (showTrend ? 16 + TREND_H : 0) +
    22 +
    1 + // divider
    20 +
    metrics.length * 46 +
    6 +
    flags.length * 18 +
    14 + // captured at
    18 + // site
    PAD;

  const scale = SHARE_CARD_SCALE;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(height * scale);
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.clearRect(0, 0, W, height);

  // Card wash.
  const wash = c.createLinearGradient(0, 0, W, height);
  wash.addColorStop(0, WASH_FROM);
  wash.addColorStop(1, WASH_TO);
  roundedRect(c, 0, 0, W, height, RADIUS);
  c.fillStyle = wash;
  c.fill();

  c.fillStyle = INK;
  c.textBaseline = "alphabetic";
  c.textAlign = "left";
  let y = PAD;

  // Brand row: wordmark left, orbit mark right.
  c.font = font(ctx, 12, 700, "mono");
  c.fillStyle = INK;
  drawSpaced(c, strings.brand, PAD, y + 13, 0.16 * 12);
  drawLogoMark(c, W - PAD - 26, y - 5, 26);
  y += 18 + 24;

  // Identity row: avatar, scope eyebrow, name.
  const AV = 48;
  drawAvatar(ctx, avatar, snapshot.name, PAD, y, AV);
  const textX = PAD + AV + 14;
  const textW = W - PAD - textX;
  c.fillStyle = INK_SOFT;
  c.font = font(ctx, 11, 600, "mono");
  drawSpaced(c, strings.scope.toUpperCase(), textX, y + 14, 0.14 * 11);
  c.fillStyle = INK;
  const nameText = snapshot.name ?? strings.scope;
  fitText(ctx, nameText, 22, 700, textW, 16);
  c.fillText(ellipsize(ctx, nameText, textW), textX, y + 40);
  y += 48 + 18;

  // Range.
  c.fillStyle = INK_SOFT;
  c.font = font(ctx, 12, 400);
  c.fillText(strings.range, PAD, y);
  y += 22;

  // Hero: total tokens.
  c.fillStyle = INK;
  const total = formatTokens(snapshot.summary.usage.total);
  fitText(ctx, total, 58, 700, inner, 30);
  c.fillText(total, PAD - 2, y + 50);
  y += 58 + 6;
  c.font = font(ctx, 14, 400);
  c.fillText(strings.totalTokens, PAD, y + 12);
  y += 18;

  // Trend strip: one bar per day (per few days on long ranges), the busiest bucket at full height.
  if (showTrend) {
    y += 16;
    const totals = bucketTotals(snapshot.dailyTotals, MAX_TREND_BARS);
    const max = Math.max(...totals) || 1;
    const gap = totals.length > 60 ? 1 : 2;
    const bw = Math.max(1, (inner - gap * (totals.length - 1)) / totals.length);
    const top = y;
    totals.forEach((v, i) => {
      const h = v > 0 ? Math.max(2, (v / max) * TREND_H) : 1.5;
      c.fillStyle = v === max ? INK : v > 0 ? "rgba(23, 36, 56, 0.35)" : "rgba(23, 36, 56, 0.12)";
      roundedRect(c, PAD + i * (bw + gap), top + TREND_H - h, bw, h, Math.min(1.5, bw / 2));
      c.fill();
    });
    y += TREND_H;
  }

  // Divider.
  y += 22;
  c.fillStyle = INK_LINE;
  c.fillRect(PAD, y, inner, 1);
  y += 1 + 20;

  // Metric grid: two columns, values above labels.
  const colW = inner / 2;
  for (const row of metrics) {
    row.forEach((m, i) => {
      const x = PAD + i * colW;
      c.fillStyle = INK;
      fitText(ctx, m.value, 20, 600, colW - 12, 12);
      c.fillText(m.value, x, y + 18);
      c.fillStyle = INK_SOFT;
      c.font = font(ctx, 11, 400);
      c.fillText(ellipsize(ctx, m.label, colW - 12), x, y + 34);
    });
    y += 46;
  }
  y += 6;

  // Footer: flags, capture time, site.
  c.fillStyle = INK_SOFT;
  for (const flag of flags) {
    c.font = font(ctx, 12, 700);
    c.fillText(flag, PAD, y + 12);
    y += 18;
  }
  c.font = font(ctx, 10, 400);
  c.fillText(strings.capturedAt, PAD, y + 10);
  y += 14;
  c.font = font(ctx, 12, 600);
  c.fillText(snapshot.site, PAD, y + 13);

  return { width: W, height };
}

/** Long ranges fold consecutive days together so the strip keeps at most `maxBars` readable bars. */
export function bucketTotals(totals: number[], maxBars: number): number[] {
  if (totals.length <= maxBars) return totals;
  const per = Math.ceil(totals.length / maxBars);
  const out: number[] = [];
  for (let i = 0; i < totals.length; i += per) out.push(totals.slice(i, i + per).reduce((a, b) => a + b, 0));
  return out;
}

/** fillText with manual letter spacing (Canvas `letterSpacing` is not available everywhere). */
function drawSpaced(c: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  let cursor = x;
  for (const ch of Array.from(text)) {
    c.fillText(ch, cursor, y);
    cursor += c.measureText(ch).width + spacing;
  }
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/png");
  });
}

/** File name for downloads and the Web Share sheet: `codex-usage-personal-2026-08-25_2026-09-10.png`. */
export function shareFileName(snapshot: UsageShareSnapshot): string {
  return `codex-usage-${snapshot.scope}-${snapshot.bounds.fromKey}_${snapshot.bounds.toKey}.png`;
}
