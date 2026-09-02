import type { PerfTier } from "@/hooks/use-perf-tier";
import { clamp, damp, easeInOutCubic, hash01, lerp } from "@/lib/motion";
import { THEMES } from "@/lib/theme";

/**
 * Canvas "scene" behind the whole app: a layered starfield with drift, parallax and a warp burst used
 * for the landing → dashboard transition, plus (on the landing page) a constellation of device nodes
 * that spring back to their anchors, avoid the pointer and stream packets into a central hub.
 *
 * Pure engine: no React. The canvas component owns lifecycle, input and options.
 */
export type SceneMode = "landing" | "auth" | "app" | "off";

export interface SceneOptions {
  mode: SceneMode;
  dark: boolean;
  tier: PerfTier;
  reducedMotion: boolean;
}

export interface FocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Star {
  x: number; // normalized 0..1
  y: number;
  z: number; // depth 0.2 (far) .. 1 (near)
  r: number; // radius, CSS px
  phase: number;
  speed: number;
  tint: 0 | 1 | 2; // white | cyan | warm
}

interface Node {
  ax: number; // landing: anchor, normalized within the focus rect
  ay: number;
  /** Auth: ellipse scale relative to the focus rect, plus phase and angular velocity (rad/s). */
  orbit: number;
  angle: number;
  omega: number;
  x: number; // current position, CSS px
  y: number;
  vx: number;
  vy: number;
  r: number;
  ring: 0 | 1 | 2 | 3;
  seed: number;
}

interface Packet {
  from: number;
  t: number;
  speed: number;
}

const STAR_COUNT: Record<SceneMode, Record<PerfTier, number>> = {
  landing: { high: 240, medium: 150, low: 80 },
  auth: { high: 160, medium: 100, low: 60 },
  app: { high: 70, medium: 45, low: 28 },
  off: { high: 0, medium: 0, low: 0 },
};

const STAR_ALPHA: Record<SceneMode, number> = { landing: 1, auth: 0.9, app: 0.6, off: 0 };
const PACKET_COUNT = 9;
const POINTER_RADIUS = 170;

/** Auth aperture: particles per orbit ring, innermost first. */
const ORBIT_RINGS: Record<PerfTier, number[]> = {
  high: [9, 13, 17],
  medium: [7, 10, 13],
  low: [5, 7, 9],
};
/** Ellipse scale of each ring relative to the focused card, so ring 0 clears its edge. */
const ORBIT_SCALE = [1.14, 1.42, 1.74];

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a.toFixed(3)})`;
}

export class StarScene {
  private readonly ctx: CanvasRenderingContext2D | null;
  private opts: SceneOptions = { mode: "off", dark: true, tier: "medium", reducedMotion: false };
  private stars: Star[] = [];
  private nodes: Node[] = [];
  /** Which mode the current `nodes` were seeded for (the landing constellation and the auth aperture differ). */
  private nodesMode: SceneMode | null = null;
  private packets: Packet[] = [];
  /** Expanding ring left by a pointer press, 0..1 (auth aperture only). */
  private shockwave = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private pointer = { x: 0, y: 0, active: false, until: 0 };
  private parallax = { x: 0, y: 0 }; // smoothed, -1..1
  private scrollY = 0;
  private lastScrollY = 0;
  /** Constellation area in page coordinates (viewport y + scrollY at the time of measuring). */
  private focus: FocusRect | null = null;
  private warpT = 0;
  private warpTarget = 0;
  private hubPulse = 0;
  private time = 0;
  private last = 0;
  private raf: number | null = null;
  private running = false;
  private nebula: CanvasGradient[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false });
  }

  // ---- lifecycle ---------------------------------------------------------------------------------

  setOptions(next: Partial<SceneOptions>): void {
    const prev = this.opts;
    this.opts = { ...prev, ...next };
    if (prev.mode !== this.opts.mode || prev.tier !== this.opts.tier || !this.stars.length) this.seedStars();
    const wantsNodes = this.opts.mode === "landing" || this.opts.mode === "auth";
    if (wantsNodes && (this.nodesMode !== this.opts.mode || prev.tier !== this.opts.tier)) this.seedNodes();
    if (prev.tier !== this.opts.tier) this.resize();
    if (this.opts.mode === "off") {
      this.stop();
      this.paintBackground();
    } else if (this.opts.reducedMotion) {
      this.stop();
      this.renderStatic();
    } else {
      this.start();
    }
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = this.opts.tier === "low" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.buildNebula();
    this.placeNodes(true);
    if (!this.running) this.renderStatic();
  }

  start(): void {
    if (this.running || !this.ctx) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const minFrame = this.opts.mode === "app" || this.opts.tier === "low" ? 1000 / 30 : 0;
      if (now - this.last >= minFrame) {
        const dt = clamp((now - this.last) / 1000, 0, 0.05);
        this.last = now;
        this.update(dt);
        this.draw();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Restart the loop after a visibility pause, unless the scene is off or motion is reduced. */
  resume(): void {
    if (this.opts.mode !== "off" && !this.opts.reducedMotion) this.start();
  }

  stop(): void {
    this.running = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  destroy(): void {
    this.stop();
    this.stars = [];
    this.nodes = [];
    this.packets = [];
  }

  // ---- input --------------------------------------------------------------------------------------

  setPointer(x: number | null, y: number | null, holdMs = 0): void {
    if (x === null || y === null) {
      this.pointer.active = false;
      return;
    }
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = true;
    this.pointer.until = holdMs ? performance.now() + holdMs : Infinity;
  }

  /** A press ripples through the aperture; call alongside `setPointer` on pointerdown. */
  press(): void {
    if (this.opts.mode === "auth") this.shockwave = 1;
  }

  setScroll(y: number): void {
    this.scrollY = y;
  }

  /** Where the constellation should live, in page coordinates. `null` falls back to a viewport-based area. */
  setFocus(rect: FocusRect | null): void {
    this.focus = rect;
    this.lastScrollY = this.scrollY;
    this.placeNodes(true);
  }

  warp(): void {
    this.warpTarget = 1;
  }

  settle(): void {
    this.warpTarget = 0;
  }

  // ---- seeding ------------------------------------------------------------------------------------

  private seedStars(): void {
    const count = STAR_COUNT[this.opts.mode][this.opts.tier];
    const stars: Star[] = [];
    for (let i = 0; i < count; i++) {
      const z = 0.2 + hash01(i * 7 + 1) ** 1.6 * 0.8;
      const tintRoll = hash01(i * 13 + 5);
      stars.push({
        x: hash01(i * 3 + 11),
        y: hash01(i * 5 + 17),
        z,
        r: 0.35 + z * 1.15,
        phase: hash01(i * 11 + 3) * Math.PI * 2,
        speed: 0.5 + hash01(i * 17 + 9) * 1.2,
        tint: tintRoll < 0.72 ? 0 : tintRoll < 0.92 ? 1 : 2,
      });
    }
    this.stars = stars;
  }

  private seedNodes(): void {
    this.nodesMode = this.opts.mode;
    if (this.opts.mode === "auth") return this.seedOrbits();
    const nodes: Node[] = [{ ax: 0.5, ay: 0.5, orbit: 0, angle: 0, omega: 0, x: 0, y: 0, vx: 0, vy: 0, r: 5, ring: 0, seed: 0.5 }];
    const rings: Array<{ count: number; radius: number; size: number; ring: 1 | 2 }> = [
      { count: 5, radius: 0.24, size: 3.2, ring: 1 },
      { count: 9, radius: 0.44, size: 2.4, ring: 2 },
    ];
    let i = 1;
    for (const ring of rings) {
      for (let k = 0; k < ring.count; k++, i++) {
        const jitter = (hash01(i * 19) - 0.5) * 0.5;
        const angle = ((k + jitter) / ring.count) * Math.PI * 2 - Math.PI / 2;
        const radius = ring.radius * (0.86 + hash01(i * 23) * 0.28);
        nodes.push({
          ax: 0.5 + Math.cos(angle) * radius,
          ay: 0.5 + Math.sin(angle) * radius,
          orbit: 0,
          angle: 0,
          omega: 0,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          r: ring.size,
          ring: ring.ring,
          seed: hash01(i * 29) * 10,
        });
      }
    }
    this.nodes = nodes;
    this.packets = Array.from({ length: PACKET_COUNT }, (_, p) => ({ from: 1 + Math.floor(hash01(p * 31 + 7) * (nodes.length - 1)), t: hash01(p * 37 + 1), speed: 0.28 + hash01(p * 41 + 3) * 0.32 }));
    this.placeNodes(true);
  }

  /**
   * Auth aperture: three counter-rotating ellipses of particles around the sign-in card. Each
   * particle springs toward its moving orbit slot, so shoving them with the pointer bends the ring
   * and it recovers — the rotation is the anchor, not the position.
   */
  private seedOrbits(): void {
    const counts = ORBIT_RINGS[this.opts.tier];
    const nodes: Node[] = [];
    let i = 0;
    counts.forEach((count, ringIndex) => {
      // Alternate direction per ring so the field shears instead of turning as one disc.
      const dir = ringIndex % 2 === 0 ? 1 : -1;
      const speed = (0.1 - ringIndex * 0.022) * dir;
      for (let k = 0; k < count; k++, i++) {
        const jitter = (hash01(i * 19 + 3) - 0.5) * 0.7;
        nodes.push({
          ax: 0.5,
          ay: 0.5,
          orbit: ORBIT_SCALE[ringIndex] * (0.96 + hash01(i * 23 + 5) * 0.09),
          angle: ((k + jitter) / count) * Math.PI * 2,
          omega: speed * (0.85 + hash01(i * 31 + 7) * 0.3),
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          r: 2.9 - ringIndex * 0.55,
          ring: (ringIndex + 1) as 1 | 2 | 3,
          seed: hash01(i * 29 + 11) * 10,
        });
      }
    });
    this.nodes = nodes;
    this.packets = [];
    this.placeNodes(true);
  }

  private focusRect(): FocusRect {
    if (this.focus && this.focus.w > 40 && this.focus.h > 40) return { ...this.focus, y: this.focus.y - this.scrollY };
    const w = this.width;
    const h = this.height;
    // Fallback before the page reports a card: centred for auth, hero-shaped for the landing page.
    if (this.opts.mode === "auth") {
      const cw = Math.min(w * 0.8, 420);
      const ch = Math.min(h * 0.7, 520);
      return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
    }
    return w >= 900 ? { x: w * 0.52, y: h * 0.12, w: w * 0.42, h: h * 0.72 } : { x: w * 0.05, y: h * 0.05, w: w * 0.9, h: h * 0.55 };
  }

  private anchorOf(n: Node, f: FocusRect): [number, number] {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    if (this.opts.mode === "auth") {
      // The orbit slot itself rotates; the particle only ever springs toward it.
      const a = n.angle + this.time * n.omega;
      return [cx + Math.cos(a) * (f.w / 2) * n.orbit, cy + Math.sin(a) * (f.h / 2) * n.orbit];
    }
    // Keep the constellation roughly square inside the focus area so rings stay circular.
    const size = Math.min(f.w, f.h);
    return [cx + (n.ax - 0.5) * size, cy + (n.ay - 0.5) * size];
  }

  private placeNodes(snap: boolean): void {
    if (!this.nodes.length || !this.width) return;
    const f = this.focusRect();
    for (const n of this.nodes) {
      const [x, y] = this.anchorOf(n, f);
      if (snap || (n.x === 0 && n.y === 0)) {
        n.x = x;
        n.y = y;
        n.vx = 0;
        n.vy = 0;
      }
    }
  }

  private buildNebula(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.width;
    const h = this.height;
    const big = Math.max(w, h);
    const g1 = ctx.createRadialGradient(w * 0.74, h * 0.12, 0, w * 0.74, h * 0.12, big * 0.62);
    g1.addColorStop(0, "rgba(92,200,255,0.16)");
    g1.addColorStop(0.45, "rgba(92,200,255,0.05)");
    g1.addColorStop(1, "rgba(92,200,255,0)");
    const g2 = ctx.createRadialGradient(w * 0.12, h * 0.95, 0, w * 0.12, h * 0.95, big * 0.5);
    g2.addColorStop(0, "rgba(129,110,255,0.13)");
    g2.addColorStop(1, "rgba(129,110,255,0)");
    this.nebula = [g1, g2];
  }

  // ---- simulation ---------------------------------------------------------------------------------

  private update(dt: number): void {
    this.time += dt;
    const { mode } = this.opts;
    const pointerLive = this.pointer.active && performance.now() < this.pointer.until;

    // Pointer parallax, smoothed so the field glides rather than jitters.
    const targetX = pointerLive && this.width ? (this.pointer.x / this.width) * 2 - 1 : 0;
    const targetY = pointerLive && this.height ? (this.pointer.y / this.height) * 2 - 1 : 0;
    this.parallax.x = damp(this.parallax.x, targetX, 4, dt);
    this.parallax.y = damp(this.parallax.y, targetY, 4, dt);

    this.warpT = damp(this.warpT, this.warpTarget, this.warpTarget > this.warpT ? 6 : 2.5, dt);
    const warp = this.warpT;

    const driftX = mode === "app" ? -0.0012 : -0.004;
    const driftY = mode === "app" ? 0.0025 : 0.008;
    for (const s of this.stars) {
      s.x += driftX * s.z * dt;
      s.y += driftY * s.z * dt;
      if (warp > 0.01) {
        const dx = s.x - 0.5;
        const dy = s.y - 0.5;
        const push = warp * warp * (0.9 + s.z * 1.6) * dt;
        s.x += dx * push;
        s.y += dy * push;
        if (s.x < -0.15 || s.x > 1.15 || s.y < -0.15 || s.y > 1.15) {
          s.x = 0.5 + (hash01(Math.floor(this.time * 997) + s.phase * 100) - 0.5) * 0.25;
          s.y = 0.5 + (hash01(Math.floor(this.time * 991) + s.speed * 100) - 0.5) * 0.25;
        }
      } else {
        if (s.x < -0.05) s.x += 1.1;
        if (s.y > 1.05) s.y -= 1.1;
      }
    }

    if ((mode === "landing" || mode === "auth") && this.nodes.length) this.updateConstellation(dt, pointerLive);
    this.shockwave = this.shockwave > 0 ? Math.max(0, this.shockwave - dt * 1.1) : 0;
  }

  private updateConstellation(dt: number, pointerLive: boolean): void {
    const f = this.focusRect();
    // The page scrolled: carry the nodes along rigidly so only wander and pointer forces use the springs.
    const dScroll = this.scrollY - this.lastScrollY;
    this.lastScrollY = this.scrollY;
    if (dScroll) for (const n of this.nodes) n.y -= dScroll;
    // The aperture is springier than the constellation: a shove visibly bends the ring before it heals.
    const auth = this.opts.mode === "auth";
    const stiffness = auth ? 22 : 38;
    const dampingC = auth ? 5.2 : 7.5;
    const wander = auth ? 3 : 7;
    for (const n of this.nodes) {
      const [ax, ay] = this.anchorOf(n, f);
      // Gentle organic wander around the anchor.
      const wx = ax + Math.sin(this.time * 0.6 + n.seed) * wander + Math.cos(this.time * 0.23 + n.seed * 2) * (wander * 0.6);
      const wy = ay + Math.cos(this.time * 0.5 + n.seed * 1.7) * wander + Math.sin(this.time * 0.31 + n.seed) * (wander * 0.6);
      let fx = (wx - n.x) * stiffness - n.vx * dampingC;
      let fy = (wy - n.y) * stiffness - n.vy * dampingC;
      if (pointerLive && n.ring !== 0) {
        const dx = n.x - this.pointer.x;
        const dy = n.y - this.pointer.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < POINTER_RADIUS) {
          const strength = (1 - d / POINTER_RADIUS) ** 2 * 5200;
          fx += (dx / d) * strength;
          fy += (dy / d) * strength;
        }
      }
      n.vx += fx * dt;
      n.vy += fy * dt;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
    }
    for (const p of this.packets) {
      p.t += p.speed * dt;
      if (p.t >= 1) {
        p.t = 0;
        this.hubPulse = 1;
        p.from = 1 + Math.floor(hash01(Math.floor(this.time * 1000) + p.from * 7) * (this.nodes.length - 1));
      }
    }
    this.hubPulse = damp(this.hubPulse, 0, 2.2, dt);
  }

  // ---- drawing ------------------------------------------------------------------------------------

  private paintBackground(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { mode, dark } = this.opts;
    ctx.fillStyle = dark ? THEMES.dark.bg : THEMES.light.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    if (dark && this.nebula.length) {
      const strength = mode === "app" ? 0.35 : 1;
      ctx.globalAlpha = strength;
      for (const g of this.nebula) {
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.width, this.height);
      }
      ctx.globalAlpha = 1;
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx || !this.width) return;
    this.paintBackground();
    this.drawStars();
    if (!this.nodes.length) return;
    if (this.opts.mode === "landing") this.drawConstellation();
    else if (this.opts.mode === "auth") this.drawAperture();
  }

  /** One frame with all motion frozen (reduced-motion users and pre-animation paint). */
  renderStatic(): void {
    if (!this.ctx || !this.width) return;
    const savedTime = this.time;
    this.time = 12.5;
    this.warpT = 0;
    this.paintBackground();
    this.drawStars(true);
    if (this.nodes.length && (this.opts.mode === "landing" || this.opts.mode === "auth")) {
      this.placeNodes(true);
      if (this.opts.mode === "landing") this.drawConstellation(true);
      else this.drawAperture(true);
    }
    this.time = savedTime;
  }

  private starColor(tint: Star["tint"], a: number): string {
    if (!this.opts.dark) return rgba(30, 41, 59, a * 0.32);
    if (tint === 1) return rgba(92, 200, 255, a);
    if (tint === 2) return rgba(255, 214, 170, a);
    return rgba(226, 234, 250, a);
  }

  private drawStars(frozen = false): void {
    const ctx = this.ctx!;
    const w = this.width;
    const h = this.height;
    const warp = this.warpT;
    const modeAlpha = STAR_ALPHA[this.opts.mode];
    const px = this.parallax.x * 14;
    const py = this.parallax.y * 10;
    const scroll = this.scrollY;
    for (const s of this.stars) {
      const twinkle = frozen ? 1 : 0.72 + 0.28 * Math.sin(this.time * s.speed + s.phase);
      const a = clamp((0.3 + 0.7 * s.z) * twinkle * modeAlpha * (1 + warp * 0.8), 0, 1);
      const x = s.x * w + px * s.z;
      let y = s.y * h + py * s.z - scroll * s.z * 0.12;
      y = ((y % (h + 40)) + h + 40) % (h + 40) - 20;
      ctx.fillStyle = this.starColor(s.tint, a);
      if (warp > 0.02) {
        const dx = x - w / 2;
        const dy = y - h / 2;
        const d = Math.hypot(dx, dy) || 1;
        const len = warp * warp * (30 + 140 * s.z) * (0.3 + d / Math.max(w, h));
        ctx.strokeStyle = this.starColor(s.tint, a);
        ctx.lineWidth = s.r * 1.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x - (dx / d) * len, y - (dy / d) * len);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * Auth aperture: a lit halo, three orbit guides, the particles riding them and the links between
   * near neighbours. The pointer bends the rings (see `updateConstellation`) and a press sends a
   * ring outwards from the cursor.
   */
  private drawAperture(frozen = false): void {
    const ctx = this.ctx!;
    const fade = 1 - this.warpT;
    if (fade <= 0.02) return;
    const f = this.focusRect();
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const rx = f.w / 2;
    const ry = f.h / 2;

    // Halo behind the card so the form reads against the starfield.
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(f.w, f.h) * 1.15);
    glow.addColorStop(0, rgba(92, 200, 255, 0.1 * fade));
    glow.addColorStop(0.5, rgba(92, 200, 255, 0.035 * fade));
    glow.addColorStop(1, rgba(92, 200, 255, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.lineWidth = 1;
    ORBIT_SCALE.forEach((s, i) => {
      ctx.strokeStyle = rgba(148, 163, 196, (0.17 - i * 0.045) * fade);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * s, ry * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    });

    // A lit arc sweeping the outer guide, like a slow radar return.
    const outer = ORBIT_SCALE[ORBIT_SCALE.length - 1];
    const sweep = frozen ? -Math.PI / 2 : this.time * 0.34;
    ctx.strokeStyle = rgba(92, 200, 255, 0.5 * fade);
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * outer, ry * outer, 0, sweep, sweep + 0.6);
    ctx.stroke();

    // Links between neighbours: the field looks like a mesh being deformed, not loose dots.
    const linkDist = Math.min(f.w, f.h) * 0.42;
    ctx.lineWidth = 1;
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > linkDist) continue;
        const alpha = (1 - d / linkDist) ** 1.6 * 0.3 * fade;
        if (alpha < 0.015) continue;
        ctx.strokeStyle = rgba(148, 163, 196, alpha);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    for (const n of this.nodes) {
      // Particles knocked off their slot glow hotter, so the disturbance is legible.
      const speed = Math.min(1, Math.hypot(n.vx, n.vy) / 320);
      ctx.fillStyle = rgba(92, 200, 255, (0.06 + speed * 0.1) * fade);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * (3.4 + speed * 2.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(lerp(226, 190, speed), lerp(234, 236, speed), lerp(250, 255, speed), (0.62 + n.ring * 0.06 + speed * 0.3) * fade);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.shockwave > 0.02 && !frozen) {
      const t = 1 - this.shockwave;
      ctx.strokeStyle = rgba(92, 200, 255, this.shockwave * 0.4 * fade);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(this.pointer.x, this.pointer.y, 20 + t * 260, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawConstellation(frozen = false): void {
    const ctx = this.ctx!;
    const fade = 1 - this.warpT;
    if (fade <= 0.02) return;
    const nodes = this.nodes;
    const hub = nodes[0];
    const f = this.focusRect();
    const linkDist = Math.min(f.w, f.h) * 0.4;

    ctx.lineWidth = 1;
    // Links: hub ↔ inner ring always; everything else by proximity.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const forced = i === 0 && b.ring === 1;
        if (!forced && d > linkDist) continue;
        const alpha = (forced ? 0.32 : (1 - d / linkDist) * 0.28) * fade;
        if (alpha < 0.015) continue;
        ctx.strokeStyle = rgba(148, 163, 196, alpha);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Packets streaming into the hub.
    for (const p of this.packets) {
      const from = nodes[p.from];
      if (!from) continue;
      const t = frozen ? 0.55 : easeInOutCubic(p.t);
      const x = lerp(from.x, hub.x, t);
      const y = lerp(from.y, hub.y, t);
      const tt = Math.max(0, t - 0.1);
      const tx = lerp(from.x, hub.x, tt);
      const ty = lerp(from.y, hub.y, tt);
      const trail = ctx.createLinearGradient(tx, ty, x, y);
      trail.addColorStop(0, rgba(92, 200, 255, 0));
      trail.addColorStop(1, rgba(92, 200, 255, 0.75 * fade));
      ctx.strokeStyle = trail;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = rgba(92, 200, 255, 0.16 * fade);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(190, 236, 255, 0.95 * fade);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Nodes.
    for (const n of nodes) {
      if (n.ring === 0) continue;
      ctx.fillStyle = rgba(232, 237, 247, 0.08 * fade);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(232, 237, 247, (n.ring === 1 ? 0.92 : 0.7) * fade);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hub with pulse ring.
    const pulse = frozen ? 0 : this.hubPulse;
    ctx.fillStyle = rgba(92, 200, 255, 0.14 * fade);
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, 16 + pulse * 4, 0, Math.PI * 2);
    ctx.fill();
    if (pulse > 0.02) {
      ctx.strokeStyle = rgba(92, 200, 255, pulse * 0.55 * fade);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 12 + (1 - pulse) * 30, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(92, 200, 255, 0.95 * fade);
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, hub.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(255, 255, 255, 0.9 * fade);
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}
