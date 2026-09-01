import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 text-fg", className)}>
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2" y="9" width="2.5" height="5" rx="1" fill="currentColor" />
          <rect x="6.75" y="5" width="2.5" height="9" rx="1" fill="currentColor" />
          <rect x="11.5" y="2" width="2.5" height="12" rx="1" fill="currentColor" />
        </svg>
      </span>
      <span className="text-sm font-semibold tracking-tight">Codex Tracker</span>
    </Link>
  );
}
