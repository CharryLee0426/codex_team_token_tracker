"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { usePerfTier } from "@/hooks/use-perf-tier";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useDashboardTheme } from "@/components/theme/dashboard-theme-provider";
import { TsushimaWindScene } from "./tsushima-wind";

/** Original landscape art with independent wind, mist and foreground layers, all behind the UI. */
export function TsushimaScene() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<TsushimaWindScene | null>(null);
  const { resolvedTheme } = useTheme();
  const { motion } = useDashboardTheme();
  const reduced = useReducedMotion();
  const tier = usePerfTier();
  const still = reduced || !motion;
  const dark = resolvedTheme !== "light";

  useEffect(() => {
    if (!canvas.current) return;
    const scene = new TsushimaWindScene(canvas.current, ({ x, y }) => {
      root.current?.style.setProperty("--scene-x", `${x.toFixed(2)}px`);
      root.current?.style.setProperty("--scene-y", `${y.toFixed(2)}px`);
    });
    engine.current = scene;
    scene.resize();

    const resize = () => scene.resize();
    const pointer = (event: PointerEvent) => {
      // Touch scrolling remains entirely native; there is no device-orientation permission.
      if (event.pointerType === "mouse") scene.setPointer(event.clientX, event.clientY);
    };
    const leave = () => scene.setPointer(null, null);
    const scroll = () => scene.setScroll(window.scrollY);
    const visibility = () => {
      if (document.hidden) scene.stop();
      else scene.resume();
    };
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", pointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    scroll();
    // Options are applied by the following effect before the first animated frame.
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", pointer);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("visibilitychange", visibility);
      scene.destroy();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.setOptions({ dark, tier, reducedMotion: still });
    if (!document.hidden) engine.current?.resume();
  }, [dark, tier, still]);

  return (
    <div ref={root} aria-hidden="true" className="scene-canvas tsushima-scene" data-motion={still ? "still" : "animated"}>
      <div className="tsushima-landscape" />
      <div className="tsushima-veil" />
      <canvas ref={canvas} className="tsushima-atmosphere" />
    </div>
  );
}
