// Little effects around the jelly: floating hearts, twinkles, notes, sleepy
// Zs, sweat drops and bursting bubbles, plus the mood badge on its shoulder.
// Everything is drawn as shapes — no text glyphs — so it looks the same on
// every machine. Positions are in body units (multiples of R, the jelly's size)
// relative to its centre.

export type FxKind = "heart" | "star" | "spark" | "sweat" | "z" | "note" | "pop";

export type RGB = readonly [number, number, number]; // components 0…1

export interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Upward pull (negative = falls). */
  lift: number;
  /** Seconds; negative while waiting to appear (staggered bursts). */
  age: number;
  life: number;
  spin: number;
  size: number;
  /** Per-particle seed for wobble and variant. */
  seed: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** A burst of `count` effects of one kind, starting where that kind belongs. */
export function spawn(kind: FxKind, count: number): Fx[] {
  const out: Fx[] = [];
  for (let i = 0; i < count; i++) {
    const seed = Math.random();
    switch (kind) {
      case "pop": {
        // Bubbles squeezed out of the sides.
        const side = i % 2 ? 1 : -1;
        out.push({
          kind, seed, x: side * rand(0.6, 0.95), y: rand(-0.4, -0.1),
          vx: side * rand(0.4, 0.8), vy: rand(-0.6, -0.25), lift: -0.6,
          age: -i * 0.05, life: rand(0.65, 0.95), spin: 0, size: rand(0.09, 0.15),
        });
        break;
      }
      case "z":
        out.push({
          kind, seed, x: rand(0.45, 0.7), y: rand(-0.85, -0.7),
          vx: rand(0.12, 0.28), vy: rand(-0.4, -0.3), lift: 0.05,
          age: -i * 0.4, life: rand(1.6, 2.1), spin: rand(-0.3, 0.1), size: rand(0.13, 0.18),
        });
        break;
      case "sweat":
        out.push({
          kind, seed, x: rand(0.55, 0.75), y: rand(-0.55, -0.4),
          vx: rand(0.05, 0.15), vy: rand(-0.1, 0.05), lift: -1.4,
          age: -i * 0.2, life: rand(0.9, 1.2), spin: 0, size: rand(0.11, 0.14),
        });
        break;
      default:
        // Hearts, stars, twinkles and notes float up out of the top.
        out.push({
          kind, seed, x: rand(-0.55, 0.55), y: rand(-0.95, -0.7),
          vx: rand(-0.25, 0.25), vy: rand(-0.75, -0.45), lift: 0.15,
          age: -i * 0.12, life: rand(1.2, 1.7), spin: rand(0, Math.PI * 2), size: rand(0.13, 0.2),
        });
    }
  }
  return out;
}

/** Moves the effects on and drops the ones that are done. */
export function stepFx(list: Fx[], dt: number): Fx[] {
  for (const p of list) {
    p.age += dt;
    if (p.age <= 0) continue;
    p.vy -= p.lift * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  return list.filter((p) => p.age < p.life);
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/** A heart from two round lobes and a soft point. */
export function heartShape(x: CanvasRenderingContext2D, s: number) {
  x.beginPath();
  x.moveTo(0, s * 0.62);
  x.bezierCurveTo(-s * 0.35, s * 0.36, -s * 0.95, s * 0.02, -s * 0.95, -s * 0.3);
  x.arc(-s * 0.47, -s * 0.3, s * 0.48, Math.PI, 0);
  x.arc(s * 0.47, -s * 0.3, s * 0.48, Math.PI, 0);
  x.bezierCurveTo(s * 0.95, s * 0.02, s * 0.35, s * 0.36, 0, s * 0.62);
  x.closePath();
}

/** A four-pointed twinkle with curved sides. */
export function twinkleShape(x: CanvasRenderingContext2D, s: number, waist = 0.2) {
  x.beginPath();
  x.moveTo(0, -s);
  x.quadraticCurveTo(s * waist, -s * waist, s, 0);
  x.quadraticCurveTo(s * waist, s * waist, 0, s);
  x.quadraticCurveTo(-s * waist, s * waist, -s, 0);
  x.quadraticCurveTo(-s * waist, -s * waist, 0, -s);
  x.closePath();
}

function noteShape(x: CanvasRenderingContext2D, s: number, double: boolean) {
  const head = (cx: number, cy: number) => {
    x.beginPath();
    x.ellipse(cx, cy, s * 0.32, s * 0.24, -0.4, 0, Math.PI * 2);
    x.fill();
  };
  x.lineWidth = s * 0.14;
  x.lineCap = "round";
  if (double) {
    head(-s * 0.35, s * 0.55);
    head(s * 0.45, s * 0.4);
    x.beginPath();
    x.moveTo(-s * 0.08, s * 0.5);
    x.lineTo(-s * 0.08, -s * 0.55);
    x.lineTo(s * 0.72, -s * 0.7);
    x.lineTo(s * 0.72, s * 0.35);
    x.stroke();
  } else {
    head(0, s * 0.55);
    x.beginPath();
    x.moveTo(s * 0.28, s * 0.5);
    x.lineTo(s * 0.28, -s * 0.7);
    x.quadraticCurveTo(s * 0.7, -s * 0.45, s * 0.6, -s * 0.05);
    x.stroke();
  }
}

function zShape(x: CanvasRenderingContext2D, s: number) {
  x.lineWidth = s * 0.22;
  x.lineCap = "round";
  x.lineJoin = "round";
  x.beginPath();
  x.moveTo(-s * 0.45, -s * 0.45);
  x.lineTo(s * 0.45, -s * 0.45);
  x.lineTo(-s * 0.45, s * 0.45);
  x.lineTo(s * 0.45, s * 0.45);
  x.stroke();
}

function dropShape(x: CanvasRenderingContext2D, s: number) {
  x.beginPath();
  x.moveTo(0, -s);
  x.bezierCurveTo(s * 0.25, -s * 0.45, s * 0.7, -s * 0.05, s * 0.7, s * 0.3);
  x.arc(0, s * 0.3, s * 0.7, 0, Math.PI);
  x.bezierCurveTo(-s * 0.7, -s * 0.05, -s * 0.25, -s * 0.45, 0, -s);
  x.closePath();
}

/** Draws every live effect around a jelly centred at (cx, cy), size R. */
export function drawFx(x: CanvasRenderingContext2D, list: Fx[], R: number, cx: number, cy: number) {
  for (const p of list) {
    if (p.age <= 0) continue;
    const k = p.age / p.life;
    // Quick fade in, long fade out.
    const alpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
    const s = R * p.size * (1 + k * 0.3);
    const wobble = Math.sin(p.age * 5 + p.seed * 9);
    x.save();
    x.translate(cx + p.x * R, cy + p.y * R);
    x.globalAlpha = Math.max(0, Math.min(1, alpha));
    switch (p.kind) {
      case "heart":
        x.rotate(wobble * 0.25);
        x.fillStyle = "#FF5A7A";
        heartShape(x, s);
        x.fill();
        break;
      case "star":
        x.rotate(p.spin + p.age * 2.5);
        x.fillStyle = "#F8C14A";
        twinkleShape(x, s * 1.15, 0.28);
        x.fill();
        break;
      case "spark":
        x.rotate(p.spin);
        x.scale(1 + wobble * 0.2, 1 + wobble * 0.2);
        x.fillStyle = "#FFFFFF";
        twinkleShape(x, s * 0.8, 0.12);
        x.fill();
        break;
      case "sweat":
        x.fillStyle = "#8ACBFF";
        dropShape(x, s);
        x.fill();
        break;
      case "z":
        x.rotate(p.spin);
        x.strokeStyle = "rgb(214,224,240)";
        zShape(x, s * (0.8 + k * 0.5));
        break;
      case "note":
        x.rotate(wobble * 0.3);
        x.fillStyle = "#B49CFB";
        x.strokeStyle = "#B49CFB";
        noteShape(x, s * 1.1, p.seed > 0.5);
        break;
      case "pop": {
        // A bubble that swells, then bursts into a fading ring.
        const burst = k > 0.6;
        x.strokeStyle = `rgba(255,255,255,${burst ? 0.45 : 0.9})`;
        x.lineWidth = Math.max(0.8, s * (burst ? 0.1 : 0.2));
        x.beginPath();
        x.arc(0, 0, s * (burst ? 1.25 + (k - 0.6) * 2.2 : 0.7 + k * 0.6), 0, Math.PI * 2);
        x.stroke();
        if (!burst) {
          x.fillStyle = "rgba(255,255,255,0.85)";
          x.beginPath();
          x.arc(-s * 0.28, -s * 0.28, s * 0.2, 0, Math.PI * 2);
          x.fill();
        }
        break;
      }
    }
    x.restore();
  }
}

// ── The mood badge ───────────────────────────────────────────────────────────

export type BadgeKind = "dots" | "bang" | "question" | "dot";

export interface Badge {
  kind: BadgeKind;
  color: RGB;
}

export const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

function pill(x: CanvasRenderingContext2D, w: number, h: number) {
  const r = h / 2;
  x.beginPath();
  x.moveTo(-w / 2 + r, -r);
  x.lineTo(w / 2 - r, -r);
  x.arc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
  x.lineTo(-w / 2 + r, r);
  x.arc(-w / 2 + r, 0, r, Math.PI / 2, -Math.PI / 2);
  x.closePath();
}

/** A round bubble with a soft dark edge, so it reads on any jelly colour. */
function bubble(x: CanvasRenderingContext2D, r: number, color: RGB) {
  x.fillStyle = "rgba(10,12,16,0.85)";
  x.beginPath();
  x.arc(0, 0, r * 1.25, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = rgba(color);
  x.beginPath();
  x.arc(0, 0, r, 0, Math.PI * 2);
  x.fill();
}

/**
 * The badge on the jelly's shoulder: working dots, "!" (needs you), "?" (asks
 * you), or a plain dot (done, failed…). `scale` pops it in and out; `t` is
 * seconds, for the dots' bounce.
 */
export function drawBadge(
  x: CanvasRenderingContext2D, badge: Badge, R: number, bx: number, by: number,
  scale: number, t: number, mini: boolean,
) {
  x.save();
  x.translate(bx, by);
  x.scale(scale, scale);
  if (badge.kind === "dots") {
    if (mini) {
      // Too small for three dots: one that pulses.
      bubble(x, R * 0.17 * (1 + 0.2 * Math.sin(t * 9)), badge.color);
    } else {
      x.fillStyle = "rgba(10,12,16,0.85)";
      pill(x, R * 0.82, R * 0.42);
      x.fill();
      x.fillStyle = rgba(badge.color);
      pill(x, R * 0.7, R * 0.3);
      x.fill();
      for (let i = 0; i < 3; i++) {
        const hop = Math.max(0, Math.sin(t * 8 - i * 0.9));
        x.fillStyle = "#fff";
        x.beginPath();
        x.arc((i - 1) * R * 0.17, -hop * R * 0.05, R * 0.05, 0, Math.PI * 2);
        x.fill();
      }
    }
  } else if (badge.kind === "dot") {
    bubble(x, R * 0.13, badge.color);
  } else {
    bubble(x, R * 0.24, badge.color);
    if (!mini) {
      x.fillStyle = "#fff";
      x.strokeStyle = "#fff";
      x.lineCap = "round";
      if (badge.kind === "bang") {
        x.lineWidth = R * 0.075;
        x.beginPath();
        x.moveTo(0, -R * 0.12);
        x.lineTo(0, R * 0.02);
        x.stroke();
        x.beginPath();
        x.arc(0, R * 0.11, R * 0.04, 0, Math.PI * 2);
        x.fill();
      } else {
        x.lineWidth = R * 0.065;
        x.beginPath();
        x.arc(0, -R * 0.06, R * 0.075, Math.PI * 1.05, Math.PI * 0.45);
        x.lineTo(0, R * 0.04);
        x.stroke();
        x.beginPath();
        x.arc(0, R * 0.12, R * 0.035, 0, Math.PI * 2);
        x.fill();
      }
    }
  }
  x.restore();
}
