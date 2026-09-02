"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { FocusRect, StarScene } from "./particles";

interface SceneContextValue {
  /** Registers the engine owned by <SceneCanvas>. */
  attach: (engine: StarScene | null) => void;
  /** Warp the starfield, then navigate. Falls back to a plain navigation under reduced motion. */
  launch: (href: string) => void;
  launching: boolean;
  /** Tell the landing constellation where to live (viewport coordinates). */
  setFocus: (rect: FocusRect | null) => void;
}

const SceneContext = createContext<SceneContextValue | null>(null);

/** Delay before navigating so the warp burst is visible before the route swaps. */
const LAUNCH_DELAY_MS = 520;
const SETTLE_DELAY_MS = 250;
const LAUNCH_TIMEOUT_MS = 4000;

export function SceneProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const engineRef = useRef<StarScene | null>(null);
  const focusRef = useRef<FocusRect | null>(null);
  const launchPath = useRef<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const attach = useCallback((engine: StarScene | null) => {
    engineRef.current = engine;
    engine?.setFocus(focusRef.current);
  }, []);

  const setFocus = useCallback((rect: FocusRect | null) => {
    focusRef.current = rect;
    engineRef.current?.setFocus(rect);
  }, []);

  const launch = useCallback(
    (href: string) => {
      const engine = engineRef.current;
      if (!engine || reduced || launchPath.current) {
        router.push(href);
        return;
      }
      launchPath.current = pathname;
      setLaunching(true);
      engine.warp();
      window.setTimeout(() => router.push(href), LAUNCH_DELAY_MS);
    },
    [router, reduced, pathname],
  );

  // Once the route actually changed (or we gave up), ease the warp back down.
  useEffect(() => {
    if (!launching) return;
    const finish = () => {
      engineRef.current?.settle();
      launchPath.current = null;
      setLaunching(false);
    };
    if (launchPath.current !== null && pathname !== launchPath.current) {
      const id = window.setTimeout(finish, SETTLE_DELAY_MS);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(finish, LAUNCH_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [launching, pathname]);

  const value = useMemo(() => ({ attach, launch, launching, setFocus }), [attach, launch, launching, setFocus]);
  return <SceneContext.Provider value={value}>{children}</SceneContext.Provider>;
}

export function useScene(): SceneContextValue {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useScene must be used inside <SceneProvider>");
  return ctx;
}
