import type { PerfTier } from "@/hooks/use-perf-tier";
import { clamp, damp, hash01 } from "@/lib/motion";

export interface TsushimaWindOptions {
  dark: boolean;
  tier: PerfTier;
  reducedMotion: boolean;
}

interface MapleLeaf {
  phase: number;
  lane: number;
  depth: number;
  size: number;
  speed: number;
  tumble: number;
  tint: number;
}

interface GrassStem {
  x: number;
  height: number;
  bend: number;
  phase: number;
  plume: boolean;
}

const TAU = Math.PI * 2;
const LEAF_COUNT: Record<PerfTier, number> = { high: 28, medium: 18, low: 9 };
const MIST_COUNT: Record<PerfTier, number> = { high: 4, medium: 3, low: 2 };
const GRASS_COUNT: Record<PerfTier, number> = { high: 36, medium: 24, low: 12 };
const LEAF_COLORS = ["#a83f31", "#bb4936", "#8e312d", "#c45c43"];

/** Seven pointed lobes with uneven serrations, drawn once and reused at every depth. */
function mapleOutline(): Path2D {
  const path = new Path2D();
  path.moveTo(0, 0.69);
  path.lineTo(0.24, 0.49);
  path.lineTo(0.58, 0.68);
  path.lineTo(0.49, 0.34);
  path.lineTo(0.84, 0.39);
  path.lineTo(0.72, 0.2);
  path.lineTo(1.15, -0.02);
  path.lineTo(0.85, -0.13);
  path.lineTo(0.97, -0.38);
  path.lineTo(0.57, -0.25);
  path.lineTo(0.64, -0.64);
  path.lineTo(0.44, -0.5);
  path.lineTo(0.37, -0.96);
  path.lineTo(0.17, -0.64);
  path.lineTo(0, -1.28);
  path.lineTo(-0.19, -0.63);
  path.lineTo(-0.36, -0.89);
  path.lineTo(-0.44, -0.48);
  path.lineTo(-0.65, -0.68);
  path.lineTo(-0.55, -0.25);
  path.lineTo(-0.97, -0.42);
  path.lineTo(-0.85, -0.13);
  path.lineTo(-1.13, 0);
  path.lineTo(-0.73, 0.21);
  path.lineTo(-0.88, 0.39);
  path.lineTo(-0.48, 0.35);
  path.lineTo(-0.57, 0.67);
  path.lineTo(-0.23, 0.49);
  path.closePath();
  return path;
}

/**
 * A transparent living layer over the island artwork. React owns events and visibility;
 * only resume() activates the scene, so changing options cannot revive a hidden tab.
 */
export class TsushimaWindScene {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly leafPath: Path2D;
  private readonly leaves: MapleLeaf[];
  private readonly grass: GrassStem[];
  private opts: TsushimaWindOptions = { dark: true, tier: "medium", reducedMotion: false };
  private width = 0;
  private height = 0;
  private time = 0;
  private last = 0;
  private active = false;
  private destroyed = false;
  private raf: number | null = null;
  private pointer = { x: 0, y: 0, active: false };
  private drift = { x: 0, y: 0 };
  private scroll = 0;
  private scrollDrift = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onFrame?: (offset: { x: number; y: number }) => void,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.leafPath = mapleOutline();
    this.leaves = Array.from({ length: LEAF_COUNT.high }, (_, index) => {
      const depth = 0.22 + hash01(index * 17 + 21) * 0.78;
      return {
        phase: hash01(index * 31 + 3),
        lane: 0.06 + hash01(index * 23 + 13) * 0.83,
        depth,
        size: 2.6 + depth * 8.5 + hash01(index * 41 + 9) * 1.8,
        speed: 12 + depth * 25,
        tumble: hash01(index * 37 + 5) * TAU,
        tint: Math.floor(hash01(index * 43 + 11) * LEAF_COLORS.length),
      };
    });
    this.grass = Array.from({ length: GRASS_COUNT.high }, (_, index) => ({
      // Alternate between the edges; the center remains quiet behind the dashboard.
      x: index % 2 === 0 ? hash01(index * 29 + 7) * 0.2 : 0.78 + hash01(index * 29 + 7) * 0.22,
      height: 44 + hash01(index * 19 + 17) * 100,
      bend: 16 + hash01(index * 13 + 31) * 29,
      phase: hash01(index * 47 + 3) * TAU,
      plume: index % 3 !== 0,
    }));
  }

  setOptions(next: TsushimaWindOptions): void {
    if (this.destroyed) return;
    const previous = this.opts;
    this.opts = { ...next };
    if (previous.tier !== next.tier || !this.width) this.resize();
    if (next.reducedMotion) {
      this.cancelFrame();
      this.draw();
    } else if (this.active) {
      this.start();
    } else {
      this.draw();
    }
  }

  resize(): void {
    if (this.destroyed) return;
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;
    const dpr = this.opts.tier === "low" ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  setPointer(x: number | null, y: number | null): void {
    this.pointer.active = x !== null && y !== null;
    if (x !== null && y !== null) {
      this.pointer.x = x;
      this.pointer.y = y;
    }
  }

  setScroll(y: number): void {
    this.scroll = Math.max(0, y);
  }

  resume(): void {
    if (this.destroyed || !this.ctx) return;
    this.active = true;
    if (this.opts.reducedMotion) this.draw();
    else this.start();
  }

  stop(): void {
    this.active = false;
    this.cancelFrame();
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.ctx?.clearRect(0, 0, this.width, this.height);
  }

  private cancelFrame(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private start(): void {
    if (this.raf !== null || !this.ctx || !this.active || this.opts.reducedMotion) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.raf = null;
    if (!this.active || this.destroyed || this.opts.reducedMotion) return;
    const interval = 1000 / (this.opts.tier === "low" ? 20 : 30);
    const elapsed = now - this.last;
    if (elapsed >= interval) {
      const dt = clamp(elapsed / 1000, 0, 0.08);
      this.last = now;
      this.time += dt;
      const targetX = this.pointer.active ? clamp(this.pointer.x / Math.max(1, this.width) - 0.5, -0.5, 0.5) : 0;
      const targetY = this.pointer.active ? clamp(this.pointer.y / Math.max(1, this.height) - 0.5, -0.5, 0.5) : 0;
      this.drift.x = damp(this.drift.x, targetX * 16, 1.8, dt);
      this.drift.y = damp(this.drift.y, targetY * 10, 1.8, dt);
      this.scrollDrift = damp(this.scrollDrift, Math.min(this.scroll, this.height) * 0.035, 2, dt);
      this.draw();
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx || !this.width || !this.height || this.destroyed) return;
    ctx.clearRect(0, 0, this.width, this.height);
    // A deterministic still composition under reduced motion, independent of prior input/time.
    const time = this.opts.reducedMotion ? 0 : this.time;
    this.onFrame?.(this.active && !this.opts.reducedMotion ? {
      x: this.drift.x + Math.sin(time * 0.09) * 3,
      y: this.drift.y * 0.7 + Math.sin(time * 0.08) * 2 - clamp(this.scrollDrift * 0.18, 0, 6),
    } : { x: 0, y: 0 });
    this.drawMist(ctx, time);
    this.drawGrass(ctx, time);
    const count = LEAF_COUNT[this.opts.tier];
    for (let index = 0; index < count; index++) this.drawLeaf(ctx, this.leaves[index], time);
  }

  private drawMist(ctx: CanvasRenderingContext2D, time: number): void {
    const count = MIST_COUNT[this.opts.tier];
    for (let index = 0; index < count; index++) {
      const phase = hash01(index * 29 + 101) * TAU;
      const x = this.width * (0.25 + index * 0.19) + Math.sin(time * 0.055 + phase) * this.width * 0.16;
      const y = this.height * (0.32 + index * 0.095) + Math.sin(time * 0.08 + phase) * 9;
      const radiusX = this.width * (0.27 + hash01(index * 19 + 33) * 0.12);
      const radiusY = Math.max(22, this.height * (0.026 + hash01(index * 13 + 71) * 0.018));
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(radiusX, radiusY);
      const mist = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const alpha = this.opts.dark ? 0.048 : 0.07;
      mist.addColorStop(0, `rgba(204, 216, 210, ${alpha})`);
      mist.addColorStop(0.45, `rgba(204, 216, 210, ${alpha * 0.45})`);
      mist.addColorStop(1, "rgba(204, 216, 210, 0)");
      ctx.fillStyle = mist;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
  }

  private drawLeaf(ctx: CanvasRenderingContext2D, leaf: MapleLeaf, time: number): void {
    const span = this.width + 160;
    // Integrating the gust analytically keeps trajectories smooth and stable after a resize.
    const travel = time * leaf.speed + Math.sin(time * 0.43 + leaf.tumble) * 22 * leaf.depth;
    const progress = ((leaf.phase + travel / span) % 1 + 1) % 1;
    const flutter = Math.sin(time * (0.8 + leaf.depth * 0.65) + leaf.tumble);
    const driftX = this.opts.reducedMotion ? 0 : this.drift.x;
    const driftY = this.opts.reducedMotion ? 0 : this.drift.y - this.scrollDrift;
    const x = this.width + 80 - progress * span + driftX * leaf.depth;
    const y = this.height * leaf.lane + flutter * (12 + leaf.depth * 22) + Math.sin(progress * TAU + leaf.tumble) * 24 + driftY * leaf.depth;
    const fade = clamp(Math.min(x + 35, this.width + 35 - x) / 65, 0, 1);
    if (fade <= 0) return;
    const turn = time * (0.22 + leaf.depth * 0.36) + leaf.tumble;
    const face = Math.cos(time * (0.65 + leaf.depth * 0.38) + leaf.tumble);
    const width = (0.2 + Math.abs(face) * 0.8) * (face < 0 ? -1 : 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(turn + flutter * 0.3);
    ctx.scale(leaf.size * width, leaf.size);
    ctx.globalAlpha = fade * (0.27 + leaf.depth * 0.4) * (this.opts.dark ? 1 : 0.78);
    ctx.fillStyle = LEAF_COLORS[leaf.tint];
    ctx.fill(this.leafPath);
    // One folded half catches less light as the leaf tumbles.
    ctx.save();
    ctx.clip(this.leafPath);
    ctx.fillStyle = face > 0 ? "rgba(43, 19, 16, 0.27)" : "rgba(235, 139, 91, 0.2)";
    ctx.beginPath();
    ctx.moveTo(0, -1.3);
    ctx.lineTo(0, 0.7);
    ctx.lineTo(1.3, 0.75);
    ctx.lineTo(1.3, -1.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (leaf.depth > 0.45 && this.opts.tier !== "low") {
      ctx.strokeStyle = "rgba(248, 167, 114, 0.45)";
      ctx.lineWidth = 0.045;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0.65);
      ctx.lineTo(0, -1.07);
      ctx.moveTo(0, 0.34);
      ctx.lineTo(0.44, -0.56);
      ctx.moveTo(0, 0.34);
      ctx.lineTo(-0.45, -0.56);
      ctx.moveTo(0, 0.38);
      ctx.lineTo(0.9, -0.06);
      ctx.moveTo(0, 0.38);
      ctx.lineTo(-0.9, -0.06);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(100, 61, 42, 0.8)";
    ctx.lineWidth = 0.085;
    ctx.beginPath();
    ctx.moveTo(0, 0.58);
    ctx.quadraticCurveTo(-0.025, 0.86, -0.14, 1.02);
    ctx.stroke();
    ctx.restore();
  }

  private drawGrass(ctx: CanvasRenderingContext2D, time: number): void {
    const count = GRASS_COUNT[this.opts.tier];
    const scale = clamp(this.height / 900, 0.65, 1.15);
    const gust = Math.sin(time * 0.43) * 0.6 + Math.sin(time * 0.91 + 1.4) * 0.25;
    ctx.save();
    ctx.lineCap = "round";
    for (let index = 0; index < count; index++) {
      const stem = this.grass[index];
      const x = stem.x * this.width;
      const baseY = this.height + 12;
      const height = stem.height * scale;
      const sway = (gust + Math.sin(time * 0.8 + stem.phase) * 0.32) * 12 * scale;
      const bend = -stem.bend * scale + sway;
      const tipX = x + bend;
      const tipY = baseY - height;
      ctx.strokeStyle = this.opts.dark ? "rgba(188, 185, 154, 0.21)" : "rgba(97, 105, 80, 0.18)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.bezierCurveTo(x + bend * 0.1, baseY - height * 0.45, x + bend * 0.42, tipY + height * 0.12, tipX, tipY);
      ctx.stroke();
      if (!stem.plume) continue;
      ctx.strokeStyle = this.opts.dark ? "rgba(225, 216, 186, 0.25)" : "rgba(128, 127, 101, 0.2)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let frond = 0; frond < 7; frond++) {
        const t = frond / 7;
        const centerX = tipX + bend * 0.2 * (1 - t);
        const centerY = tipY + t * 27 * scale;
        const length = Math.sin((t * 0.8 + 0.1) * Math.PI) * 12 * scale;
        ctx.moveTo(centerX + length * 0.4, centerY - length * 0.75);
        ctx.quadraticCurveTo(centerX + 2, centerY - 1, centerX, centerY + 4);
        ctx.moveTo(centerX - length, centerY - length * 0.5);
        ctx.quadraticCurveTo(centerX - 3, centerY, centerX, centerY + 4);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
