"use client";

import { useEffect, useState } from "react";

/** Current time, refreshed every `intervalMs`. Starts at mount to keep SSR/CSR markup identical. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
