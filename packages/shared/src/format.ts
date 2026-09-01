/** 1234 → "1.23k", 5_600_000 → "5.6M". */
export function formatTokens(n: number, digits = 2): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return trim((n / 1000).toFixed(digits)) + "k";
  if (abs < 1_000_000_000) return trim((n / 1_000_000).toFixed(digits)) + "M";
  return trim((n / 1_000_000_000).toFixed(digits)) + "B";
}

function trim(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function formatUSD(n: number, opts: { compact?: boolean } = {}): string {
  if (!isFinite(n)) return "$0.00";
  if (opts.compact && n >= 1000) return "$" + trim((n / 1000).toFixed(2)) + "k";
  if (n > 0 && n < 0.01) return "<$0.01";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPercent(ratio: number, digits = 0): string {
  return (ratio * 100).toFixed(digits) + "%";
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
