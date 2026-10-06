// Tute's character engine. The jelly is a little physical thing: its squash,
// lean and side-to-side shift are springs, and a hop is a real jump against
// gravity — so every move ends in a wobble that matches how hard it was, and
// it squashes from the floor up, feet planted, like real jelly.
//
// On top of the body: a mood (the session's state: colour, eyes, badge, an
// idle motion), short expressions (emotes) that borrow the eyes for a moment,
// a frame-driven timeline for little choreographies, and floating effects.
// Drawing uses tute's jelly body (jelly.ts), eyes (eyes.ts) and effects (fx.ts).
//
// Everything advances in `update(dt)` — no timers — so a jelly nobody draws
// does nothing at all, and `busy` says when the frame loop may stop.

import type { BotEmoteName, BotStateName } from "../core/layout";
import { Sound } from "../core/sound";
import { drawAccessory, drawLashes, LOOKS, type Look } from "./looks";
import { BODY, drawJelly, puddlePath } from "./jelly";
import { drawEye, type EyeShape } from "./eyes";
import { drawBadge, drawFx, rgba, spawn, stepFx, type Badge, type Fx, type FxKind, type RGB } from "./fx";

export type { EyeShape } from "./eyes";
export type { RGB } from "./fx";

const now = () => performance.now() / 1000;

export function hexToRGB(hex: string): RGB {
  const v = parseInt(hex.replace("#", ""), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// ── Springs ───────────────────────────────────────────────────────────────────

/** A damped spring pulling `value` towards `target`. `kick` adds velocity. */
class Spring {
  value: number;
  target: number;
  velocity = 0;

  constructor(value: number, private stiffness: number, private damping: number) {
    this.value = value;
    this.target = value;
  }

  kick(v: number) {
    this.velocity += v;
  }

  step(dt: number) {
    // Small sub-steps keep a stiff spring stable on a slow frame.
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const accel = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
  }

  get resting(): boolean {
    return Math.abs(this.value - this.target) < 0.002 && Math.abs(this.velocity) < 0.01;
  }
}

// ── Moods ─────────────────────────────────────────────────────────────────────

/** How a mood moves while nothing else is going on. */
type Motion = "still" | "hop" | "scan" | "ponder" | "sway" | "breathe" | "droop";

interface Mood {
  color: RGB;
  /** How strongly the colour washes over the jelly, 0…1. */
  tint: number;
  eyes: EyeShape;
  badge: Badge | null;
  motion: Motion;
}

const HUE = {
  idle: hexToRGB("#E6EAF0"),
  working: hexToRGB("#3E9BFF"),
  thinking: hexToRGB("#8B66F4"),
  searching: hexToRGB("#6468F2"),
  approval: hexToRGB("#F6A62A"),
  question: hexToRGB("#26D0EC"),
  error: hexToRGB("#F2525F"),
  finished: hexToRGB("#36D39A"),
  ratelimit: hexToRGB("#FA933E"),
  sleeping: hexToRGB("#95A3B8"),
  dizzy: hexToRGB("#F273B5"),
};

const badge = (kind: Badge["kind"], color: RGB): Badge => ({ kind, color });

const MOODS: Record<BotStateName, Mood> = {
  idle: { color: HUE.idle, tint: 0, eyes: "pill", badge: null, motion: "still" },
  working: { color: HUE.working, tint: 0.7, eyes: "pill", badge: badge("dots", HUE.working), motion: "still" },
  thinking: { color: HUE.thinking, tint: 0.7, eyes: "pill", badge: badge("dots", HUE.thinking), motion: "ponder" },
  searching: { color: HUE.searching, tint: 0.7, eyes: "pill", badge: badge("dots", HUE.searching), motion: "scan" },
  approval: { color: HUE.approval, tint: 0.78, eyes: "wide", badge: badge("bang", HUE.approval), motion: "hop" },
  question: { color: HUE.question, tint: 0.74, eyes: "pill", badge: badge("question", HUE.question), motion: "sway" },
  error: { color: HUE.error, tint: 0.78, eyes: "flat", badge: badge("dot", HUE.error), motion: "still" },
  finished: { color: HUE.finished, tint: 0.35, eyes: "happy", badge: badge("dot", HUE.finished), motion: "still" },
  ratelimit: { color: HUE.ratelimit, tint: 0.72, eyes: "tired", badge: badge("dot", HUE.ratelimit), motion: "droop" },
  sleeping: { color: HUE.sleeping, tint: 0.32, eyes: "closed", badge: null, motion: "breathe" },
  // After three pokes: the splat, then a grumpy face while it pulls itself together.
  dizzy: { color: HUE.dizzy, tint: 0.25, eyes: "line", badge: null, motion: "still" },
};

const EMOTE_EYES: Record<BotEmoteName, EyeShape> = {
  love: "heart", surprised: "dot", proud: "star", wink: "wink",
  yawn: "tired", happy: "happy", annoyed: "line",
};

const INK = "rgb(24,20,19)";
const MINI_INK = "rgb(16,19,26)";
/** Eye size and spacing, in body units. */
const EYE_W = 0.27;
const EYE_GAP = 0.36;
const EYE_Y = -0.09;
/** Gravity for hops, body units per s². */
const GRAVITY = 11;

// ── Engine ────────────────────────────────────────────────────────────────────

export class JellyEngine {
  /** A small pill / grid character: solid colour, bigger eyes, wanders on its own. */
  isMini = false;
  /** Solid body colour for mini characters (null = the clear jelly). */
  bodyColor: RGB | null = null;
  /** Personality look: colours, accessory, lashes, what it wears. */
  look: Look | null = null;
  /**
   * True while the island is open: the jelly wobbles and its bubbles drift.
   * Off, it holds still, so an island nobody looks at stops redrawing.
   */
  live = false;
  /** Extra canvas height above the body, so effects can float up unclipped. */
  particleOverhang = 0;
  /** Where the cursor is, −1…1 each way (positive y = above). */
  lookX = 0;
  lookY = 0;
  /** Eye size target: the island grows the eyes a little on hover. */
  tgEs = 1;

  state: BotStateName = "idle";
  private mood: Mood = MOODS.idle;

  /** Eyes borrowed by an expression, until a time (s); minis can hold one for good. */
  eyeOverride: EyeShape | null = null;
  eyeOverrideUntil = 0;
  permanentEye: EyeShape | null = null;
  private permanentEmote: BotEmoteName | null = null;

  /** Three pokes inside 1.7 s: the island answers with the "confused" view. */
  onDizzy: (() => void) | null = null;

  // Body: springs (body units) and a hop.
  private squash = new Spring(0, 340, 13); // + flatter, − taller
  private lean = new Spring(0, 140, 13); // radians
  private shift = new Spring(0, 170, 15); // sideways
  private eyes = new Spring(1, 260, 22); // eye size
  private height = 0; // above the floor
  private rise = 0; // vertical speed
  private onLand: (() => void) | null = null;
  /** Holds the squash at a value (a press, the splat) until a time. */
  private squashHold: { value: number; until: number } | null = null;
  /** Holds the lean at an angle (proud, a wink) until a time. */
  private leanHold: { value: number; until: number } | null = null;

  // Face.
  private blinkAt = -1;
  private nextBlink = now() + 1.5 + Math.random() * 2;
  private blush = 0;
  private blushTarget = 0;
  private blushUntil = 0;
  private gaze: { x: number; y: number; until: number } | null = null;
  private arms = 0; // 0…1, raised in a stretch
  private armsTarget = 0;

  // The phone (a Telegram chat): pops out buzzing, it reads, thumbs tap, it sends.
  private phone = new Spring(0, 260, 13); // 0 put away … 1 in its hands
  private phoneMode: "read" | "type" | null = null;
  private phoneBuzzUntil = 0;
  private phoneSince = 0;

  // Colour, badge, effects.
  private color: RGB = HUE.idle;
  private tint = 0;
  private badge: Badge | null = null;
  private badgePop = 0;
  private fx: Fx[] = [];

  // Timeline: little choreographies, run from update().
  private timeline: { at: number; run: () => void }[] = [];
  private pokes: number[] = [];
  private nextHop = 0;
  private nextAmbient = 0;
  private nextMiniMove = 0;
  private miniGaze = { x: 0, y: 0, next: 0 };
  private readonly t0 = now() - Math.random() * 5;

  // ── Moods ───────────────────────────────────────────────────────────────────

  setState(next: BotStateName, force = false) {
    if (this.state === next && !force) return;
    const prev = this.state;
    this.state = next;
    this.mood = MOODS[next];
    this.setBadge(this.mood.badge);
    switch (next) {
      case "finished":
        // A happy hop, and a few twinkles when it lands.
        this.hop(2.8, () => this.burst("spark", 4));
        break;
      case "error":
        this.shift.kick(1.2);
        this.later(0.09, () => this.shift.kick(-2.2));
        break;
      case "approval":
        this.hop(2.2);
        break;
      case "dizzy":
        this.splat();
        break;
      case "ratelimit":
        this.burst("sweat", 1);
        break;
      default:
        if (prev !== next) this.blink();
    }
  }

  private setBadge(b: Badge | null) {
    const same = b && this.badge && b.kind === this.badge.kind && b.color === this.badge.color;
    if (same || (!b && !this.badge)) return;
    // Old badge shrinks away, the new one pops in.
    this.badgePop = 0;
    this.badge = b;
  }

  // ── Small building blocks ──────────────────────────────────────────────────

  private later(seconds: number, run: () => void) {
    this.timeline.push({ at: now() + seconds, run });
  }

  private hop(speed: number, onLand?: () => void) {
    if (this.height > 0.001 || this.rise > 0) return;
    this.squash.kick(2.5); // crouch a touch before leaving the floor
    this.later(0.05, () => {
      this.rise = speed;
      this.squash.kick(-4);
      this.onLand = onLand ?? null;
    });
  }

  private eyesFor(shape: EyeShape, seconds: number) {
    this.eyeOverride = shape;
    this.eyeOverrideUntil = now() + seconds;
  }

  private blushFor(amount: number, seconds: number) {
    this.blushTarget = amount;
    this.blushUntil = now() + seconds;
  }

  private burst(kind: FxKind, count: number) {
    this.fx.push(...spawn(kind, count));
  }

  /** Public: some moves throw an effect after a beat (play.ts). */
  emit(kind: FxKind, count: number) {
    this.burst(kind, count);
  }

  blink() {
    this.blinkAt = now();
  }

  // ── Touch ───────────────────────────────────────────────────────────────────

  /** A quick poke. Three inside 1.7 s and it goes splat. */
  slap() {
    if (this.state === "dizzy") return;
    const t = now();
    this.pokes = this.pokes.filter((p) => t - p < 1.7);
    this.pokes.push(t);
    Sound.play("slap");
    this.squash.kick(4.5);
    this.shift.kick((Math.random() - 0.5) * 1.2);
    if (this.pokes.length >= 3) {
      this.pokes = [];
      this.onDizzy?.();
    } else {
      this.eyesFor("line", 0.8);
      this.later(0.06, () => Sound.play("annoyed"));
    }
  }

  /** Flat as a pancake, eyes `> <`, bubbles squeezed out — then it springs back. */
  private splat() {
    this.squashHold = { value: 0.55, until: now() + 0.95 };
    this.eyesFor("squeeze", 1.3);
    this.burst("pop", 6);
    this.later(0.45, () => this.burst("pop", 3));
  }

  /** One stroke of petting. `sparkly` (bond level 4) adds a twinkle each time. */
  pet(sparkly = false) {
    this.eyesFor("happy", 0.6);
    this.blushFor(0.9, 0.6);
    this.lean.kick((Math.random() - 0.5) * 2.4);
    this.squash.kick(1.5);
    if (Math.random() < 0.3) this.burst("heart", 1);
    if (sparkly) this.burst("spark", 1);
  }

  /** Double-click: a simple happy jump, twinkles on landing. */
  jump() {
    if (this.state === "dizzy") return;
    this.eyesFor("happy", 0.9);
    this.blushFor(0.5, 0.6);
    this.hop(3.4, () => this.burst("spark", 3));
  }

  /** The twirl (bond level 2): two happy jumps with a little wiggle, notes on landing. */
  twirl() {
    if (this.state === "dizzy") return;
    this.eyesFor("happy", 1.5);
    this.blushFor(0.6, 1.2);
    this.hop(3.6, () => {
      this.burst("spark", 3);
      this.lean.kick(-2);
      this.later(0.08, () => this.hop(2.6, () => {
        this.burst("note", 2);
        this.lean.kick(2);
      }));
    });
  }

  /** Press and hold: squished flat under the finger. */
  pressDown() {
    this.squashHold = { value: 0.38, until: Number.POSITIVE_INFINITY };
    this.eyesFor("closed", Number.POSITIVE_INFINITY);
  }

  /** Let go: it springs up — higher the longer it was held. */
  release(heldSeconds: number) {
    const k = Math.min(1, Math.max(0.3, heldSeconds / 0.8));
    this.squashHold = null;
    this.eyesFor("happy", 0.7);
    this.squash.kick(-6 * k);
    this.rise = 1.6 + 2.2 * k;
    this.onLand = k > 0.7 ? () => this.burst("spark", 2) : null;
  }

  /** Something rushed past: it jumps aside, wide-eyed. `dir` is away from it. */
  startle(dir: number) {
    this.triggerEmote("surprised", 0.9);
    this.shift.kick(dir * 4.5);
  }

  /** A little idle fidget, picked by play.ts. Only when nothing else is going on. */
  fidget(kind: "look" | "hop" | "stretch" | "hum") {
    if (this.state !== "idle") return;
    const t = now();
    switch (kind) {
      case "look":
        this.gaze = { x: -0.9, y: 0.1, until: t + 0.8 };
        this.later(0.8, () => { this.gaze = { x: 0.9, y: 0.1, until: now() + 0.9 }; });
        break;
      case "hop":
        this.hop(1.9);
        this.later(0.5, () => this.hop(1.5));
        break;
      case "stretch":
        this.squashHold = { value: -0.16, until: t + 0.9 };
        this.armsTarget = 1;
        this.eyesFor("closed", 1.1);
        this.later(0.9, () => { this.armsTarget = 0; this.squash.kick(3); });
        break;
      case "hum":
        this.eyesFor("happy", 1.6);
        this.burst("note", 3);
        [0, 0.4, 0.8].forEach((at, i) => this.later(at, () => this.lean.kick(i % 2 ? -1.6 : 1.6)));
        break;
    }
  }

  /** A run of good things: 2 is happy, 3 proud, 4+ a little dance. */
  celebrate(level: number) {
    if (level <= 1) return;
    if (level === 2) {
      this.triggerEmote("happy", 1.2);
      this.burst("spark", 4);
      return;
    }
    if (level === 3) {
      this.triggerEmote("proud", 1.8);
      return;
    }
    // The dance: four bouncy hops, leaning left and right, notes and hearts.
    this.eyesFor("happy", 2.2);
    for (let i = 0; i < 4; i++) {
      this.later(i * 0.42, () => {
        this.hop(2.1);
        this.lean.kick(i % 2 ? -2.6 : 2.6);
      });
    }
    this.burst("note", 4);
    this.later(0.5, () => this.burst("heart", 3));
  }

  // ── The phone ──────────────────────────────────────────────────────────────

  /** A message came in: the phone pops out buzzing, and it looks down to read. */
  phoneIn() {
    this.phone.target = 1;
    this.phone.kick(2);
    this.phoneMode = "read";
    this.phoneSince = now();
    this.phoneBuzzUntil = now() + 0.45;
    this.eyesFor("wide", 0.4);
    this.squash.kick(2.5);
  }

  /** It's writing back: thumbs tap and a typing badge shows, until `phoneSent`. */
  phoneTyping() {
    if (!this.phoneMode) this.phoneIn();
    this.phoneMode = "type";
    this.phoneSince = now();
    this.setBadge(badge("dots", HUE.question));
  }

  /** Sent: a little flick up, a twinkle, a happy face, and the phone goes away. */
  phoneSent() {
    if (!this.phoneMode) return;
    this.phoneMode = null;
    this.setBadge(this.mood.badge);
    this.phone.kick(-3);
    this.burst("spark", 2);
    this.eyesFor("happy", 0.9);
    this.later(0.25, () => { this.phone.target = 0; });
  }

  /** Put the phone away without sending (the chat was dropped). */
  phoneAway() {
    this.phoneMode = null;
    this.setBadge(this.mood.badge);
    this.phone.target = 0;
  }

  // ── Expressions ────────────────────────────────────────────────────────────

  /** A short expression: the eyes change, with a matching little move. */
  triggerEmote(emote: BotEmoteName, duration = 1.8) {
    this.eyesFor(EMOTE_EYES[emote], duration);
    switch (emote) {
      case "love":
        this.blushFor(1, duration);
        this.burst("heart", 4);
        this.hop(1.4);
        break;
      case "surprised":
        this.hop(2.4);
        this.eyes.kick(4);
        break;
      case "proud":
        this.burst("star", 5);
        this.blushFor(0.7, duration);
        this.leanHold = { value: -0.14, until: now() + duration };
        break;
      case "wink":
        this.leanHold = { value: 0.12, until: now() + Math.max(0.3, duration - 0.3) };
        break;
      case "yawn":
        this.squashHold = { value: -0.12, until: now() + 0.6 };
        this.later(0.7, () => {
          this.eyeOverride = "closed";
          this.burst("z", 2);
        });
        break;
      case "happy":
        this.blushFor(0.6, 0.5);
        this.squash.kick(2);
        break;
      case "annoyed":
        this.eyesFor("line", 0.8);
        this.shift.kick(1.5);
        this.later(0.06, () => Sound.play("annoyed"));
        break;
    }
  }

  /** Mini characters only: a mood they keep, acted out every few seconds. */
  setPermanentEmote(emote: BotEmoteName | null) {
    this.permanentEmote = emote;
    this.permanentEye = emote && emote !== "wink" ? EMOTE_EYES[emote] : null;
    if (this.permanentEye) {
      this.eyeOverride = this.permanentEye;
      this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    } else if (this.eyeOverrideUntil === Number.POSITIVE_INFINITY) {
      this.eyeOverride = null;
    }
    this.nextMiniMove = now() + 0.8 + Math.random() * 1.7;
  }

  private miniMove() {
    switch (this.permanentEmote) {
      case "happy":
        this.hop(2.4);
        return 2.2 + Math.random() * 1.2;
      case "annoyed":
        this.shift.kick(1.5);
        this.later(0.08, () => this.shift.kick(-2.5));
        return 3 + Math.random() * 2.5;
      case "wink":
        this.eyesFor("wink", 0.55);
        this.lean.kick(1.5);
        return 2.2 + Math.random() * 2;
      case "love":
        this.burst("heart", 2);
        this.lean.kick(-1.4);
        return 2.6 + Math.random() * 1.5;
      default:
        return 3 + Math.random() * 2;
    }
  }

  // ── Frame ───────────────────────────────────────────────────────────────────

  /** True while anything still moves: the island stops its frame loop otherwise. */
  get busy(): boolean {
    return (
      this.live ||
      this.isMini ||
      this.mood.motion !== "still" ||
      this.timeline.length > 0 ||
      this.fx.length > 0 ||
      this.height > 0 || this.rise > 0 ||
      this.squashHold !== null || this.leanHold !== null ||
      !this.squash.resting || !this.lean.resting || !this.shift.resting ||
      !this.eyes.resting ||
      Math.abs(this.blush - this.blushTarget) > 0.01 ||
      Math.abs(this.arms - this.armsTarget) > 0.01 ||
      this.phoneMode !== null || !this.phone.resting || this.phone.value > 0.01 ||
      this.badgePop < 0.99 ||
      Math.abs(this.tint - this.mood.tint) > 0.005 ||
      this.color.some((c, i) => Math.abs(c - this.mood.color[i]) > 0.004) ||
      now() - this.blinkAt < 0.25 ||
      // Spinning eyes (dizzy spiral, proud star) need frames while they show.
      (this.eyeOverride === "spiral" || this.eyeOverride === "star") && now() < this.eyeOverrideUntil
    );
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    const t = now();
    const life = t - this.t0;

    // Timeline.
    if (this.timeline.length) {
      const due = this.timeline.filter((e) => e.at <= t);
      this.timeline = this.timeline.filter((e) => e.at > t);
      for (const e of due) e.run();
    }

    // Idle motion of the mood.
    let leanGoal = this.lookX * 0.05;
    let squashGoal = 0;
    switch (this.mood.motion) {
      case "hop":
        if (t > this.nextHop && this.height === 0 && this.rise === 0) {
          this.hop(1.7);
          this.nextHop = t + 0.75;
        }
        break;
      case "sway":
        leanGoal += 0.17 + Math.sin(life * 2) * 0.03;
        break;
      case "breathe":
        squashGoal = Math.sin(life * 1.8) * (this.isMini ? 0.07 : 0.04);
        break;
      case "droop":
        squashGoal = 0.06 + Math.sin(life * 1.3) * 0.015;
        leanGoal += 0.05;
        break;
    }
    if (this.isMini && this.mood.motion === "still") squashGoal = Math.sin(life * 2.2) * 0.035;
    if (this.isMini && this.permanentEmote && t > this.nextMiniMove) this.nextMiniMove = t + this.miniMove();

    // Squash: held (press, splat, stretch) or free.
    // Let go of a hold: the spring overshoots back up on its own — the jiggle.
    if (this.squashHold && t > this.squashHold.until) this.squashHold = null;
    if (this.leanHold && t > this.leanHold.until) this.leanHold = null;
    this.squash.target = this.squashHold ? this.squashHold.value : squashGoal;
    this.lean.target = this.leanHold ? this.leanHold.value : leanGoal;
    this.eyes.target = this.tgEs;

    // The hop.
    if (this.height > 0 || this.rise > 0) {
      this.rise -= GRAVITY * dt;
      this.height += this.rise * dt;
      if (this.height <= 0) {
        // Landing: squash by how hard it came down.
        this.squash.kick(Math.min(6, -this.rise * 1.3));
        this.height = 0;
        this.rise = 0;
        const land = this.onLand;
        this.onLand = null;
        land?.();
      }
    }

    for (const s of [this.squash, this.lean, this.shift, this.eyes, this.phone]) s.step(dt);
    if (this.phone.target === 0 && this.phone.value < 0) this.phone.value = this.phone.velocity = 0;

    // Face.
    if (t > this.nextBlink) {
      if (this.state !== "sleeping" && this.state !== "dizzy") {
        this.blink();
        if (Math.random() < 0.2) this.later(0.24, () => this.blink());
      }
      this.nextBlink = t + 2.4 + Math.random() * 3.2;
    }
    if (this.eyeOverride && t > this.eyeOverrideUntil) {
      this.eyeOverride = this.permanentEye;
      if (this.permanentEye) this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    }
    if (t > this.blushUntil) this.blushTarget = 0;
    const ease = (k: number) => 1 - Math.pow(k, dt);
    this.blush += (this.blushTarget - this.blush) * ease(0.002);
    this.arms += (this.armsTarget - this.arms) * ease(0.0005);
    if (this.gaze && t > this.gaze.until) this.gaze = null;

    // Colour and badge.
    const c = ease(0.004);
    this.color = this.color.map((v, i) => v + (this.mood.color[i] - v) * c) as unknown as RGB;
    this.tint += (this.mood.tint - this.tint) * c;
    this.badgePop += (1 - this.badgePop) * ease(0.0001);

    // Ambient effects: Zs while asleep, sweat when rate-limited.
    if (t > this.nextAmbient) {
      this.nextAmbient = t + 1.4;
      if (this.mood.motion === "breathe") this.burst("z", 1);
      if (this.state === "ratelimit" && !this.isMini && Math.random() < 0.5) this.burst("sweat", 1);
    }
    this.fx = stepFx(this.fx, dt);
  }

  /** Where the eyes look, −1…1: a fidget, the mood, a wandering mini, or the cursor. */
  private gazeNow(life: number): { x: number; y: number } {
    if (this.gaze) return this.gaze;
    // Reading or typing: eyes down on the screen, with a little left-right read.
    if (this.phoneMode) {
      return this.phoneMode === "read"
        ? { x: Math.sin(life * 5) * 0.3, y: -0.8 }
        : { x: Math.sin(life * 1.7) * 0.15, y: -0.85 };
    }
    switch (this.mood.motion) {
      case "scan":
        return { x: Math.sin(life * 2.6) * 0.9, y: 0.1 };
      case "ponder":
        return { x: 0.6 + this.lookX * 0.2, y: 0.6 };
      case "breathe":
        return { x: 0, y: -0.4 };
    }
    if (this.state === "dizzy") return { x: Math.sin(life * 7) * 0.2, y: 0 };
    if (this.isMini) {
      const t = now();
      if (t > this.miniGaze.next) {
        this.miniGaze = { x: Math.random() * 1.8 - 0.9, y: Math.random() * 1.2 - 0.5, next: t + 0.5 + Math.random() * 1.5 };
      }
      return this.miniGaze;
    }
    return { x: this.lookX, y: this.lookY };
  }

  // ── Draw ────────────────────────────────────────────────────────────────────

  /** Draws the jelly into a canvas of `W`×`H` CSS pixels (DPR already applied). */
  draw(x: CanvasRenderingContext2D, W: number, H: number) {
    const R = W * 0.3;
    const life = now() - this.t0;
    const cx = W / 2 + this.shift.value * R;
    const cy = H / 2 + this.particleOverhang / 2 + R * 0.14 - this.height * R;
    const floor = BODY.base * R; // squash pivots on the floor under the body

    // Squash keeps the volume: flatter is wider. Clamped, so even a wild
    // wobble never turns the jelly inside out.
    const s = Math.max(-0.4, Math.min(0.7, this.squash.value));
    const sy = 1 - s;
    const sx = 1 + s * 0.65;
    const gaze = this.gazeNow(life);

    x.save();
    x.translate(cx, cy);
    x.translate(0, floor);
    x.rotate(this.lean.value);
    x.scale(sx, sy);
    x.translate(0, -floor);
    // The jelly's own idle wobble, only while someone is looking.
    if (this.live) {
      const w = Math.sin(life * 2) * 0.025;
      x.translate(0, floor);
      x.scale(1 + w, 1 - w);
      x.translate(0, -floor);
    }

    const look = this.look ?? LOOKS.tute;
    const accShift = gaze.x * R * 0.16;
    const accRy = R * BODY.top * 1.1;
    if (this.look) drawAccessory(x, this.look, R, accRy, "back", accShift);
    if (this.arms > 0.01 && !this.isMini) this.drawArms(x, R, look);

    const body = puddlePath(R, this.live ? life : 0);
    if (this.bodyColor) {
      // Minis: a flat solid body, no jelly, no bubbles.
      x.fillStyle = rgba(this.bodyColor);
      x.fill(body);
    } else {
      drawJelly(x, body, R, look, { time: this.live ? life : 0, tint: { rgb: this.color, amount: this.tint } });
    }

    x.save();
    x.clip(body);
    this.drawCheeks(x, R, gaze);
    this.drawEyes(x, R, gaze, life);
    if (this.phone.value > 0.05) this.drawScreenGlow(x, R);
    x.restore();

    if (this.phone.value > 0.02) this.drawPhone(x, R, look, life);
    if (this.look) drawAccessory(x, this.look, R, accRy, "front", accShift);
    x.restore();

    if (this.badge) {
      const bx = cx - R * 0.74 * sx;
      const by = cy - R * 0.72 * sy;
      drawBadge(x, this.badge, R, bx, by, this.badgePop * (this.isMini ? 1.25 : 1), life, this.isMini);
    }
    drawFx(x, this.fx, R, cx, cy);
  }

  private drawEyes(x: CanvasRenderingContext2D, R: number, gaze: { x: number; y: number }, life: number) {
    const shape = this.eyeOverride ?? this.mood.eyes;
    const ink = this.isMini ? MINI_INK : INK;
    const w = R * EYE_W * this.eyes.value * (this.isMini ? 1.9 : 1);
    // A blink: the lid closes and opens again in a quarter of a second.
    const since = now() - this.blinkAt;
    const lid = since < 0.22 ? Math.max(0.08, Math.abs(1 - since / 0.11)) : 1;
    const gx = gaze.x * R * 0.15;
    // Looking down at the phone drops the eyes further than the cursor can.
    const gy = -gaze.y * R * 0.09 + Math.min(1, Math.max(0, this.phone.value)) * R * 0.07;
    for (const side of [-1, 1]) {
      // The eye on the side it looks towards gets a bit closer, the other a bit narrower.
      const near = 1 + side * gaze.x * 0.06;
      x.save();
      x.translate(side * R * EYE_GAP + gx, R * EYE_Y + gy);
      x.scale(near, 1);
      drawEye(x, shape, w, side, lid, ink, life);
      const open = shape === "pill" || shape === "wide" || (shape === "wink" && side < 0);
      if (this.look?.lashes && open) {
        const k = shape === "wide" ? 1.18 : 1;
        drawLashes(x, side, w * k, -Math.max(w * k * 0.54 * lid, w * 0.15), ink);
      }
      x.restore();
    }
  }

  private drawCheeks(x: CanvasRenderingContext2D, R: number, gaze: { x: number; y: number }) {
    const amount = Math.max(this.blush, this.tint * 0.5, this.look?.blush ?? 0);
    if (amount < 0.01) return;
    x.fillStyle = `rgba(255,120,150,${0.5 * amount})`;
    for (const side of [-1, 1]) {
      x.beginPath();
      x.ellipse(side * R * 0.62 + gaze.x * R * 0.1, R * 0.12, R * 0.16, R * 0.09, 0, 0, Math.PI * 2);
      x.fill();
    }
  }

  /** The phone's light on the lower face. */
  private drawScreenGlow(x: CanvasRenderingContext2D, R: number) {
    const k = Math.min(1, this.phone.value);
    const g = x.createRadialGradient(0, R * 0.25, 0, 0, R * 0.25, R * 0.7);
    g.addColorStop(0, `rgba(120,190,255,${0.32 * k})`);
    g.addColorStop(1, "rgba(120,190,255,0)");
    x.fillStyle = g;
    x.fillRect(-R, -R * 0.5, R * 2, R * 1.2);
  }

  /**
   * A little phone held in front of the body by two jelly hands. Reading: a
   * message bubble slides in. Typing: the thumbs tap in turn and a draft line
   * grows at the bottom of the screen.
   */
  private drawPhone(x: CanvasRenderingContext2D, R: number, look: Look, life: number) {
    const t = now();
    const s = Math.max(0, this.phone.value);
    const buzz = t < this.phoneBuzzUntil ? Math.sin(t * 95) * R * 0.035 : 0;
    const typing = this.phoneMode === "type";
    const since = t - this.phoneSince;
    const w = R * 0.66, hgt = R * 0.86, rad = R * 0.12;

    x.save();
    // Held low in front, tipped back towards the face.
    x.translate(R * 0.02 + buzz, R * 0.5 + (1 - Math.min(1, s)) * R * 0.4);
    x.rotate(-0.08 + (typing ? Math.sin(life * 3) * 0.025 : 0));
    x.scale(s, s);

    // The phone: a dark frame, a bright chat screen (it has to read at island size).
    x.beginPath();
    x.roundRect(-w / 2, -hgt / 2, w, hgt, rad);
    x.fillStyle = "#151a24";
    x.fill();
    x.lineWidth = Math.max(0.8, R * 0.025);
    x.strokeStyle = "rgba(255,255,255,0.4)";
    x.stroke();
    const inset = R * 0.04;
    const sw = w - inset * 2, sh = hgt - inset * 2;
    x.beginPath();
    x.roundRect(-sw / 2, -sh / 2, sw, sh, rad * 0.65);
    x.fillStyle = "#dbe8f2";
    x.fill();
    x.save();
    x.clip();
    // Header strip.
    x.fillStyle = "#2aabee";
    x.fillRect(-sw / 2, -sh / 2, sw, sh * 0.17);
    // The chat: their bubbles on the left (slide in on arrival), ours on the right.
    const bubble = (bx: number, by: number, bw: number, color: string) => {
      x.beginPath();
      x.roundRect(bx, by, bw, sh * 0.12, sh * 0.06);
      x.fillStyle = color;
      x.fill();
    };
    const pad = sw * 0.08;
    const slide = 1 - Math.pow(1 - Math.min(1, since / 0.35), 3);
    bubble(-sw / 2 + pad - (1 - slide) * sw, -sh * 0.24, sw * 0.62, "#ffffff");
    bubble(-sw / 2 + pad - (1 - slide) * sw, -sh * 0.07, sw * 0.42, "#ffffff");
    if (typing) {
      // Our answer grows, sends, grows again: thumbs at work.
      const grow = (since * 0.6) % 1;
      bubble(sw / 2 - pad - sw * 0.7 * grow, sh * 0.12, sw * 0.7 * grow, "#8fdc7a");
    }
    x.restore();

    // Two jelly hands round the lower corners; while typing the thumbs tap in turn.
    for (const side of [-1, 1]) {
      const tap = typing ? Math.max(0, Math.sin(life * 15 + (side > 0 ? Math.PI : 0))) : 0;
      x.save();
      x.translate(side * w * 0.5, hgt * 0.32);
      x.beginPath();
      x.ellipse(0, 0, R * 0.13, R * 0.17, side * 0.35, 0, Math.PI * 2);
      x.fillStyle = `rgba(${look.rgb},0.9)`;
      x.fill();
      x.strokeStyle = look.body;
      x.lineWidth = Math.max(0.8, R * 0.035);
      x.stroke();
      // The thumb: just over the screen's bottom corner, pressing in on a tap.
      x.translate(-side * (R * 0.1 + tap * R * 0.05), -R * 0.1 - tap * R * 0.04);
      x.beginPath();
      x.ellipse(0, 0, R * 0.06, R * 0.08, -side * 0.7, 0, Math.PI * 2);
      x.fill();
      x.stroke();
      x.restore();
    }
    x.restore();
  }

  /** Two little jelly arms, raised in a stretch. */
  private drawArms(x: CanvasRenderingContext2D, R: number, look: Look) {
    const k = this.arms;
    for (const side of [-1, 1]) {
      x.save();
      x.translate(side * R * 0.9, -R * (0.05 + 0.45 * k));
      x.rotate(side * (0.9 - 0.5 * k));
      x.beginPath();
      x.ellipse(0, 0, R * 0.13, R * 0.24 * (0.6 + 0.4 * k), 0, 0, Math.PI * 2);
      x.fillStyle = `rgba(${look.rgb},0.75)`;
      x.fill();
      x.strokeStyle = look.body;
      x.lineWidth = Math.max(0.8, R * 0.05);
      x.stroke();
      x.restore();
    }
  }
}
