// Tute's launch greeting: "drip, splash, hello".
//
//   1. A drop of jelly falls from the top of the island, stretching as it goes.
//   2. It splashes on the card — droplets fly out, a ripple spreads.
//   3. The splash gathers into the puddle, which jiggles into shape.
//   4. The eyes pop open, blink twice.
//   5. Three bubbles rise from its head and pop, one per little hop: "hello".
//   6. A content smile, then it shrinks into the small bar.
//
// Laid out in a 640×150 space (the island's greeting size). The Greeting class
// keeps the interface the island drives: start, hover, interrupt, draw, done.

import { Sound } from "../core/sound";
import { BAR_JELLY, COMPACT_W } from "../core/layout";
import { activeLook, type Look } from "./looks";
import { BODY, puddlePath } from "./jelly";
import { drawFigure } from "./figure";

// ── Timing (seconds) ──────────────────────────────────────────────────────────

const T = {
  card: 0.3, // card fades in
  fall0: 0.12, // the drop starts falling
  land: 0.58, // ...and hits the card
  gather: 1.05, // the splash has become the puddle
  eyes: 1.12, // eyes pop open
  blinkA: 1.5,
  blinkB: 1.68,
  bubbles: [1.75, 2.15, 2.55] as const, // each bubble leaves the head
  bubbleRise: 0.42, // seconds a bubble rises before it pops
  content: 3.15, // content smile
  end: 3.75,
  autoLeave: 4.05,
  COLLAPSE: 0.34,
};

export const GREETING_END = T.end;

// ── Geometry (640×150) ────────────────────────────────────────────────────────

const C0 = { x: 320, y: 92 };
/** Jelly size at rest. */
const R0 = 34;
/** Where the drop lands: the jelly's base line. */
const FLOOR = C0.y + R0 * BODY.base;
/** Where the character ends up in the small bar (the same spot as layout's BAR_JELLY). */
const SMALL = { x: 320 - COMPACT_W / 2 + BAR_JELLY.x, y: BAR_JELLY.y, R: BAR_JELLY.size * 0.45 };

// ── Easing ────────────────────────────────────────────────────────────────────

const E = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /** A damped spring settling at 1 — the jiggle as the puddle forms. */
  jiggle: (t: number) => 1 - Math.cos(t * Math.PI * 3.2) * Math.exp(-t * 4.2),
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

// ── Pose ──────────────────────────────────────────────────────────────────────

interface Pose {
  x: number; y: number; R: number; sx: number; sy: number;
  /** 0 = closed/not yet open, 1 = open. */
  open: number;
  eye: "round" | "happy" | "content";
  lookX: number; lookY: number;
  card: number;
  minis: number;
  /** Fades the whole body in (it starts as the falling drop). */
  body: number;
}

/** The splash droplets: [angle, speed, size], fixed so it plays the same every time. */
const DROPLETS: [number, number, number][] = [
  [-2.6, 1.0, 3.2], [-2.2, 1.25, 2.6], [-1.85, 0.9, 3.6], [-1.3, 0.95, 3.4],
  [-0.95, 1.2, 2.6], [-0.55, 1.0, 3.0], [-2.95, 0.7, 2.2], [-0.2, 0.75, 2.2],
];

function greetPose(t: number): Pose {
  const formed = seg(t, T.land, T.gather);
  const j = E.jiggle(formed);
  // Squashed flat on landing, then springs up into shape.
  const sx = formed > 0 ? lerp(1.7, 1, Math.min(1, j)) + (1 - j) * 0.15 : 1;
  const sy = formed > 0 ? lerp(0.25, 1, j) : 1;
  const R = R0 * lerp(0.75, 1, E.out(formed));

  // Little hops, one per bubble.
  let hop = 0;
  for (const b of T.bubbles) {
    const k = seg(t, b - 0.12, b + 0.2);
    if (k > 0 && k < 1) hop = Math.max(hop, Math.sin(k * Math.PI));
  }

  const blink = (tb: number) => {
    const k = seg(t, tb, tb + 0.12);
    return k > 0 && k < 1 ? 1 - Math.sin(Math.PI * k) * 0.94 : 1;
  };
  const open = t < T.eyes ? 0.08 : Math.min(E.out(seg(t, T.eyes, T.eyes + 0.14)), blink(T.blinkA), blink(T.blinkB));

  let eye: Pose["eye"] = "round";
  if (hop > 0.3) eye = "happy";
  if (t >= T.content) eye = "content";

  // Looks up at each bubble as it rises, otherwise straight ahead.
  let lookY = 0;
  for (const b of T.bubbles) if (t >= b && t < b + T.bubbleRise) lookY = -0.6;

  return {
    x: C0.x,
    y: C0.y - hop * R0 * 0.28 + (formed > 0 ? (1 - sy) * R0 * BODY.base * 0.9 : 0),
    R, sx, sy, open, eye,
    lookX: 0, lookY,
    card: E.out(seg(t, 0, T.card)),
    minis: 0,
    body: formed > 0 ? 1 : 0,
  };
}

function pose(t: number, tc: number): Pose {
  if (t < tc) return greetPose(Math.min(t, T.end + 10));
  // Collapse: shrink into the small bar's spot, card fades, minis appear.
  const a = greetPose(tc);
  const e = E.inOut(seg(t, tc, tc + T.COLLAPSE));
  return {
    ...a,
    x: lerp(a.x, SMALL.x, e),
    y: lerp(a.y, SMALL.y, e),
    R: lerp(a.R, SMALL.R, e),
    sx: lerp(a.sx, 1, e),
    sy: lerp(a.sy, 1, e),
    eye: "round",
    open: 1,
    lookX: 0,
    lookY: a.lookY * (1 - e),
    card: a.card * (1 - seg(t, tc, tc + 0.18)),
    minis: seg(t, tc + 0.24, tc + 0.42),
    body: 1,
  };
}

// ── Drawing ───────────────────────────────────────────────────────────────────

/** The falling drop: a teardrop that stretches as it speeds up. */
function drawFallingDrop(x: CanvasRenderingContext2D, t: number, look: Look) {
  const k = seg(t, T.fall0, T.land);
  if (k <= 0 || k >= 1) return;
  const y = lerp(-12, FLOOR - 6, E.in(k));
  const r = 7;
  const stretch = 1 + E.in(k) * 0.9;
  x.save();
  x.translate(C0.x, y);
  x.scale(1 / Math.sqrt(stretch), stretch);
  x.beginPath();
  x.moveTo(0, -r * 1.7);
  x.bezierCurveTo(r * 0.5, -r * 0.8, r, -r * 0.2, r, r * 0.25);
  x.arc(0, r * 0.25, r, 0, Math.PI, false);
  x.bezierCurveTo(-r, -r * 0.2, -r * 0.5, -r * 0.8, 0, -r * 1.7);
  x.fillStyle = `rgba(${look.rgb},0.75)`;
  x.fill();
  x.strokeStyle = look.body;
  x.lineWidth = 1.5;
  x.stroke();
  x.restore();
}

/** Droplets thrown out by the splash, and the ripple spreading on the card. */
function drawSplash(x: CanvasRenderingContext2D, t: number, look: Look) {
  const dt = t - T.land;
  if (dt < 0 || dt > 0.9) return;
  // Ripple: a flat ring that widens and fades.
  const rk = seg(dt, 0, 0.7);
  if (rk < 1) {
    x.strokeStyle = `rgba(${look.rgb},${0.7 * (1 - rk)})`;
    x.lineWidth = 2;
    x.beginPath();
    x.ellipse(C0.x, FLOOR + 2, 20 + rk * 120, 4 + rk * 9, 0, 0, Math.PI * 2);
    x.stroke();
  }
  // Droplets: thrown up and out, falling back under gravity.
  for (const [a, sp, size] of DROPLETS) {
    const k = dt / 0.75;
    if (k >= 1) continue;
    const vx = Math.cos(a) * 150 * sp;
    const vy = Math.sin(a) * 190 * sp;
    const px = C0.x + vx * dt;
    const py = FLOOR - 4 + vy * dt + 420 * dt * dt;
    if (py > FLOOR + 6) continue;
    x.fillStyle = `rgba(${look.rgb},${0.9 * (1 - k)})`;
    x.beginPath();
    x.arc(px, py, size * (1 - k * 0.4), 0, Math.PI * 2);
    x.fill();
  }
}

/** The "hello" bubbles: rise from the head, then pop into a ring of sparks. */
function drawHelloBubbles(x: CanvasRenderingContext2D, t: number, look: Look, p: Pose) {
  T.bubbles.forEach((b, i) => {
    const dt = t - b;
    if (dt < 0 || dt > T.bubbleRise + 0.35) return;
    const side = (i - 1) * 16;
    const startY = p.y - R0 * BODY.top - 4;
    if (dt < T.bubbleRise) {
      const k = dt / T.bubbleRise;
      const r = 4 + k * 5;
      const bx = C0.x + side * E.out(k) + Math.sin(dt * 12) * 2;
      const by = startY - E.out(k) * 34;
      x.strokeStyle = "rgba(255,255,255,0.85)";
      x.lineWidth = 1.6;
      x.beginPath();
      x.arc(bx, by, r, 0, Math.PI * 2);
      x.stroke();
      x.fillStyle = `rgba(${look.rgb},0.25)`;
      x.fill();
      x.fillStyle = "rgba(255,255,255,0.9)";
      x.beginPath();
      x.arc(bx - r * 0.35, by - r * 0.35, r * 0.25, 0, Math.PI * 2);
      x.fill();
    } else {
      // Pop: six little sparks flying out from where it burst.
      const k = (dt - T.bubbleRise) / 0.35;
      const bx = C0.x + side;
      const by = startY - 34;
      x.strokeStyle = `rgba(255,255,255,${1 - k})`;
      x.lineWidth = 1.6;
      x.lineCap = "round";
      for (let s = 0; s < 6; s++) {
        const a = (s / 6) * Math.PI * 2 + i;
        const r0 = 5 + k * 6;
        const r1 = r0 + 4;
        x.beginPath();
        x.moveTo(bx + Math.cos(a) * r0, by + Math.sin(a) * r0);
        x.lineTo(bx + Math.cos(a) * r1, by + Math.sin(a) * r1);
        x.stroke();
      }
    }
  });
}

function drawBuddy(x: CanvasRenderingContext2D, p: Pose, t: number, look: Look) {
  if (p.body <= 0) return;
  drawFigure(x, {
    x: p.x, y: p.y, R: p.R, look, time: t,
    sx: p.sx, sy: p.sy,
    eye: p.eye, open: p.open,
    lookX: p.lookX, lookY: p.lookY,
    shadow: p.card,
  });
}

const MINI_COLORS = ["#E86A6A", "#3E86E0", "#EFAE5A", "#8C73F2"];

function drawMinis(x: CanvasRenderingContext2D, alpha: number) {
  if (alpha <= 0.01) return;
  const cx = 320 + COMPACT_W / 2 - 27;
  const cy = 16;
  const sp = 6;
  const offsets: [number, number][] = [[-sp, -sp], [sp, -sp], [-sp, sp], [sp, sp]];
  offsets.forEach(([dx, dy], i) => {
    x.save();
    x.translate(cx + dx, cy + dy);
    x.scale(alpha, alpha);
    x.fillStyle = MINI_COLORS[i];
    x.fill(puddlePath(4.7));
    x.restore();
  });
}

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * Runs the greeting on its own canvas. `onComplete` fires once at T.end (or
 * right after the collapse when interrupted) so the island's FSM can move on.
 */
export class Greeting {
  private startMs = 0;
  private tc = Number.POSITIVE_INFINITY;
  private fired = false;
  private timers: number[] = [];

  onComplete: (() => void) | null = null;

  start() {
    this.startMs = performance.now();
    this.tc = Number.POSITIVE_INFINITY;
    this.fired = false;
    this.cancelTimers();
    const at = (s: number, fn: () => void) => this.timers.push(window.setTimeout(fn, s * 1000));
    at(T.land, () => Sound.play("pop"));
    at(T.eyes, () => Sound.play("greet"));
    for (const b of T.bubbles) at(b + T.bubbleRise, () => Sound.play("blip"));
    at(T.end + 0.05, () => this.fire());
  }

  /** Mouse entered the island during the greeting — hold it open. */
  hover() {
    if (this.tc >= T.autoLeave) this.tc = Number.POSITIVE_INFINITY;
  }

  /** Mouse left — collapse from now. */
  interrupt() {
    const t = (performance.now() - this.startMs) / 1000;
    if (!Number.isFinite(this.tc) || this.tc > t) this.tc = t;
    this.cancelTimers();
  }

  get elapsed(): number {
    return (performance.now() - this.startMs) / 1000;
  }

  get done(): boolean {
    return this.fired;
  }

  private fire() {
    if (this.fired) return;
    this.fired = true;
    this.cancelTimers();
    this.onComplete?.();
  }

  private cancelTimers() {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
  }

  draw(x: CanvasRenderingContext2D) {
    const t = this.elapsed;
    if (!this.fired && t >= T.end && this.tc >= T.autoLeave) this.fire();

    const p = pose(t, this.tc);
    const look = activeLook();
    x.clearRect(0, 0, 640, 150);

    // No card: the greeting plays straight on the jelly window behind it.

    // The drop, the splash and the hello bubbles only belong to the greeting
    // itself, not to the collapse into the bar.
    if (!Number.isFinite(this.tc) || t < this.tc) {
      drawFallingDrop(x, t, look);
      drawSplash(x, t, look);
    }
    drawMinis(x, p.minis);
    drawBuddy(x, p, t, look);
    if (!Number.isFinite(this.tc) || t < this.tc) drawHelloBubbles(x, t, look, p);
  }
}
