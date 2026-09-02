import { cn } from "@/lib/utils";

export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto scrollbar-thin max-md:px-3 max-md:pb-3", className)}>{children}</div>;
}

/**
 * Data table. With `responsive` (default) the same markup collapses into a stack of cards below `md`:
 * give each cell a `label`, and mark the identifying cell `primary`.
 */
export function Table({ children, className, responsive = true }: { children: React.ReactNode; className?: string; responsive?: boolean }) {
  return <table className={cn("w-full border-collapse text-sm", responsive && "table-responsive", className)}>{children}</table>;
}

export function Th({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return (
    <th className={cn("eyebrow border-b border-border px-3 py-2 text-[10.5px] font-normal whitespace-nowrap", right ? "text-right" : "text-left", className)}>
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  right,
  mono,
  title,
  label,
  primary,
}: {
  children?: React.ReactNode;
  className?: string;
  right?: boolean;
  mono?: boolean;
  title?: string;
  /** Mobile card label (rendered via CSS `attr(data-label)`). */
  label?: string;
  /** The identifying cell: full-width header of the mobile card. */
  primary?: boolean;
}) {
  return (
    <td
      title={title}
      data-label={label}
      data-primary={primary ? "" : undefined}
      className={cn("border-b border-border/70 px-3 py-2.5 align-middle", right && "text-right", mono && "tabular", className)}
    >
      {children}
    </td>
  );
}
