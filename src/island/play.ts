// The jelly's games: what it does because of you, and on its own.
//
//   You         rub it back and forth to pet it (too long and it gets grumpy) ·
//               double-click: a hop (the twirl, once the bond unlocks it) ·
//               press and hold: it squishes, then boings when let go ·
//               right-click: a wink · whiz the cursor past: it jumps aside
//   On its own  dozes off when you're away and wakes with a start · fidgets
//               now and then · a morning stretch on the first open of the day ·
//               sleepier late at night
//   Drops       a run of drops gets a bigger party each time
//
// The island hands over the input and runs the frames; this file only picks
// the move. Every timer stops when the island hides, so hidden costs nothing.

import { State } from "../core/state";
import { Sound } from "../core/sound";
import type { JellyEngine } from "../jelly/engine";
import { activeLook } from "../jelly/looks";
import { award, has } from "./bond";

/** Where the jelly is, in window pixels. */
export interface BotSpot {
  x: number;
  y: number;
  radius: number;
}

export interface PlayHost {
  engine: JellyEngine;
  /** The jelly is on screen and free (not greeting, picking, absorbing a file…). */
  playable(): boolean;
  /** Something started moving: make sure frames are coming. */
  kick(): void;
}

const seconds = () => performance.now() / 1000;
const isNight = () => {
  const hour = new Date().getHours();
  return hour >= 22 || hour < 5;
};

/** Named timeouts, so a part can restart or stop its own without bookkeeping. */
class Timers {
  private ids = new Map<string, number>();

  set(name: string, s: number, run: () => void) {
    this.clear(name);
    this.ids.set(name, window.setTimeout(() => {
      this.ids.delete(name);
      run();
    }, s * 1000));
  }

  has(name: string): boolean {
    return this.ids.has(name);
  }

  clear(name: string) {
    window.clearTimeout(this.ids.get(name));
    this.ids.delete(name);
  }

  clearAll() {
    for (const id of this.ids.values()) window.clearTimeout(id);
    this.ids.clear();
  }
}

// ── Clicks and holds ──────────────────────────────────────────────────────────

/** A second click this soon is a double-click. */
const DOUBLE_S = 0.32;
/** Held this long, a press is a hold. */
const HOLD_S = 0.26;

class Clicks {
  private pressedAt: number | null = null;
  private holding = false;
  private lastClick = 0;

  constructor(private host: PlayHost, private timers: Timers) {}

  get pressed(): boolean {
    return this.pressedAt !== null;
  }

  press() {
    this.pressedAt = seconds();
    this.holding = false;
    this.timers.set("hold", HOLD_S, () => {
      this.holding = true;
      this.host.engine.pressDown();
      this.host.kick();
    });
  }

  release() {
    if (this.pressedAt === null) return;
    const held = seconds() - this.pressedAt;
    this.pressedAt = null;
    this.timers.clear("hold");
    const e = this.host.engine;
    if (this.holding) {
      this.holding = false;
      e.release(held);
      Sound.play("pop");
    } else if (seconds() - this.lastClick < DOUBLE_S) {
      this.lastClick = 0;
      if (has("twirl")) e.twirl();
      else e.jump();
      Sound.play("pop");
    } else {
      // A single click is a poke; three in a row make it dizzy (engine.ts).
      this.lastClick = seconds();
      e.slap();
    }
    this.host.kick();
  }

  /** Drops a press in progress (the island is hiding). */
  cancel() {
    this.timers.clear("hold");
    if (this.holding) this.host.engine.release(0);
    this.holding = false;
    this.pressedAt = null;
  }
}

// ── Petting ───────────────────────────────────────────────────────────────────

/** Petting is the cursor changing direction over the jelly this many times… */
const PET_TURNS = 3;
/** …within this long. */
const PET_WINDOW_S = 1;
/** Petted this long without a break, it has had enough. */
const PET_ENOUGH_S = 5;

class Petting {
  private lastX: number | null = null;
  private dir = 0;
  private turns: number[] = [];
  private since: number | null = null;
  private lastPet = 0;
  private restUntil = 0;

  constructor(private host: PlayHost) {}

  stop() {
    this.lastX = null;
    this.dir = 0;
    this.turns = [];
    this.since = null;
  }

  /** The cursor moved over the jelly to `x`. */
  rub(x: number) {
    const t = seconds();
    if (this.lastX !== null && Math.abs(x - this.lastX) >= 2) {
      const dir = Math.sign(x - this.lastX);
      if (this.dir && dir !== this.dir) this.turns.push(t);
      this.dir = dir;
    }
    this.lastX = x;
    this.turns = this.turns.filter((at) => t - at < PET_WINDOW_S);
    if (this.turns.length < PET_TURNS || t < this.restUntil) {
      if (!this.turns.length) this.since = null;
      return;
    }

    this.since ??= t;
    const e = this.host.engine;
    if (t - this.since > PET_ENOUGH_S) {
      e.triggerEmote("annoyed");
      this.restUntil = t + 6;
      this.stop();
    } else if (t - this.lastPet > 0.18) {
      if (this.since === t) Sound.play("hover"); // the first stroke purrs
      this.lastPet = t;
      e.pet(has("sparkles"));
      award("pet");
    } else {
      return;
    }
    this.host.kick();
  }
}

// ── Flicks past it ────────────────────────────────────────────────────────────

/** Faster than this (px/s)… */
const FLICK_SPEED = 1800;
/** …and closer than this (px) to the jelly, and it jumps aside. */
const FLICK_NEAR = 110;

class Flicks {
  private last: { x: number; y: number; t: number } | null = null;
  private calmUntil = 0;

  constructor(private host: PlayHost) {}

  /** Every cursor sample. `near`: where the jelly is from the cursor, or null to skip the check. */
  sample(x: number, y: number, near: { dx: number; dist: number } | null) {
    const t = seconds();
    const prev = this.last;
    this.last = { x, y, t };
    if (!prev || !near || t < this.calmUntil) return;
    const speed = Math.hypot(x - prev.x, y - prev.y) / Math.max(0.001, t - prev.t);
    if (speed > FLICK_SPEED && near.dist < FLICK_NEAR) {
      this.calmUntil = t + 5;
      this.host.engine.startle(near.dx > 0 ? -1 : 1); // away from the cursor
      Sound.play("pop");
      this.host.kick();
    }
  }
}

// ── Sleep ─────────────────────────────────────────────────────────────────────

/** No mouse this long while on screen: it dozes off. */
const DOZE_AFTER_S = 75;
/** Hidden this long: it's found asleep when it comes back. */
const AWAY_S = 180;
/**
 * Asleep this long, it settles into a still pose (eyes shut, no z's), because
 * the island stays on screen and an endless sleeping animation would keep it
 * redrawing all the while you're away.
 */
const STILL_AFTER_S = 20;

class Sleep {
  asleep = false;
  private still = false;
  private lastStir = seconds();
  /** Cursor moves don't wake it before this, so you get to see it sleeping. */
  private graceUntil = 0;

  constructor(
    private host: PlayHost,
    private timers: Timers,
    private hidden: () => boolean,
    private onWake: () => void,
  ) {}

  /** You did something. Wakes it, or pushes sleep further off. */
  stir() {
    this.lastStir = seconds();
    if (this.asleep) {
      if (seconds() >= this.graceUntil) this.wake(true);
    } else if (!this.timers.has("doze")) {
      this.watch();
    }
  }

  /**
   * One timer: when it fires it checks how long it's really been quiet and
   * waits out the rest, so cursor samples never have to touch it.
   */
  watch(s = DOZE_AFTER_S) {
    if (this.hidden()) return;
    this.timers.set("doze", s, () => {
      const quiet = seconds() - this.lastStir;
      if (quiet < DOZE_AFTER_S) this.watch(DOZE_AFTER_S - quiet);
      // Only with nothing going on: a jelly asleep on a working session would hide it.
      else if (this.host.playable() && this.host.engine.state === "idle") this.doze(true);
      else this.watch();
    });
  }

  /** Found asleep after a long absence, then woken by you a moment later. */
  foundAsleep() {
    this.doze(false);
    this.graceUntil = seconds() + 1.2;
    this.timers.set("found", 1.2, () => this.wake(true));
  }

  private doze(yawnFirst: boolean) {
    if (this.asleep) return;
    this.asleep = true;
    this.timers.clear("fidget");
    const sleep = () => {
      if (!this.asleep) return;
      this.mood("sleeping");
      this.timers.set("still", STILL_AFTER_S, () => this.holdStill());
    };
    if (yawnFirst) {
      this.host.engine.triggerEmote("yawn", 1.6);
      Sound.play("yawn");
      this.host.kick();
      this.timers.set("yawn", 1.5, sleep);
    } else {
      sleep();
    }
  }

  private holdStill() {
    if (!this.asleep) return;
    this.still = true;
    this.mood("idle");
    this.shutEyes(true);
  }

  /** `startled`: you woke it, so it jumps. Otherwise it just stops sleeping. */
  wake(startled: boolean) {
    if (!this.asleep) return;
    this.asleep = false;
    this.timers.clear("still");
    this.timers.clear("yawn");
    if (this.still) {
      this.still = false;
      this.shutEyes(false);
    }
    if (State.stateOverride === "sleeping" || State.stateOverride === "idle") State.stateOverride = null;
    const e = this.host.engine;
    e.setState(State.effectiveState);
    if (startled) {
      e.triggerEmote("surprised", 0.8);
      Sound.play("pop");
      // Late at night it's still sleepy.
      if (isNight()) {
        this.timers.set("sleepy", 1.1, () => {
          e.triggerEmote("yawn", 1.4);
          this.host.kick();
        });
      }
    }
    State.notify();
    this.host.kick();
    this.onWake();
  }

  private mood(state: "sleeping" | "idle") {
    State.stateOverride = state;
    this.host.engine.setState(state);
    State.notify();
    this.host.kick();
  }

  private shutEyes(shut: boolean) {
    const e = this.host.engine;
    e.permanentEye = shut ? "closed" : null;
    e.eyeOverride = shut ? "closed" : null;
    e.eyeOverrideUntil = shut ? Number.POSITIVE_INFINITY : 0;
  }
}

// ── The whole set ─────────────────────────────────────────────────────────────

/** A fidget every this many seconds, give or take. */
const FIDGET_S: [number, number] = [7, 15];
/** Drops closer together than this make a run. */
const RUN_GAP_S = 90;
/** The day of the last morning stretch, so it's once a day. */
const STRETCHED_KEY = "tute.lastSeenDay";

export class Play {
  private timers = new Timers();
  private clicks: Clicks;
  private petting: Petting;
  private flicks: Flicks;
  private sleep: Sleep;
  private hiddenAt: number | null = null;
  private lastDrop = 0;
  private run = 0;

  constructor(private host: PlayHost) {
    this.clicks = new Clicks(host, this.timers);
    this.petting = new Petting(host);
    this.flicks = new Flicks(host);
    this.sleep = new Sleep(host, this.timers, () => this.hiddenAt !== null, () => this.carryOn());
  }

  private get engine() {
    return this.host.engine;
  }

  // ── Shown and hidden ──

  /** The island came back (as the bar or open) after being hidden. */
  shown() {
    const away = this.hiddenAt === null ? 0 : seconds() - this.hiddenAt;
    this.hiddenAt = null;
    this.carryOn();
    if (away > AWAY_S && this.host.playable()) this.sleep.foundAsleep();
    else this.morningStretch();
  }

  /** The island is hiding: every timer stops, nothing runs until it's back. */
  hidden() {
    this.hiddenAt = seconds();
    this.clicks.cancel();
    if (this.sleep.asleep) this.sleep.wake(false);
    this.timers.clearAll();
  }

  // ── You ──

  /** Every cursor sample, in window pixels. `spot` is null while the jelly isn't drawn. */
  cursor(x: number, y: number, spot: BotSpot | null) {
    this.sleep.stir();
    if (!spot || !this.host.playable()) {
      this.flicks.sample(x, y, null);
      this.petting.stop();
      return;
    }
    const dx = x - spot.x;
    const dist = Math.hypot(dx, y - spot.y);
    const over = dist <= spot.radius;
    this.flicks.sample(x, y, over || this.clicks.pressed ? null : { dx, dist });
    if (over && !this.clicks.pressed && this.engine.state === "idle") this.petting.rub(x);
    else this.petting.stop();
  }

  /** The mouse went down on the jelly. */
  pressOnBot() {
    if (!this.host.playable()) return;
    if (this.sleep.asleep) this.sleep.wake(true);
    else this.clicks.press();
  }

  /** The mouse came up, anywhere (a hold can end off the jelly). */
  release() {
    this.clicks.release();
  }

  /** A right-click on the jelly. */
  wink() {
    if (!this.host.playable()) return;
    if (this.sleep.asleep) {
      this.sleep.wake(true);
      return;
    }
    this.engine.triggerEmote("wink", 1.2);
    Sound.play("wink");
    // Tutee blows a kiss with hers.
    if (activeLook().id === "tutee") this.timers.set("kiss", 0.25, () => this.engine.emit("heart", 1));
    this.host.kick();
  }

  // ── On its own ──

  /** Back to normal life: sleep is watched, and the next fidget is on its way. */
  private carryOn() {
    if (this.hiddenAt !== null) return;
    this.sleep.watch();
    this.nextFidget();
  }

  /**
   * Fidgets keep coming on their own timer. They mustn't restart the sleep
   * timer: they come every few seconds, so it would never run out and the
   * jelly could never doze off.
   */
  private nextFidget() {
    const [min, max] = FIDGET_S;
    this.timers.set("fidget", min + Math.random() * (max - min), () => {
      if (this.host.playable() && !this.sleep.asleep && !this.clicks.pressed && this.engine.state === "idle") {
        this.fidget();
      }
      this.nextFidget();
    });
  }

  private fidget() {
    // Late at night, more yawns than tunes.
    if (isNight() && Math.random() < 0.5) {
      this.engine.triggerEmote("yawn", 1.4);
      Sound.play("yawn");
    } else {
      const moves = ["look", "hop", "stretch", "hum"] as const;
      this.engine.fidget(moves[Math.floor(Math.random() * moves.length)]);
    }
    this.host.kick();
  }

  /**
   * The first time it's seen on a morning: a big stretch and a yawn. The
   * island is often first up during the launch greeting, so it waits (a few
   * seconds at most) for the jelly to be free.
   */
  private morningStretch(tries = 12) {
    const today = new Date().toDateString();
    const hour = new Date().getHours();
    let done: string | null;
    try {
      done = localStorage.getItem(STRETCHED_KEY);
    } catch {
      return; // no storage: no stretch, rather than one every time
    }
    if (done === today || hour < 5 || hour >= 12) return;
    if (!this.host.playable() || this.engine.state !== "idle") {
      if (tries > 0) this.timers.set("morning", 1, () => this.morningStretch(tries - 1));
      return;
    }
    try {
      localStorage.setItem(STRETCHED_KEY, today);
    } catch {
      // It'll just stretch again next time.
    }
    this.engine.fidget("stretch");
    this.host.kick();
    this.timers.set("morning", 1.3, () => {
      this.engine.triggerEmote("yawn", 1.3);
      Sound.play("yawn");
      this.host.kick();
    });
  }

  // ── Drops ──

  /** A file was dropped. Returns how long the run of drops is now. */
  dropped(): number {
    const t = seconds();
    this.run = t - this.lastDrop < RUN_GAP_S ? this.run + 1 : 1;
    this.lastDrop = t;
    this.sleep.stir();
    return this.run;
  }

  /** A run of two or more gets its party, once the jelly is back in view. */
  celebrateStreak() {
    if (this.run < 2) return;
    this.engine.celebrate(this.run);
    Sound.play(this.run >= 4 ? "proud" : "approve");
    this.host.kick();
  }
}
