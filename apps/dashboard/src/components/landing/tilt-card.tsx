"use client";

import { useRef, type PointerEvent } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

const MAX_TILT = 7;

/** Surface that tilts toward the mouse with a glare highlight; inert for touch and reduced motion. */
export function TiltCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || reduced || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${((0.5 - py) * MAX_TILT).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((px - 0.5) * MAX_TILT * 1.3).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }

  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className={cn("tilt-card surface relative", className)}>
      {children}
    </div>
  );
}
