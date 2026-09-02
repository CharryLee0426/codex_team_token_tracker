"use client";

import { useAnimatedNumber } from "@/hooks/use-animated-number";

/** A number that counts toward its value (instant under reduced motion). */
export function AnimatedValue({ value, format, className, duration }: { value: number; format: (n: number) => string; className?: string; duration?: number }) {
  const shown = useAnimatedNumber(value, { duration });
  return <span className={className}>{format(shown)}</span>;
}
