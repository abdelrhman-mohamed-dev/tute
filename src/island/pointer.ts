// The cursor and the keyboard: entering and leaving the island (which drives
// the state machine), clicks and holds on the jelly, a right-click wink, and
// the hover that earns a heart — rest the cursor on the jelly and it loves it.

import { IS_TAURI } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { Greeting } from "../jelly/greeting";
import type { IslandCharacter } from "./character";
import type { DropFlow } from "./dropflow";
import type { IslandStateMachine } from "./fsm";
import type { Play } from "./play";
import type { IslandShape } from "./shape";

/** Same margin as the Rust hit test (src-tauri/src/watch.rs). */
const HIT_MARGIN = 14;
/** Resting on the jelly this long earns a heart… */
const LOVE_AFTER_MS = 1900;
/** …at most once in this long. */
const LOVE_COOLDOWN_MS = 6000;
/** Moving further than this while hovering starts the wait again. */
const LOVE_STILL_PX = 40;

export interface PointerHost {
  fsm: IslandStateMachine;
  shape: IslandShape;
  character: IslandCharacter;
  greeting: Greeting;
  play: Play;
  drop: DropFlow;
  collapse(): void;
  kick(): void;
}

export class Pointer {
  private inside = false;
  private onJelly = false;
  private love: { timer: number; x: number; y: number } | null = null;
  private lovedAt = -Infinity;

  constructor(private host: PointerHost) {}

  /** Hooks up the island's DOM events. */
  wire(tile: HTMLElement, wakeStrip: HTMLElement) {
    const { fsm, play } = this.host;

    // While hidden, the wake strip is the only thing the OS can hit.
    wakeStrip.addEventListener("mouseenter", () => {
      Sound.resume();
      if (State.mode === "hidden") fsm.mouseEntered();
    });

    tile.addEventListener("mousedown", (e) => {
      Sound.resume();
      State.lastActivity = performance.now();
      if (State.mode !== "expanded") {
        fsm.click();
      } else if (e.button === 0 && this.overJelly(e.clientX, e.clientY)) {
        this.stopLove();
        play.pressOnBot(); // click, double-click or hold: told apart on release (play.ts)
      }
    });
    // A hold can end anywhere, even off the island.
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) play.release();
    });

    tile.addEventListener("contextmenu", (e) => {
      e.preventDefault(); // never the browser's menu
      if (State.mode === "expanded" && this.overJelly(e.clientX, e.clientY)) {
        this.stopLove();
        play.wink();
      }
    });

    window.addEventListener("keydown", (e) => {
      State.lastActivity = performance.now();
      if (e.key === "Escape" && State.mode === "expanded" && !State.isPinned) this.host.collapse();
    });

    // In a plain browser (`npm run dev`) there's no Rust cursor watcher: use the DOM's.
    if (!IS_TAURI) window.addEventListener("mousemove", (e) => this.move(e.clientX, e.clientY));
  }

  /** The cursor moved, in window coordinates (from Rust's poll, or the DOM). */
  move(x: number, y: number) {
    const { fsm, shape, character, greeting, play, drop } = this.host;
    const island = shape.rect();
    State.mouse = { x, y };
    State.mouseInIsland = { x: x - island.x, y: y - island.y };
    drop.cursor(State.mouseInIsland.x, State.mouseInIsland.y);

    const inside =
      x >= island.x - HIT_MARGIN && x <= island.x + island.w + HIT_MARGIN &&
      y >= island.y - HIT_MARGIN && y <= island.y + island.h + HIT_MARGIN;
    if (inside !== this.inside) {
      this.inside = inside;
      if (inside) {
        if (fsm.state === "greeting") greeting.hover();
        fsm.mouseEntered();
      } else {
        fsm.mouseLeft();
      }
    }

    // Petting, flicking past it, keeping it awake.
    play.cursor(x, y, character.visible ? character.spot(island) : null);

    const onJelly = State.mode === "expanded" && State.stateOverride == null && character.hit(x, y, island);
    if (onJelly && !this.onJelly) this.hoverIn(x, y);
    else if (!onJelly && this.onJelly) this.stopLove();
    else if (onJelly && this.love && Math.hypot(x - this.love.x, y - this.love.y) > LOVE_STILL_PX) this.waitForLove(x, y);
    this.onJelly = onJelly;

    this.host.kick();
  }

  /** Is the cursor over the island (with its margin)? */
  get isInside(): boolean {
    return this.inside;
  }

  private overJelly(x: number, y: number): boolean {
    return this.host.character.hit(x, y, this.host.shape.rect());
  }

  private hoverIn(x: number, y: number) {
    if (performance.now() - this.lovedAt < LOVE_COOLDOWN_MS) return;
    const { engine } = this.host.character;
    engine.blink();
    engine.tgEs = 1.08; // the eyes widen a touch: it noticed you
    Sound.play("hover");
    this.waitForLove(x, y);
  }

  private waitForLove(x: number, y: number) {
    if (this.love) window.clearTimeout(this.love.timer);
    const timer = window.setTimeout(() => {
      this.love = null;
      if (!this.onJelly || State.stateOverride != null) return;
      if (performance.now() - this.lovedAt < LOVE_COOLDOWN_MS) return;
      this.lovedAt = performance.now();
      this.host.character.engine.triggerEmote("love");
      Sound.play("love");
    }, LOVE_AFTER_MS);
    this.love = { timer, x, y };
  }

  private stopLove() {
    if (this.love) window.clearTimeout(this.love.timer);
    this.love = null;
    this.host.character.engine.tgEs = 1;
  }
}
