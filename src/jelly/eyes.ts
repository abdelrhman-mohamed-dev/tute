// The jelly's eyes, one shape per expression. Each is drawn centred on (0, 0)
// at width `w`; `side` is -1 for the left eye and 1 for the right, so lopsided
// shapes (a wink, `> <`) mirror properly.

import { drawRoundEye } from "./jelly";
import { heartShape, twinkleShape } from "./fx";

export type EyeShape =
  | "pill" | "wide" | "dot" | "line" | "flat" | "happy" | "closed"
  | "spiral" | "heart" | "star" | "tired" | "wink"
  /** `> <` — squeezed shut, the splat after three pokes. */
  | "squeeze";

function bar(x: CanvasRenderingContext2D, w: number, h: number) {
  const r = h / 2;
  x.beginPath();
  x.moveTo(-w / 2 + r, -r);
  x.lineTo(w / 2 - r, -r);
  x.arc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
  x.lineTo(-w / 2 + r, r);
  x.arc(-w / 2 + r, 0, r, Math.PI / 2, -Math.PI / 2);
  x.closePath();
  x.fill();
}

/** A soft arc: up for a smile (`^`), down for closed lids (`‿`). */
function arc(x: CanvasRenderingContext2D, w: number, up: boolean, weight: number) {
  x.lineWidth = w * weight;
  x.lineCap = "round";
  x.beginPath();
  if (up) x.arc(0, w * 0.32, w * 0.62, Math.PI * 1.18, Math.PI * 1.82);
  else x.arc(0, -w * 0.3, w * 0.6, Math.PI * 0.2, Math.PI * 0.8);
  x.stroke();
}

/**
 * Draws one eye. `lid` is 1 open … 0 shut (blinks); `t` is seconds, for the
 * shapes that spin (spiral, star).
 */
export function drawEye(
  x: CanvasRenderingContext2D, shape: EyeShape, w: number, side: number,
  lid: number, ink: string, t: number,
) {
  x.fillStyle = ink;
  x.strokeStyle = ink;
  switch (shape) {
    case "pill":
      drawRoundEye(x, w, lid, ink);
      break;
    case "wide":
      drawRoundEye(x, w * 1.18, lid, ink);
      break;
    case "dot":
      x.beginPath();
      x.arc(0, 0, w * 0.26, 0, Math.PI * 2);
      x.fill();
      break;
    case "line":
      // Cross: both bars dip towards the middle.
      x.rotate(side * -0.3);
      bar(x, w * 1.1, w * 0.3);
      break;
    case "flat":
      x.translate(0, w * 0.1);
      bar(x, w * 1.05, w * 0.28);
      break;
    case "happy":
      arc(x, w, true, 0.3);
      break;
    case "closed":
      arc(x, w, false, 0.24);
      break;
    case "tired": {
      // A round eye with a heavy lid over its top half.
      x.save();
      x.beginPath();
      x.rect(-w, -w * 0.02, w * 2, w);
      x.clip();
      drawRoundEye(x, w, 1, ink);
      x.restore();
      x.lineWidth = w * 0.16;
      x.lineCap = "round";
      x.beginPath();
      x.moveTo(-w * 0.58, -w * 0.02);
      x.lineTo(w * 0.58, -w * 0.02);
      x.stroke();
      break;
    }
    case "wink":
      if (side < 0) drawRoundEye(x, w, lid, ink);
      else arc(x, w, true, 0.3);
      break;
    case "spiral": {
      x.lineWidth = w * 0.16;
      x.lineCap = "round";
      x.beginPath();
      const turns = 2.2;
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * turns * Math.PI * 2;
        const r = (i / 60) * w * 0.52;
        const aa = a + t * 8 * side;
        if (i === 0) x.moveTo(Math.cos(aa) * r, Math.sin(aa) * r);
        else x.lineTo(Math.cos(aa) * r, Math.sin(aa) * r);
      }
      x.stroke();
      break;
    }
    case "heart":
      x.fillStyle = "#FF5A7A";
      heartShape(x, w * 0.62);
      x.fill();
      break;
    case "star":
      x.fillStyle = "#F8C14A";
      x.rotate(t * 1.6 * side);
      twinkleShape(x, w * 0.66, 0.3);
      x.fill();
      break;
    case "squeeze": {
      // `>` on the left, `<` on the right: the points face each other.
      x.lineWidth = w * 0.24;
      x.lineCap = "round";
      x.lineJoin = "round";
      const tip = side * -w * 0.28;
      x.beginPath();
      x.moveTo(-tip, -w * 0.3);
      x.lineTo(tip, 0);
      x.lineTo(-tip, w * 0.3);
      x.stroke();
      break;
    }
  }
}
