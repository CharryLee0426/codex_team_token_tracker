"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useMounted } from "@/hooks/use-mounted";
import { usePerfTier } from "@/hooks/use-perf-tier";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { SPACE_BG } from "@/lib/theme";
import { StarScene, type SceneMode } from "./particles";
import { useScene } from "./scene-provider";

export function sceneModeForPath(pathname: string | null): SceneMode {
  if (!pathname || pathname === "/") return "landing";
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up") || pathname.startsWith("/j/")) return "auth";
  return "app";
}

/**
 * Fixed full-viewport canvas behind every page. Lives in the root layout so it survives navigation:
 * the landing constellation, the warp transition and the dashboard's quiet drift are one continuous scene.
 */
export function SceneCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<StarScene | null>(null);
  const pathname = usePathname();
  const mode = sceneModeForPath(pathname);
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  const reduced = useReducedMotion();
  const tier = usePerfTier();
  const { attach } = useScene();

  // Landing and auth pages are always in the dark palette; the app follows the user's theme.
  const themeKnown = mode !== "app" || resolvedTheme !== undefined;
  const dark = mode !== "app" ? true : resolvedTheme !== "light";

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const engine = new StarScene(canvas);
    engineRef.current = engine;
    attach(engine);
    engine.resize();

    const onResize = () => engine.resize();
    const onPointerMove = (e: PointerEvent) => engine.setPointer(e.clientX, e.clientY);
    const onPointerDown = (e: PointerEvent) => {
      engine.setPointer(e.clientX, e.clientY, e.pointerType === "touch" ? 900 : 0);
      engine.press();
    };
    const onPointerLeave = () => engine.setPointer(null, null);
    const onScroll = () => engine.setScroll(window.scrollY);
    const onVisibility = () => {
      if (document.hidden) engine.stop();
      else engine.resume();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      attach(null);
      engine.destroy();
      engineRef.current = null;
    };
  }, [attach]);

  useEffect(() => {
    if (!mounted || !themeKnown) return;
    engineRef.current?.setOptions({ mode, dark, tier, reducedMotion: reduced });
  }, [mounted, themeKnown, mode, dark, tier, reduced]);

  return <canvas ref={ref} aria-hidden className="scene-canvas" style={{ background: mode === "app" ? "var(--bg)" : SPACE_BG }} />;
}
