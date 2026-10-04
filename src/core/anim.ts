// Motion helpers for the island's shape: a spring for things that follow a
// target (the character's spot), and `Tracked` for the island's width, height
// and corners — it grows with a soft jelly bounce and shrinks on a smooth
// glide with no overshoot, so closing never looks like it hesitates.

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A CSS-style cubic-bezier easing, (0,0) → (x1,y1) (x2,y2) → (1,1). Solves
 * for the curve's time at `x` by bisection — plenty for a handful of calls per
 * frame, and it can't fail to converge.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (p1: number, p2: number, t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
  };
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2;
      if (at(x1, x2, t) < x) lo = t;
      else hi = t;
    }
    return at(y1, y2, t);
  };
}

/**
 * Follows `target` like a soft spring. `stiffness` sets how fast, `bounce`
 * (0 = none, 1 = endless) how much it overshoots.
 */
export class Spring {
  value: number;
  target: number;
  velocity = 0;

  constructor(value: number, private stiffness = 160, private bounce = 0.25) {
    this.value = value;
    this.target = value;
  }

  get settled(): boolean {
    return Math.abs(this.target - this.value) < 0.01 && Math.abs(this.velocity) < 0.05;
  }

  step(dt: number) {
    const damping = 2 * Math.sqrt(this.stiffness) * (1 - this.bounce);
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.velocity += (this.stiffness * (this.target - this.value) - damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
  }
}

/** The glide used when the island shrinks: quick to start, gentle to land. */
const glide = cubicBezier(0.4, 0, 0.2, 1);
const GLIDE_MS = 320;

/** A size of the island: springs open, glides shut. */
export class Tracked {
  private spring: Spring;
  private glideFrom = 0;
  private glideTo = 0;
  private glideStart = 0;
  private moving: "spring" | "glide" | null = null;

  constructor(value: number) {
    this.spring = new Spring(value, 150, 0.28);
  }

  get value(): number {
    return this.spring.value;
  }

  get animating(): boolean {
    return this.moving !== null;
  }

  /** Grow (or move) to `v` with a soft bounce. */
  springTo(v: number) {
    this.spring.target = v;
    this.moving = "spring";
  }

  /** Shrink to `v` on a smooth glide, no overshoot. */
  curveTowards(v: number, now = performance.now()) {
    this.glideFrom = this.spring.value;
    this.glideTo = v;
    this.glideStart = now;
    this.spring.target = v;
    this.spring.velocity = 0;
    this.moving = "glide";
  }

  step(dt: number, now = performance.now()) {
    if (this.moving === "spring") {
      this.spring.step(dt);
      if (this.spring.settled) {
        this.spring.value = this.spring.target;
        this.spring.velocity = 0;
        this.moving = null;
      }
    } else if (this.moving === "glide") {
      const p = clamp((now - this.glideStart) / GLIDE_MS, 0, 1);
      this.spring.value = lerp(this.glideFrom, this.glideTo, glide(p));
      if (p >= 1) this.moving = null;
    }
  }
}
