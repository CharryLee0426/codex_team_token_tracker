import { cn } from "@/lib/utils";
import { AnimatedValue } from "./animated-value";
import { RingMeter } from "./ring-meter";
import { Skeleton } from "./skeleton";
import { Sparkline } from "./sparkline";

interface Props {
  label: React.ReactNode;
  value: number;
  /** Formats the (animated) numeric value: formatTokens, formatUSD, … */
  format: (n: number) => string;
  hint?: string;
  sub?: React.ReactNode;
  loading?: boolean;
  /** Small element next to the label (live dot, badge). */
  accent?: React.ReactNode;
  /** Optional trend (e.g. daily totals) rendered as a sparkline. */
  trend?: number[];
  /** Optional 0..1 ratio rendered as a ring meter. */
  meter?: number;
  /** The one hero figure of the view: larger type and a wider sparkline. */
  hero?: boolean;
  className?: string;
}

export function StatTile({ label, value, format, hint, sub, loading, accent, trend, meter, hero, className }: Props) {
  return (
    <div className={cn("surface @container flex min-w-0 flex-col gap-2 px-4 py-3.5", className)} title={hint}>
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow leading-tight">{label}</span>
        {accent}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {loading ? (
            <Skeleton className={cn("w-24", hero ? "h-9" : "h-7")} />
          ) : (
            <div className={cn("truncate font-semibold leading-none tracking-tight text-fg", hero ? "text-[30px] @xs:text-[34px]" : "text-[26px]")}>
              <AnimatedValue value={value} format={format} />
            </div>
          )}
          {sub ? <div className="mt-1.5 line-clamp-2 text-xs leading-snug text-fg-2">{sub}</div> : null}
        </div>
        {!loading && trend && trend.length >= 2 ? (
          <Sparkline values={trend} width={hero ? 104 : 88} height={hero ? 34 : 28} className="hidden shrink-0 @xs:block" />
        ) : !loading && meter !== undefined ? (
          <RingMeter value={meter} className="shrink-0" />
        ) : null}
      </div>
    </div>
  );
}
