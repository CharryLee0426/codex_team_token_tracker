/**
 * Tiny trend line for stat tiles: the series in the muted ink, the latest segment and end-marker in
 * the accent, with a 10% area wash. Purely decorative (`aria-hidden`) — the tile's value carries the number.
 */
export function Sparkline({ values, width = 96, height = 28, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  const pts = values.length >= 2 ? values : [0, 0];
  const max = Math.max(...pts, 1);
  const pad = 3;
  const stepX = (width - pad * 2) / (pts.length - 1);
  const coords = pts.map((v, i) => [pad + i * stepX, height - pad - (v / max) * (height - pad * 2)] as const);
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${height - pad} L${pad} ${height - pad} Z`;
  const [lx, ly] = coords[coords.length - 1];
  const [px, py] = coords[coords.length - 2];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={area} style={{ fill: "var(--accent)", opacity: 0.1 }} />
      <path d={line} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--muted)", opacity: 0.8 }} />
      <path d={`M${px.toFixed(1)} ${py.toFixed(1)} L${lx.toFixed(1)} ${ly.toFixed(1)}`} fill="none" strokeWidth={1.5} strokeLinecap="round" style={{ stroke: "var(--accent)" }} />
      <circle cx={lx} cy={ly} r={3.5} style={{ fill: "var(--card)" }} />
      <circle cx={lx} cy={ly} r={2.2} style={{ fill: "var(--accent)" }} />
    </svg>
  );
}
