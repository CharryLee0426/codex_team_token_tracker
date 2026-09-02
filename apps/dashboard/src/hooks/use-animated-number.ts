"use client";

import { useEffect, useRef, useState } from "react";
import { easeOutCubic } from "@/lib/motion";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Tweens toward `target` whenever it changes (count-up on first data, smooth updates on live changes).
 * Returns the target directly under reduced motion or when `enabled` is false.
 */
export function useAnimatedNumber(target: number, { duration = 900, enabled = true }: { duration?: number; enabled?: boolean } = {}): number {
  const reduced = useReducedMotion();
  const animate = enabled && !reduced && Number.isFinite(target);
  const [display, setDisplay] = useState(animate ? 0 : target);
  const fromRef = useRef(animate ? 0 : target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (target - from) * easeOutCubic(t);
      fromRef.current = v;
      setDisplay(v);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else frame.current = null;
    };
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [target, duration, animate]);

  return animate ? display : target;
}
