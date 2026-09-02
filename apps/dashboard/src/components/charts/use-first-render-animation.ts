"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Charts grow in once, when they first appear. Live data updates afterwards must not re-animate
 * (recharts would replay the whole transition on every changed bucket).
 */
export function useFirstRenderAnimation(durationMs = 700): { animate: boolean; duration: number } {
  const reduced = useReducedMotion();
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setAnimate(false), durationMs + 100);
    return () => window.clearTimeout(id);
  }, [durationMs]);
  return { animate: animate && !reduced, duration: durationMs };
}
