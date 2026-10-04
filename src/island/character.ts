// The jelly on the island: where it sits (springing between the spots in
// core/layout.ts), its canvas and the soft glow behind it, where its eyes look,
// and whether a point is on it.

import { Spring } from "../core/anim";
import { State } from "../core/state";
import { botGlowColor, botGlowOpacity, botPosition, type BotStateName } from "../core/layout";
import { JellyEngine } from "../jelly/engine";
import { h } from "../views/kit";
import type { Rect } from "./shape";

/** Canvas room above the body for hats, hearts and sparkles. */
const OVERHANG = 40;
/** The engine draws the body at this share of its canvas. */
const BODY_SHARE = 0.6;

export class IslandCharacter {
  readonly engine = new JellyEngine();
  readonly canvas = h("canvas", { id: "bot-canvas" });
  readonly glow = h("div", { id: "bot-glow" });

  private x = new Spring(46);
  private y = new Spring(16);
  private size = new Spring(10);
  private px = 0; // the canvas width it was last sized for
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);
  private readonly ctx = this.canvas.getContext("2d");

  /** True while it's sliding or growing to a new spot. */
  get moving(): boolean {
    return !this.x.settled || !this.y.settled || !this.size.settled;
  }

  /** On screen at all (the greeting, the picker and the drop draw their own). */
  get visible(): boolean {
    return this.canvas.style.opacity !== "0";
  }

  /**
   * Picks its spot for the current mode and view. `hidden` hides it (and its
   * glow) because something else is drawing a character there.
   */
  aim(islandH: number, hidden: boolean) {
    const spot = botPosition(State.mode, State.view, islandH, State.uploadProgress);
    this.x.target = spot.cx;
    this.y.target = spot.cy;
    this.size.target = spot.diameter / BODY_SHARE;
    this.canvas.style.opacity = spot.opacity > 0 && !hidden ? "1" : "0";

    const glowing = State.mode === "expanded" && State.view !== "uploading" && !hidden;
    this.glow.style.display = glowing ? "block" : "none";
    if (glowing) this.placeGlow(spot.diameter, State.effectiveState);
  }

  private placeGlow(d: number, mood: BotStateName) {
    const s = this.glow.style;
    s.width = s.height = `${d * 2.2}px`;
    s.left = `${this.x.value - d * 1.1}px`;
    s.top = `${this.y.value - d * 1.1}px`;
    s.background = `radial-gradient(circle, ${botGlowColor(mood)} 0%, transparent 62%)`;
    s.opacity = String(botGlowOpacity(mood));
  }

  /** Moves, animates and draws one frame. `island` is where the island is in the window. */
  frame(dt: number, island: Rect) {
    this.x.step(dt);
    this.y.step(dt);
    this.size.step(dt);

    const w = Math.max(1, Math.round(this.size.value));
    const hh = w + OVERHANG;
    if (this.px !== w) {
      this.px = w;
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(hh * this.dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${hh}px`;
    }
    this.canvas.style.left = `${this.x.value - w / 2}px`;
    this.canvas.style.top = `${this.y.value - OVERHANG / 2 - hh / 2}px`;

    // The eyes follow the cursor, easing off with distance.
    const e = this.engine;
    e.particleOverhang = OVERHANG;
    e.lookX = Math.tanh((State.mouse.x - (island.x + this.x.value)) / 260);
    e.lookY = -Math.tanh((State.mouse.y - this.y.value) / 200);
    e.update(dt);
    if (!this.ctx) return;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, w, hh);
    e.draw(this.ctx, w, hh);
  }

  /** Its centre and radius in window coordinates. */
  spot(island: Rect): { x: number; y: number; radius: number } {
    return { x: island.x + this.x.value, y: island.y + this.y.value, radius: this.size.value / 2 };
  }

  /** Is the window point (x, y) on it? */
  hit(x: number, y: number, island: Rect): boolean {
    const s = this.spot(island);
    return (x - s.x) ** 2 + (y - s.y) ** 2 <= s.radius * s.radius;
  }
}
