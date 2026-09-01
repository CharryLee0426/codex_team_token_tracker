import { cn } from "@/lib/utils";

export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto scrollbar-thin", className)}>{children}</div>;
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <table className={cn("w-full text-sm border-collapse", className)}>{children}</table>;
}

export function Th({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted border-b border-border whitespace-nowrap",
        right ? "text-right" : "text-left",
        className,
      )}
    >
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
}: {
  children?: React.ReactNode;
  className?: string;
  right?: boolean;
  mono?: boolean;
  title?: string;
}) {
  return (
    <td title={title} className={cn("px-3 py-2 border-b border-border/70 align-middle", right && "text-right", mono && "tabular", className)}>
      {children}
    </td>
  );
}
