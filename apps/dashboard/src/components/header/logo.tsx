import Link from "next/link";
import { cn } from "@/lib/utils";

/** Orbit mark: a hub with a satellite on an inclined ring. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg shadow-[0_0_0_1px_var(--accent-glow)]", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size * 0.64} height={size * 0.64} viewBox="0 0 24 24" fill="none">
        <ellipse cx="12" cy="12" rx="9" ry="4.2" transform="rotate(-28 12 12)" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="2.6" fill="currentColor" />
        <circle cx="19.4" cy="8.2" r="1.7" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Logo({ href = "/", className, compact = false }: { href?: string; className?: string; compact?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex min-w-0 items-center gap-2.5 text-fg", className)} aria-label="Codex Tracker">
      <LogoMark />
      {!compact ? (
        <span className="truncate text-[15px] font-semibold tracking-tight">
          Codex <span className="font-normal text-fg-2">Tracker</span>
        </span>
      ) : null}
    </Link>
  );
}
