// The bond: the character remembers what you've done together and grows with
// it. Points come from real use (chats, finished Claude turns, closed Linear
// issues, petting), each with a daily cap so nothing can be farmed, and they
// never go down — skipping a few days costs nothing. Every level unlocks
// something drawn in code: a move, something to wear, new colours.
//
// Everything lives in settings.json on this PC. Nothing is sent anywhere.

import { Bridge } from "../core/bridge";
import { State, type Bond } from "../core/state";

export type BondEvent = "chat" | "claude" | "linear" | "pet";
export type Unlock = "twirl" | "hat" | "sparkles" | "colours" | "crown";

const POINTS: Record<BondEvent, number> = { chat: 5, claude: 10, linear: 15, pet: 1 };
/** How many of each count per day. */
const DAILY_CAP: Record<BondEvent, number> = { chat: 20, claude: 10, linear: 10, pet: 20 };

export interface Level {
  level: number;
  name: string;
  /** Points needed to reach it. */
  at: number;
  unlock: Unlock | null;
}

export const LEVELS: Level[] = [
  { level: 1, name: "New friend", at: 0, unlock: null },
  { level: 2, name: "Pals", at: 100, unlock: "twirl" },
  { level: 3, name: "Buddies", at: 300, unlock: "hat" },
  { level: 4, name: "Best buds", at: 600, unlock: "sparkles" },
  { level: 5, name: "Soulmates", at: 1000, unlock: "colours" },
  { level: 6, name: "Legends", at: 1600, unlock: "crown" },
];

/** What a level-up card says it unlocked. */
export const UNLOCK_TEXT: Record<Unlock, string> = {
  twirl: "a new move: the twirl. Double-click me!",
  hat: "a party hat 🎉",
  sparkles: "sparkly pets ✨ Petting me sparkles now.",
  colours: "new colours: mint, lemon and lilac 🌈",
  crown: "a crown 👑",
};

/** Short names for the bond screen. */
export const UNLOCK_SHORT: Record<Unlock, string> = {
  twirl: "the twirl",
  hat: "🎉 party hat",
  sparkles: "✨ sparkly pets",
  colours: "🌈 colours",
  crown: "👑 crown",
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The bond, created on first use. */
export function bond(): Bond {
  State.settings.bond ??= {
    points: 0,
    since: Date.now(),
    seen: 1,
    day: today(),
    today: {},
    wear: null,
    skin: null,
  };
  return State.settings.bond;
}

export function levelFor(points: number): Level {
  return [...LEVELS].reverse().find((l) => points >= l.at) ?? LEVELS[0];
}

export function nextLevel(points: number): Level | null {
  return LEVELS.find((l) => l.at > points) ?? null;
}

/** Is this unlocked yet? */
export function has(unlock: Unlock): boolean {
  const need = LEVELS.find((l) => l.unlock === unlock);
  return !!need && (State.settings.bond?.points ?? 0) >= need.at;
}

export function daysTogether(): number {
  const since = State.settings.bond?.since ?? Date.now();
  return Math.max(1, Math.floor((Date.now() - since) / 86_400_000) + 1);
}

// ── Saving (debounced: a petting spree is one write, not twenty) ─────────────

let saveTimer: number | null = null;

export function saveBond(now = false) {
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = null;
  if (now) {
    void Bridge.saveSettings(State.settings);
    return;
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void Bridge.saveSettings(State.settings);
  }, 2000);
}

// ── Earning ──────────────────────────────────────────────────────────────────

let levelUpHandler: ((level: Level) => void) | null = null;

/** The island celebrates through this (island.ts). */
export function onLevelUp(fn: (level: Level) => void) {
  levelUpHandler = fn;
}

/** Something worth a point happened. Quietly does nothing past the daily cap. */
export function award(event: BondEvent) {
  const b = bond();
  if (b.day !== today()) {
    b.day = today();
    b.today = {};
  }
  const count = b.today[event] ?? 0;
  if (count >= DAILY_CAP[event]) return;
  b.today[event] = count + 1;
  b.points += POINTS[event];
  saveBond();

  const level = levelFor(b.points);
  if (level.level > b.seen) {
    b.seen = level.level;
    saveBond(true);
    levelUpHandler?.(level);
  }
  State.notify();
}

/** An Undo took back what earned the points (a Linear "Done"). */
export function unaward(event: BondEvent) {
  const b = bond();
  const count = b.today[event] ?? 0;
  if (count <= 0) return;
  b.today[event] = count - 1;
  b.points = Math.max(0, b.points - POINTS[event]);
  saveBond();
  State.notify();
}

export function setWear(wear: Bond["wear"]) {
  bond().wear = wear;
  saveBond(true);
}

export function setSkin(skin: Bond["skin"]) {
  bond().skin = skin;
  saveBond(true);
}
