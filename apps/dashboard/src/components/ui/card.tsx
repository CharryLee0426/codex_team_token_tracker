import { cn } from "@/lib/utils";

/**
 * Surface container. `interactive` adds a hover lift; `stale` dims the content while data refetches
 * (hold the previous render instead of flashing a skeleton).
 */
export function Card({
  className,
  children,
  interactive = false,
  stale = false,
  as: Tag = "section",
}: {
  className?: string;
  children: React.ReactNode;
  interactive?: boolean;
  stale?: boolean;
  as?: "section" | "div" | "article" | "li";
}) {
  return (
    <Tag
      aria-busy={stale || undefined}
      className={cn(
        "surface relative min-w-0 transition-[opacity,border-color,transform,box-shadow] duration-300",
        interactive && "hover:border-border-strong hover:-translate-y-px",
        stale && "opacity-60",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  hint,
  action,
  className,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-3 px-4 pt-4 pb-2 sm:px-5", className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h3>
        {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-4 pb-4 sm:px-5 sm:pb-5", className)}>{children}</div>;
}
