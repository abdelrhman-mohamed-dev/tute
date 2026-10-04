// The island's outline: its width, height and corner radius, animated between
// the sizes in core/layout.ts, written to the tile, and handed to Rust so the
// window only catches clicks where the island actually is.

import { Tracked } from "../core/anim";
import { Bridge } from "../core/bridge";
import {
  EXPANDED_CORNER, EXPANDED_W, HIDDEN_W, PANEL_W, ROUNDED_CORNER, islandSize,
  type IslandMode, type IslandViewName,
} from "../core/layout";

/** The tile floats this far below the top of the screen. */
export const TILE_GAP = 6;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class IslandShape {
  private width = new Tracked(HIDDEN_W);
  private height = new Tracked(0);
  private radius = new Tracked(ROUNDED_CORNER);
  /** The last click area sent to Rust; only real changes are sent again. */
  private sent: Rect | null = null;

  /**
   * `tile` is the island itself; `centred` are full-width layers inside it
   * (the greeting, the drop canvas) that stay centred as it resizes.
   */
  constructor(private tile: HTMLElement, private centred: HTMLElement[]) {}

  get w(): number {
    return this.width.value;
  }

  get h(): number {
    return this.height.value;
  }

  get animating(): boolean {
    return this.width.animating || this.height.animating || this.radius.animating;
  }

  /** Heads for the size of `mode`/`view`: springing when it grows, gliding when it shrinks. */
  resize(mode: IslandMode, view: IslandViewName, chatCount: number, shrinking: boolean) {
    const { w, h } = islandSize(mode, view, chatCount);
    const r = mode === "expanded" ? EXPANDED_CORNER : ROUNDED_CORNER;
    for (const [track, to] of [[this.width, w], [this.height, h], [this.radius, r]] as const) {
      if (shrinking) track.curveTowards(to);
      else track.springTo(to);
    }
  }

  step(dt: number, nowMs: number) {
    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.radius.step(dt, nowMs);
  }

  /** The island in window coordinates (the window's top-left is 0, 0). */
  rect(): Rect {
    return { x: (PANEL_W - this.w) / 2, y: TILE_GAP, w: this.w, h: this.h };
  }

  apply() {
    const { w, h } = this;
    const s = this.tile.style;
    s.width = `${w}px`;
    s.height = `${h}px`;
    s.borderRadius = `${this.radius.value}px`;
    s.transform = `translate(-50%, ${TILE_GAP}px)`;
    for (const el of this.centred) el.style.left = `${(w - EXPANDED_W) / 2}px`;

    // The click area reaches up to the screen's edge, across the gap above
    // the tile, so a cursor pushed to the top still finds the island.
    const area = { x: (PANEL_W - w) / 2, y: 0, w, h: h + TILE_GAP };
    const last = this.sent;
    if (!last || Math.abs(last.x - area.x) > 0.5 || Math.abs(last.w - area.w) > 0.5 || Math.abs(last.h - area.h) > 0.5) {
      this.sent = area;
      void Bridge.setIslandRect(area.x, area.y, area.w, area.h);
    }
  }
}
