import { cn } from "@/lib/utils";

export function LiveDot({ className, size = 8 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn("relative inline-block rounded-full bg-success text-success live-dot", className)}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
