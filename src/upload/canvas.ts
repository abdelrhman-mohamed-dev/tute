// The drop animation, "absorb", drawn over the island's jelly window:
//
//   hover   "Drop it on me!" — the jelly leans towards the file you're dragging,
//           ripples pulse around it, the file follows your cursor
//   drop    the file glides into the jelly and sinks in with a splash ring
//   absorb  it floats inside the clear jelly, shrinking and fading, bubbles
//           rising off it, while ten little bubbles fill up as the progress
//   done    it dissolves in a sparkle; the jelly reacts to what it absorbed
//           (star eyes for an image, a thinking look for code, a struggle
//           for a huge file)
//   choose  "<name> is in!" with Save to Obsidian (once a vault is chosen) / Keep it / Cancel
//
// The canvas covers the island's 640×176 body. Timings are in sequence.ts.

import { State } from "../core/state";
import { clamp, lerp } from "../core/anim";
import { activeLook, type Look } from "../jelly/looks";
import { BODY } from "../jelly/jelly";
import { drawFigure, type FigureEye } from "../jelly/figure";
import { CARD_DELAY, FILL, SINK, type DropFrame } from "./sequence";

const W = 640;
const H = 176;
const FONT = 'system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif';

/** The jelly's spot and size while it takes the file. */
const JX = 150;
const JY = 112;
const JR = 32;
/** Text column, the bubble meter and the choose buttons. */
const TX = 236;
const METER = { x: 242, y: 136, n: 10, gap: 22, r: 7 };
/** The choose card's buttons: their row, height and the gap between them. */
const BTN = { y: 120, h: 28, gap: 8 };

const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const eOut = (t: number) => 1 - Math.pow(1 - t, 3);
const eInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface UploadCanvasActions {
  /** "Save to Obsidian": into the vault (offered once one is chosen). */
  obsidian(): void;
  /** "Keep it": stays in Tute's inbox. */
  keep(): void;
  cancel(): void;
}

/** One button on the choose card; the first is the solid one. */
interface Choice {
  label: string;
  w: number;
  run(): void;
}

function text(
  x: CanvasRenderingContext2D, s: string, px: number, py: number,
  font: string, color: string, align: CanvasTextAlign = "left",
) {
  x.font = font;
  x.fillStyle = color;
  x.textAlign = align;
  x.textBaseline = "middle";
  x.fillText(s, px, py);
}

/** Shortens a file name to fit, keeping its extension. */
function shortName(name: string, max = 26): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${name.slice(0, max - ext.length - 1)}…${ext}`;
}

/** A small document icon, centred on (0, 0). */
function drawDoc(x: CanvasRenderingContext2D, scale: number, alpha: number) {
  const w = 26 * scale;
  const h = 32 * scale;
  const fold = 8 * scale;
  x.save();
  x.globalAlpha *= alpha;
  x.beginPath();
  x.moveTo(-w / 2, -h / 2);
  x.lineTo(w / 2 - fold, -h / 2);
  x.lineTo(w / 2, -h / 2 + fold);
  x.lineTo(w / 2, h / 2);
  x.lineTo(-w / 2, h / 2);
  x.closePath();
  x.fillStyle = "#F7F8FB";
  x.fill();
  x.fillStyle = "#D9DEE8";
  x.beginPath();
  x.moveTo(w / 2 - fold, -h / 2);
  x.lineTo(w / 2 - fold, -h / 2 + fold);
  x.lineTo(w / 2, -h / 2 + fold);
  x.closePath();
  x.fill();
  x.fillStyle = "#AAB4C6";
  for (let i = 0; i < 3; i++) x.fillRect(-w * 0.3, -h * 0.12 + i * h * 0.2, w * (i === 2 ? 0.4 : 0.6), Math.max(1, 2 * scale));
  x.restore();
}

export class UploadCanvas {
  /** Wrapper holding the canvas and the invisible buttons over the ones it paints. */
  readonly el: HTMLElement;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private overlay: HTMLElement;
  private sizedFor = 0;
  /** Which set of buttons the hit areas are laid out for. */
  private laidOut = "";

  constructor(private actions: UploadCanvasActions) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "upload-canvas";
    this.overlay = document.createElement("div");
    this.overlay.id = "upload-overlay";

    this.el = document.createElement("div");
    this.el.id = "upload-layer";
    this.el.append(this.canvas, this.overlay);
    this.ctx = this.canvas.getContext("2d");
  }

  /** The buttons on offer: with a vault, Obsidian first. */
  private choices(): Choice[] {
    const a = this.actions;
    return State.settings.obsidianVault
      ? [
          { label: "Save to Obsidian", w: 140, run: a.obsidian },
          { label: "Keep it", w: 80, run: a.keep },
          { label: "Cancel", w: 80, run: a.cancel },
        ]
      : [
          { label: "Keep it", w: 112, run: a.keep },
          { label: "Cancel", w: 92, run: a.cancel },
        ];
  }

  /** Where each button goes, left to right from the text column. */
  private static place(list: Choice[]): number[] {
    let x = TX;
    return list.map((c) => {
      const at = x;
      x += c.w + BTN.gap;
      return at;
    });
  }

  /** Invisible buttons over the painted ones; rebuilt only when the set changes. */
  private layOutHits(list: Choice[]) {
    const key = list.map((c) => c.label).join("|");
    if (key === this.laidOut) return;
    this.laidOut = key;
    const xs = UploadCanvas.place(list);
    this.overlay.replaceChildren(
      ...list.map((c, i) => {
        const b = document.createElement("button");
        b.className = "upload-hit";
        b.title = c.label;
        Object.assign(b.style, { left: `${xs[i]}px`, top: `${BTN.y}px`, width: `${c.w}px`, height: `${BTN.h}px` });
        b.addEventListener("click", c.run);
        return b;
      }),
    );
  }

  draw(f: DropFrame, wallTime: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.sizedFor !== dpr) {
      this.sizedFor = dpr;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.canvas.style.width = `${W}px`;
      this.canvas.style.height = `${H}px`;
    }
    const x = this.ctx;
    if (!x) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);

    const look = activeLook();
    const chooseAt = FILL + f.duration + CARD_DELAY;
    const chooseAlpha = f.dropped ? seg(f.sinceDrop, chooseAt, chooseAt + 0.3) : 0;
    this.overlay.style.display = chooseAlpha > 0.5 ? "block" : "none";

    if (!f.dropped) this.drawHover(x, f, look, wallTime);
    else this.drawAbsorb(x, f, look, wallTime, chooseAlpha);
  }

  // ── Hover: "Drop it on me!" ─────────────────────────────────────────────────

  private drawHover(x: CanvasRenderingContext2D, f: DropFrame, look: Look, t: number) {
    const dx = f.cursorX - JX;
    const dy = f.cursorY - JY;
    const near = 1 - clamp(Math.hypot(dx, dy) / 260, 0, 1);

    // Ripples pulsing out from the jelly: come here.
    for (let i = 0; i < 2; i++) {
      const k = ((f.sinceEnter * 0.8 + i * 0.5) % 1);
      x.strokeStyle = `rgba(${look.rgb},${0.35 * (1 - k)})`;
      x.lineWidth = 2;
      x.beginPath();
      x.ellipse(JX, JY + JR * BODY.base, JR * (1.2 + k * 1.6), JR * (0.25 + k * 0.35), 0, 0, Math.PI * 2);
      x.stroke();
    }

    drawFigure(x, {
      x: JX + clamp(dx * 0.04, -8, 8), y: JY, R: JR * (1 + near * 0.06), look, time: t,
      tilt: clamp(dx / 900, -0.18, 0.18),
      sx: 1 + Math.sin(t * 3) * 0.02, sy: 1 - Math.sin(t * 3) * 0.02 + near * 0.04,
      eye: near > 0.65 ? "wide" : "round",
      lookX: clamp(dx / 220, -1, 1), lookY: clamp(dy / 160, -1, 1),
      shadow: 1,
    });

    const tx = 0.9;
    text(x, "Drop it on me!", TX, 92, `600 15px ${FONT}`, `rgba(242,246,253,${tx})`);
    text(x, "I'll keep a copy safe in my inbox.", TX, 113, `400 12.5px ${FONT}`, `rgba(185,200,228,${tx})`);

    // The file you're dragging, hanging off the cursor.
    x.save();
    x.translate(f.cursorX + 6, f.cursorY + 12);
    x.rotate(Math.sin(t * 4) * 0.06);
    drawDoc(x, 1, 0.95);
    x.restore();
  }

  // ── Drop → absorb → done → choose ───────────────────────────────────────────

  private drawAbsorb(x: CanvasRenderingContext2D, f: DropFrame, look: Look, t: number, chooseAlpha: number) {
    const s = f.sinceDrop;
    const done = FILL + f.duration;
    const p = seg(s, FILL, done);
    const name = shortName(State.droppedFile?.name ?? "file");
    const huge = f.reaction === "huge";
    const reacting = f.reaction != null && s >= done - 0.05 && s < done + 1.8;

    // The splash as it lands: the jelly squashes and springs back.
    const land = s - SINK;
    const squash = land > 0 && land < 0.6 ? Math.sin(land * Math.PI * 3.3) * Math.exp(-land * 5) : 0;
    // Straining with a huge file: a little shake while it absorbs.
    const strain = huge && s > SINK && s < done + 1.2 ? Math.sin(s * 42) * 0.035 : 0;

    let eye: FigureEye = "round";
    let lookX = 0;
    let lookY = 0.2;
    if (s < SINK) {
      // Watching the file come in.
      const k = s / SINK;
      lookX = clamp((lerp(f.dropX, JX, k) - JX) / 200, -1, 1);
      lookY = -0.4;
    } else if (s >= done && s < done + 0.6) {
      eye = "happy";
    }
    if (reacting && f.reaction === "image") eye = "star";
    if (reacting && f.reaction === "code") { lookX = 0.6; lookY = -0.7; }

    // The file sliding from where you let go into the top of the jelly.
    if (s < SINK) {
      const k = eInOut(s / SINK);
      const fx = lerp(f.dropX, JX, k);
      const fy = lerp(f.dropY, JY - JR * 0.2, k) - Math.sin(k * Math.PI) * 26;
      x.save();
      x.translate(fx, fy);
      x.rotate(k * 0.6);
      drawDoc(x, lerp(1, 0.6, k), 1);
      x.restore();
    }

    drawFigure(x, {
      x: JX, y: JY, R: JR, look, time: t,
      tilt: strain,
      sx: 1 + squash * 0.18, sy: 1 - squash * 0.2,
      eye, lookX, lookY, shadow: 1,
      inside: s >= SINK ? (c, R) => this.drawInside(c, R, s, p, done, t) : undefined,
    });

    // Splash ring on the jelly's surface as the file goes in.
    if (land > 0 && land < 0.5) {
      const k = land / 0.5;
      x.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
      x.lineWidth = 1.6;
      x.beginPath();
      x.ellipse(JX, JY - JR * BODY.top * 0.85, 6 + k * 26, 2 + k * 6, 0, 0, Math.PI * 2);
      x.stroke();
    }

    if (huge && s > SINK && s < done + 1.2) this.drawSweat(x, s);
    if (reacting && f.reaction === "code") this.drawThinking(x, t);
    if (reacting && f.reaction === "image") this.drawTwinkles(x, t);

    // Text and meter, then the choice.
    const meterAlpha = 1 - seg(s, done + 0.6, done + 0.9);
    if (meterAlpha > 0.01) {
      x.save();
      x.globalAlpha = meterAlpha;
      const label = s < done ? `Absorbing ${name}` : `${name} is in!`;
      text(x, label, TX, 92, `600 15px ${FONT}`, "#F2F6FD");
      text(x, s < done ? `${Math.round(p * 100)} %` : "All done.", TX, 113, `400 12.5px ${FONT}`, "#B9C8E4");
      this.drawMeter(x, look, p, s);
      x.restore();
    }
    if (chooseAlpha > 0.01) {
      x.save();
      x.globalAlpha = chooseAlpha;
      x.translate(0, (1 - chooseAlpha) * 4);
      text(x, `${name} is in!`, TX, 76, `600 15px ${FONT}`, "#F2F6FD");
      text(x, "What do you want to do with it?", TX, 97, `400 12.5px ${FONT}`, "#B9C8E4");
      const list = this.choices();
      this.layOutHits(list);
      UploadCanvas.place(list).forEach((bx, i) =>
        i === 0
          ? this.drawButton(x, bx, list[i].w, list[i].label, look.body, "#13213A")
          : this.drawButton(x, bx, list[i].w, list[i].label, `rgba(${look.rgb},0.2)`, "#F2F6FD"),
      );
      x.restore();
    }
  }

  /** Inside the jelly: the file drifting, shrinking and fading, bubbles rising off it. */
  private drawInside(x: CanvasRenderingContext2D, R: number, s: number, p: number, done: number, t: number) {
    const fx = Math.sin(s * 1.4) * R * 0.25;
    const fy = R * 0.05 + Math.cos(s * 1.1) * R * 0.06;
    if (s < done) {
      x.save();
      x.translate(fx, fy);
      x.rotate(0.6 + s * 0.5);
      drawDoc(x, lerp(0.55, 0.18, eOut(p)), lerp(0.95, 0.35, p));
      x.restore();
      // Bubbles coming off the file as it dissolves.
      x.strokeStyle = "rgba(255,255,255,0.7)";
      x.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const k = ((t * 0.9 + i * 0.27) % 1);
        x.beginPath();
        x.arc(fx + Math.sin(i * 2.1 + t) * R * 0.15, fy - k * R * 0.8, R * (0.04 + 0.02 * (i % 2)), 0, Math.PI * 2);
        x.stroke();
      }
    } else {
      // Dissolved: a burst of sparkles where it was.
      const k = seg(s, done, done + 0.6);
      if (k < 1) {
        x.strokeStyle = `rgba(255,255,255,${1 - k})`;
        x.lineWidth = 1.4;
        x.lineCap = "round";
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const r0 = R * (0.08 + k * 0.35);
          const r1 = r0 + R * 0.14;
          x.beginPath();
          x.moveTo(fx + Math.cos(a) * r0, fy + Math.sin(a) * r0);
          x.lineTo(fx + Math.cos(a) * r1, fy + Math.sin(a) * r1);
          x.stroke();
        }
      }
    }
  }

  /** Ten bubbles: empty rings that fill one by one as the copy goes. */
  private drawMeter(x: CanvasRenderingContext2D, look: Look, p: number, s: number) {
    const appear = seg(s, SINK, FILL);
    for (let i = 0; i < METER.n; i++) {
      const bx = METER.x + i * METER.gap;
      const fill = clamp(p * METER.n - i, 0, 1);
      const pop = fill > 0 && fill < 1 ? 1 + Math.sin(fill * Math.PI) * 0.25 : 1;
      const r = METER.r * appear * pop;
      if (r < 0.5) continue;
      x.strokeStyle = `rgba(${look.rgb},0.45)`;
      x.lineWidth = 1.4;
      x.beginPath();
      x.arc(bx, METER.y, r, 0, Math.PI * 2);
      x.stroke();
      if (fill > 0) {
        x.fillStyle = `rgba(${look.rgb},${0.35 + 0.55 * fill})`;
        x.beginPath();
        x.arc(bx, METER.y, r * fill, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = "rgba(255,255,255,0.8)";
        x.beginPath();
        x.arc(bx - r * 0.35, METER.y - r * 0.35, r * 0.22 * fill, 0, Math.PI * 2);
        x.fill();
      }
    }
  }

  /** A soft, drop-shaped button with a centred label. */
  private drawButton(x: CanvasRenderingContext2D, bx: number, bw: number, label: string, bg: string, fg: string) {
    x.fillStyle = bg;
    x.beginPath();
    x.roundRect(bx, BTN.y, bw, BTN.h, [14, 14, 14, 4]);
    x.fill();
    text(x, label, bx + bw / 2, BTN.y + BTN.h / 2, `500 12.5px ${FONT}`, fg, "center");
  }

  private drawSweat(x: CanvasRenderingContext2D, s: number) {
    const k = (s * 0.9) % 1;
    const sx = JX - JR * 0.95;
    const sy = JY - JR * 0.45 + k * JR * 0.5;
    const r = JR * 0.13;
    x.save();
    x.globalAlpha = 1 - k * 0.7;
    x.fillStyle = "#7CC7FF";
    x.beginPath();
    x.moveTo(sx, sy - r);
    x.quadraticCurveTo(sx + r * 0.8, sy + r * 0.2, sx, sy + r * 0.6);
    x.quadraticCurveTo(sx - r * 0.8, sy + r * 0.2, sx, sy - r);
    x.fill();
    x.restore();
  }

  private drawThinking(x: CanvasRenderingContext2D, t: number) {
    for (let i = 0; i < 3; i++) {
      const phase = (((t * 2.4 - i * 0.22) % 1) + 1) % 1;
      const r = (2.2 + i * 1.2) * (1 + 0.35 * Math.max(0, Math.sin(phase * Math.PI * 2)));
      x.fillStyle = "rgba(167,139,250,0.9)";
      x.beginPath();
      x.arc(JX + JR * (0.75 + 0.25 * i), JY - JR * (0.85 + 0.25 * i), r, 0, Math.PI * 2);
      x.fill();
    }
  }

  private drawTwinkles(x: CanvasRenderingContext2D, t: number) {
    const spots: [number, number][] = [[-1.35, -0.55], [1.35, -0.4], [1.05, 0.55]];
    spots.forEach(([ox, oy], i) => {
      const k = (Math.sin(t * 7 + i * 2.1) + 1) / 2;
      const s = 3 + 3 * k;
      x.save();
      x.translate(JX + ox * JR, JY + oy * JR);
      x.globalAlpha = 0.4 + 0.6 * k;
      x.beginPath();
      for (let j = 0; j < 8; j++) {
        const r = j % 2 ? s * 0.22 : s;
        const a = (j * Math.PI) / 4;
        x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.closePath();
      x.fillStyle = "#FFFFFF";
      x.fill();
      x.restore();
    });
  }
}
