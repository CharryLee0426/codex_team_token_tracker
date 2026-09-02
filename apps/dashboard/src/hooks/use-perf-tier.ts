"use client";

import { useEffect, useState } from "react";

/** Coarse device capability bucket used to scale visual effects (particle counts, frame caps, blur). */
export type PerfTier = "high" | "medium" | "low";

interface NavigatorHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

export function detectPerfTier(): PerfTier {
  if (typeof navigator === "undefined") return "medium";
  const nav = navigator as NavigatorHints;
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const saveData = nav.connection?.saveData === true;
  const slowNet = nav.connection?.effectiveType === "slow-2g" || nav.connection?.effectiveType === "2g";
  if (saveData || slowNet || cores <= 2 || memory <= 2) return "low";
  const coarse = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  if (coarse || cores <= 4 || memory <= 4) return "medium";
  return "high";
}

/** Detected after mount; "medium" during SSR so nothing depends on it for markup. */
export function usePerfTier(): PerfTier {
  const [tier, setTier] = useState<PerfTier>("medium");
  useEffect(() => setTier(detectPerfTier()), []);
  return tier;
}
