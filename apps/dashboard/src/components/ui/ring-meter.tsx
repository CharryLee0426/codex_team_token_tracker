/** Circular meter for a 0..1 ratio: the fill in the accent, the track a lighter step of the same hue. */
export function RingMeter({ value, size = 44, stroke = 4, className }: { value: number; size?: number; stroke?: number; className?: string }) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: "var(--accent)", opacity: 0.18 }} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ stroke: "var(--accent)", transition: "stroke-dashoffset 0.9s var(--ease-out)" }}
      />
    </svg>
  );
}
