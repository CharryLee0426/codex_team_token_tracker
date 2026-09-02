"use client";

import { useEffect, useRef, type PointerEvent } from "react";
import { useScene } from "@/components/scene/scene-provider";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/** Parallax travel of the frame under the pointer, in px. Translation only — rotating a form the
 *  user is typing into reads as a gimmick and hurts. */
const PARALLAX = 5;

/**
 * Glass frame around whatever the auth flow renders. It publishes its own rectangle to the canvas
 * scene, so the orbiting particle rings are drawn around this element rather than a guessed spot —
 * the card and the field behind it stay locked together while the layout reflows.
 */
export function AuthAperture({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { setFocus } = useScene();
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      setFocus({ x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height });
    };
    report();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(report) : null;
    ro?.observe(el);
    window.addEventListener("resize", report);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", report);
      setFocus(null);
    };
  }, [setFocus]);

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
    if (reduced) return;
    el.style.setProperty("--px", `${((px - 0.5) * PARALLAX).toFixed(2)}px`);
    el.style.setProperty("--py", `${((py - 0.5) * PARALLAX).toFixed(2)}px`);
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--px", "0px");
    el.style.setProperty("--py", "0px");
  }

  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className={cn("auth-aperture w-full", className)}>
      <span className="hud-corner -top-px -left-px rounded-tl-[22px] border-t border-l" />
      <span className="hud-corner -top-px -right-px rounded-tr-[22px] border-t border-r" />
      <span className="hud-corner -bottom-px -left-px rounded-bl-[22px] border-b border-l" />
      <span className="hud-corner -right-px -bottom-px rounded-br-[22px] border-r border-b" />
      <div className="auth-aperture-inner">
        <div className="relative z-1">{children}</div>
      </div>
    </div>
  );
}
