import { cn } from "@/lib/utils";

export function TooltipBox({ title, children, className }: { title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-bg px-3 py-2 text-xs shadow-lg shadow-black/5 min-w-[160px]", className)}>
      {title ? <div className="mb-1 font-medium text-fg">{title}</div> : null}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function TooltipRow({ color, label, value, muted }: { color?: string; label: React.ReactNode; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-4", muted ? "text-muted" : "text-fg-2")}>
      <span className="flex items-center gap-1.5 min-w-0">
        {color ? <span className="inline-block h-2 w-2 rounded-sm shrink-0" style={{ background: color }} /> : null}
        <span className="truncate">{label}</span>
      </span>
      <span className="tabular text-fg font-medium">{value}</span>
    </div>
  );
}
