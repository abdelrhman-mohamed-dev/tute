// Tute and Tutee's body: a slime dome — clear, tinted, with a rim, a shine,
// bubbles drifting up inside, big shiny eyes and three gooey drips hanging off
// its base. Shared by everything that draws the character (the engine, the
// launch greeting, the drop sequence), so they always look the same.
//
// Units: everything is in multiples of `R`, the character's size. The body is
// centred on (0, 0): it spans ±BODY.halfW·R across, rises BODY.top·R above the
// centre and sits BODY.base·R below it, plus the drips under the base.

import type { Look } from "./looks";

export const BODY = {
  halfW: 1.0,
  top: 0.78,
  base: 0.4,
  /** How far the base spreads out past the dome, like slime settling. */
  feet: 0.04,
};

/** [x across (−1…1), length, width] of each drip, length and width in R. */
const DRIPS: [number, number, number][] = [
  [-0.5, 0.2, 0.09], [0.25, 0.13, 0.08], [0.7, 0.09, 0.07],
];

const sgnPow = (v: number, e: number) => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));

/**
 * The outline point in direction (ca, sa) — cos/sin of the angle, 0 pointing
 * right, π/2 pointing down. A rounded dome on top, a flat base below with the
 * drips. `wave` (seconds) makes the drips stretch; 0 keeps them still.
 */
export function puddlePoint(ca: number, sa: number, R: number, wave = 0): { x: number; y: number } {
  if (sa < 0) return { x: R * BODY.halfW * sgnPow(ca, 0.85), y: -R * BODY.top * Math.pow(-sa, 0.85) };
  const x = R * (BODY.halfW + BODY.feet) * sgnPow(ca, 0.35);
  const u = x / (R * BODY.halfW);
  let drip = 0;
  DRIPS.forEach(([dx, len, w], i) => {
    const stretch = 1 + 0.12 * Math.sin(wave * 2.2 + i * 1.7);
    drip += len * stretch * Math.exp(-Math.pow((u - dx) / w, 2));
  });
  return { x, y: R * BODY.base * Math.pow(sa, 0.18) + R * drip * Math.pow(sa, 3) };
}

/** The whole outline as a path (120 steps, enough for the drips at any size). */
export function puddlePath(R: number, wave = 0): Path2D {
  const p = new Path2D();
  const n = 120;
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const pt = puddlePoint(Math.cos(a), Math.sin(a), R, wave);
    if (k === 0) p.moveTo(pt.x, pt.y);
    else p.lineTo(pt.x, pt.y);
  }
  p.closePath();
  return p;
}

/** [x across (−1…1), radius, rise speed, phase] — fixed so it never looks random-noisy. */
const BUBBLES: [number, number, number, number][] = [
  [-0.55, 0.08, 0.5, 0], [0.55, 0.06, 0.65, 0.6], [0.05, 0.05, 0.55, 0.3],
  [-0.2, 0.045, 0.7, 0.9], [0.32, 0.07, 0.45, 1.1],
];

export interface JellyOptions {
  /** Seconds, drives the bubbles; pass a constant to freeze them. */
  time: number;
  /** State colour washed over the jelly (working blue, error red…), 0…1. */
  tint?: { rgb: readonly [number, number, number]; amount: number };
}

/**
 * Fills `body` as clear jelly: tinted fill, bubbles inside, a shine, and the
 * rim. Call inside the body's transform.
 */
export function drawJelly(x: CanvasRenderingContext2D, body: Path2D, R: number, look: Look, o: JellyOptions) {
  x.fillStyle = `rgba(${look.rgb},0.6)`;
  x.fill(body);

  if (o.tint && o.tint.amount > 0.01) {
    const [r, g, b] = o.tint.rgb.map((v) => Math.round(v * 255));
    const tg = x.createLinearGradient(0, R * BODY.base, 0, -R * BODY.top);
    tg.addColorStop(0, `rgba(${r},${g},${b},${0.6 * o.tint.amount})`);
    tg.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = tg;
    x.fill(body);
  }

  {
    x.save();
    x.clip(body);
    x.strokeStyle = "rgba(255,255,255,0.6)";
    x.lineWidth = Math.max(0.6, R * 0.03);
    const span = R * (BODY.base + BODY.top);
    for (const [bx, br, sp, ph] of BUBBLES) {
      const y = R * BODY.base * 0.9 - (((o.time * sp + ph) % 1.3) / 1.3) * span;
      x.beginPath();
      x.arc(bx * R * BODY.halfW * 0.8, y, br * R, 0, Math.PI * 2);
      x.stroke();
    }
    x.fillStyle = "rgba(255,255,255,0.75)";
    x.beginPath();
    x.ellipse(-R * 0.55, -R * 0.2, R * 0.14, R * 0.08, -0.6, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }

  x.strokeStyle = look.body;
  x.lineWidth = Math.max(0.8, R * 0.07);
  x.stroke(body);
}

/**
 * One big round eye with a shine, centred on (0, 0); `open` 0…1 for blinks.
 * `w` is the eye's width.
 */
export function drawRoundEye(x: CanvasRenderingContext2D, w: number, open: number, ink: string) {
  const r = w / 2;
  const ry = Math.max(r * 1.08 * open, r * 0.2);
  x.fillStyle = ink;
  x.beginPath();
  x.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2);
  x.fill();
  if (open > 0.6) {
    x.fillStyle = "#fff";
    x.beginPath();
    x.arc(-r * 0.35, -ry * 0.38, r * 0.36, 0, Math.PI * 2);
    x.fill();
  }
}
