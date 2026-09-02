import { cn } from "@/lib/utils";

export function TooltipBox({ title, children, className }: { title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-[168px] rounded-lg border border-border bg-bg-2/95 px-3 py-2 text-xs shadow-xl shadow-black/20 backdrop-blur-md", className)}>
      {title ? <div className="mb-1.5 font-medium text-fg">{title}</div> : null}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** Value first (strong), label second; a short line-key in the series color carries identity. */
export function TooltipRow({ color, label, value, muted }: { color?: string; label: React.ReactNode; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-4", muted ? "text-muted" : "text-fg-2")}>
      <span className="flex min-w-0 items-center gap-1.5">
        {color ? <span className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ background: color }} /> : null}
        <span className="truncate">{label}</span>
      </span>
      <span className="tabular font-mono font-medium text-fg">{value}</span>
    </div>
  );
}
