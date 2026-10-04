// A small live character on its own canvas, wearing one personality's look.
// Used by the first-launch picker and by both settings screens, so every place
// that offers the choice shows the real characters, not just their names.

import { JellyEngine } from "./engine";
import type { Look } from "./looks";

export class JellyPreview {
  readonly canvas: HTMLCanvasElement;
  readonly engine = new JellyEngine();

  private readonly w: number;
  private readonly h: number;
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);
  private lastMs = 0;

  /**
   * `width` is the canvas width in CSS pixels (the body is about 60 % of it);
   * `overhang` is extra room above for the accessory and hearts.
   */
  constructor(look: Look, width: number, overhang: number) {
    this.w = width;
    this.h = width + overhang;
    this.engine.look = look;
    this.engine.particleOverhang = overhang;
    // Previews are only drawn while on screen, so the jelly can always move.
    this.engine.live = true;
    this.engine.setState("idle", true);

    this.canvas = document.createElement("canvas");
    this.canvas.className = "buddy-preview";
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  /** Points the eyes at a position given in the page's CSS pixels. */
  lookAt(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    this.engine.lookX = Math.tanh((x - (r.left + r.width / 2)) / 260);
    this.engine.lookY = -Math.tanh((y - (r.top + r.height / 2)) / 200);
  }

  /** Advances the animation and redraws. Call once per frame. */
  tick(nowMs: number) {
    const dt = this.lastMs ? Math.min(0.05, (nowMs - this.lastMs) / 1000) : 1 / 60;
    this.lastMs = nowMs;
    this.engine.update(dt);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.engine.draw(ctx, this.w, this.h);
  }

  /** Forget the last frame time, so a paused preview doesn't jump on resume. */
  pause() {
    this.lastMs = 0;
  }
}
