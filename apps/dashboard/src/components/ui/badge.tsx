import { cn } from "@/lib/utils";

type Variant = "default" | "accent" | "success" | "warning" | "danger" | "muted";

const styles: Record<Variant, string> = {
  default: "border-border bg-card-2 text-fg-2",
  accent: "border-transparent bg-accent-soft text-accent",
  success: "border-transparent bg-[rgba(12,163,12,0.14)] text-[#0a7a0a] dark:text-[#4ade80]",
  warning: "border-transparent bg-[rgba(250,178,25,0.16)] text-[#8a5a00] dark:text-[#f5c451]",
  danger: "border-transparent bg-[rgba(208,59,59,0.12)] text-[#b02f2f] dark:text-[#f07070]",
  muted: "border-border bg-transparent text-muted",
};

export function Badge({
  variant = "default",
  className,
  children,
  title,
}: {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-[2px] font-mono text-[11px] leading-4 whitespace-nowrap", styles[variant], className)}
    >
      {children}
    </span>
  );
}
