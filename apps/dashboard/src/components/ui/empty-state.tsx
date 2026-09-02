import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-1 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card-2 text-muted">{icon}</div>
      ) : null}
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {body ? <p className="max-w-md text-xs text-muted">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
