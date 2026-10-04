// The buddy drawn as a single figure at any position and size — used by the
// launch greeting and the drop animation, which choreograph it themselves
// rather than going through the engine. Same look as the engine draws: the
// jelly body (jelly.ts), the personality's accessory, blush, lashes and eyes.

import { drawAccessory, drawLashes, type Look } from "./looks";
import { BODY, drawJelly, drawRoundEye, puddlePath } from "./jelly";

export type FigureEye = "round" | "wide" | "happy" | "content" | "star";

export interface Figure {
  x: number;
  y: number;
  /** Size, as in jelly.ts. */
  R: number;
  look: Look;
  /** Seconds — drives the jelly's bubbles and wavy edge. */
  time: number;
  sx?: number;
  sy?: number;
  tilt?: number;
  eye?: FigureEye;
  /** 0…1, for blinks. */
  open?: number;
  /** −1…1, where the eyes look. */
  lookX?: number;
  lookY?: number;
  /** Shadow under it, 0 = none. */
  shadow?: number;
  /** Drawn inside the jelly (clipped to it), under the eyes — e.g. a file being absorbed. */
  inside?: (x: CanvasRenderingContext2D, R: number) => void;
}

const INK = "#16171A";

export function drawFigure(x: CanvasRenderingContext2D, f: Figure) {
  const R = f.R;
  if (R < 1) return;
  const sx = f.sx ?? 1;
  const sy = f.sy ?? 1;
  const look = f.look;

  if (f.shadow) {
    x.fillStyle = `rgba(0,0,0,${0.3 * f.shadow})`;
    x.beginPath();
    x.ellipse(f.x, f.y + R * BODY.base * sy + 3, R * sx, R * 0.12, 0, 0, Math.PI * 2);
    x.fill();
  }

  x.save();
  x.translate(f.x, f.y);
  if (f.tilt) x.rotate(f.tilt);
  x.scale(sx, sy);

  const lookX = f.lookX ?? 0;
  const lookY = f.lookY ?? 0;
  const accShift = lookX * R * 0.3;
  const accRy = R * BODY.top * 1.1;
  drawAccessory(x, look, R, accRy, "back", accShift, Math.min(1, sy));

  const body = puddlePath(R, f.time);
  drawJelly(x, body, R, look, { time: f.time });

  x.save();
  x.clip(body);
  f.inside?.(x, R);

  if (look.blush > 0) {
    x.fillStyle = `rgba(255,120,150,${0.5 * look.blush})`;
    for (const sd of [-1, 1]) {
      x.beginPath();
      x.ellipse(sd * R * 0.66 + lookX * R * 0.1, R * 0.12, R * 0.15, R * 0.09, 0, 0, Math.PI * 2);
      x.fill();
    }
  }

  const eye = f.eye ?? "round";
  const open = f.open ?? 1;
  const w = R * (eye === "wide" ? 0.36 : 0.3);
  const ex = R * 0.4;
  const ey = -R * 0.1;
  x.strokeStyle = INK;
  x.lineCap = "round";
  x.lineWidth = w * 0.4;
  for (const sd of [-1, 1]) {
    x.save();
    x.translate(sd * ex + lookX * R * 0.14, ey + lookY * R * 0.1);
    switch (eye) {
      case "happy":
        x.beginPath();
        x.arc(0, w * 0.35, w * 0.6, Math.PI * 1.15, Math.PI * 1.85);
        x.stroke();
        break;
      case "content":
        x.beginPath();
        x.arc(0, -w * 0.25, w * 0.6, Math.PI * 0.15, Math.PI * 0.85);
        x.stroke();
        break;
      case "star":
        drawStar(x, w * 0.75, f.time);
        break;
      default:
        drawRoundEye(x, w, open, INK);
        if (look.lashes && open > 0.5) drawLashes(x, sd, w, -w * 0.54, INK);
    }
    x.restore();
  }
  x.restore();

  drawAccessory(x, look, R, accRy, "front", accShift, Math.min(1, sy));
  x.restore();
}

/** A slowly turning gold star, for "ooh, a picture" eyes. */
function drawStar(x: CanvasRenderingContext2D, size: number, t: number) {
  x.save();
  x.rotate(t * 1.5);
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? size * 0.42 : size;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
  x.fillStyle = "#F7B32B";
  x.fill();
  x.restore();
}
