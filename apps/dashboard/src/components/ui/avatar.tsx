/* eslint-disable @next/next/no-img-element */
import { cn, initials } from "@/lib/utils";

export function Avatar({
  name,
  src,
  size = 28,
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.4) };
  if (src) {
    return <img src={src} alt={name ?? ""} width={size} height={size} style={style} className={cn("rounded-full object-cover shrink-0", className)} />;
  }
  return (
    <span
      style={style}
      className={cn("inline-flex items-center justify-center rounded-full bg-accent-soft text-accent font-semibold shrink-0", className)}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
