/** Small, dependency-free motion helpers shared by the scene engine, hooks and components. */

export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
export const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing: moves `current` toward `target` by a factor per second. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface Spring {
  value: number;
  velocity: number;
}

/**
 * Semi-implicit Euler spring integration (stable for the stiffness/damping ranges used here).
 * `dt` in seconds. Mutates the spring in place.
 */
export function springStep(s: Spring, target: number, dt: number, stiffness = 170, damping = 26): void {
  const step = Math.min(dt, 1 / 30);
  const force = -stiffness * (s.value - target) - damping * s.velocity;
  s.velocity += force * step;
  s.value += s.velocity * step;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Deterministic hash → [0, 1) for stable per-item animation delays and pseudo-random layouts. */
export function hash01(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
