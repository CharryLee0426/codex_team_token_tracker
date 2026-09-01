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
    <div className={cn("flex flex-col items-center justify-center text-center px-6 py-12 gap-2", className)}>
      {icon ? <div className="text-muted mb-1">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {body ? <p className="text-xs text-muted max-w-md">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
