"use client";

import { useEffect, useRef, useState } from "react";

interface Options {
  /** Stop observing after the first intersection (default true: reveal-once). */
  once?: boolean;
  rootMargin?: string;
  threshold?: number | number[];
}

/**
 * Tracks whether an element is in the viewport. Returns `true` immediately when IntersectionObserver
 * is unavailable so content is never hidden behind a reveal animation.
 */
export function useInView<T extends Element>({ once = true, rootMargin = "0px 0px -10% 0px", threshold = 0.15 }: Options = {}) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) io.unobserve(entry.target);
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, rootMargin, threshold]);

  return [ref, inView] as const;
}
