import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

export function StatTile({
  label,
  value,
  hint,
  sub,
  loading,
  accent,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: string;
  sub?: React.ReactNode;
  loading?: boolean;
  accent?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card px-4 py-3 min-w-0", className)} title={hint}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted truncate">{label}</span>
        {accent}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <div className="mt-1 text-2xl font-semibold text-fg leading-tight truncate">{value}</div>
      )}
      {sub ? <div className="mt-1 text-xs text-fg-2 truncate">{sub}</div> : null}
    </div>
  );
}
