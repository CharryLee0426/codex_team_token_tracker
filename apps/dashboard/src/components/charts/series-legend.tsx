import { cn } from "@/lib/utils";

export function SeriesLegend({ items, className }: { items: { name: string; color: string; extra?: React.ReactNode }[]; className?: string }) {
  return (
    <ul className={cn("mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2", className)}>
      {items.map((it) => (
        <li key={it.name} className="flex min-w-0 items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: it.color }} />
          <span className="truncate font-mono text-[11px]">{it.name}</span>
          {it.extra}
        </li>
      ))}
    </ul>
  );
}
