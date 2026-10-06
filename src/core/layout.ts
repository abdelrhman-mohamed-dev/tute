// The island's geometry: how big it is in each mode and view, where the jelly
// sits, and the colours that go with a mood. All values are logical pixels.

export type IslandMode = "hidden" | "compact" | "expanded";

export type IslandViewName =
  | "overview"
  | "empty"
  | "error"
  | "approval"
  | "ask"
  | "linear"
  | "linear-new"
  | "linear-claude"
  | "obsidian"
  | "levelup"
  | "bond"
  | "finished"
  | "confused"
  | "upload"
  | "uploading"
  | "choose"
  | "note"
  | "settings"
  | "greeting"
  | "personality"
  | "prompt";

export type BotStateName =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "ratelimit"
  | "sleeping"
  | "dizzy";

export type BotEmoteName = "love" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";

// ── Sizes ─────────────────────────────────────────────────────────────────────

/** The window: big enough for the tallest view; the island is drawn inside it, top centre. */
export const PANEL_W = 720;
export const PANEL_H = 320;

/** The small bar: a pill with the jelly at its left end. */
export const COMPACT_W = 288;
export const BAR_H = 34;
/** Hidden, the island keeps its width and folds its height to nothing. */
export const HIDDEN_W = 184;
/** Open, every view is this wide. */
export const EXPANDED_W = 640;

/** Corner radius: the bar is fully round, the open island softly so. */
export const ROUNDED_CORNER = BAR_H / 2;
export const EXPANDED_CORNER = 18;

/** Where the jelly sits in the bar (x from the bar's left edge). */
export const BAR_JELLY = { x: 30, y: BAR_H / 2, size: 22 };

/** Below the header (tabs and buttons) is where a view's content starts. */
const HEADER_H = 42;

/**
 * Per view: [height, jelly x, jelly size, jelly y]. Without a y the jelly is
 * centred in the space under the header.
 */
type ViewSpec = readonly [height: number, x: number, size: number, y?: number];

const VIEWS: Record<IslandViewName, ViewSpec> = {
  overview: [160, 68, 58],
  empty: [160, 70, 62],
  error: [160, 62, 58],
  approval: [160, 62, 58],
  finished: [160, 62, 58],
  confused: [160, 76, 66],
  note: [160, 60, 50],
  levelup: [160, 66, 60],
  settings: [184, 54, 46],
  "linear-new": [176, 56, 50],
  "linear-claude": [214, 56, 50],
  obsidian: [214, 56, 50],
  prompt: [240, 52, 44],
  ask: [244, 56, 50],
  linear: [244, 56, 50],
  bond: [262, 56, 50],
  // The drop sequence (src/upload) draws its own jelly; these are its fallback spots.
  upload: [176, 140, 62, 104],
  uploading: [176, 46, 20, 103],
  choose: [176, 60, 52, 101],
  // These two draw their characters themselves, so the island's own is hidden.
  greeting: [150, 320, 0, 90],
  personality: [176, 320, 0, 90],
};

/** Each view's height (the island controller compares them to pick grow or shrink). */
export const VIEW_LAYOUTS = Object.fromEntries(
  Object.entries(VIEWS).map(([name, [height]]) => [name, { height }]),
) as Record<IslandViewName, { height: number }>;

/** The chat grows with the conversation, up to the window's height. */
function chatHeight(messageCount: number): number {
  return Math.min(300, 240 + messageCount * 20);
}

export function islandSize(mode: IslandMode, view: IslandViewName, chatCount = 0): { w: number; h: number } {
  if (mode === "hidden") return { w: HIDDEN_W, h: 0 };
  if (mode === "compact") return { w: COMPACT_W, h: BAR_H };
  return { w: EXPANDED_W, h: view === "prompt" ? chatHeight(chatCount) : VIEWS[view][0] };
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

/** Where the jelly is drawn; cy is measured from the island's top edge. */
export function botPosition(
  mode: IslandMode,
  view: IslandViewName,
  islandH: number,
  uploadProgress = 0,
): BotPlacement {
  if (mode !== "expanded") {
    const { x, y, size } = BAR_JELLY;
    return mode === "hidden"
      ? { cx: x, cy: y, diameter: size * 0.3, opacity: 0 }
      : { cx: x, cy: y, diameter: size, opacity: 1 };
  }
  const [, x, size, y] = VIEWS[view];
  // While a file is copied the jelly rides along the progress bar.
  if (view === "uploading") return { cx: 36 + uploadProgress * 526, cy: y ?? 103, diameter: size, opacity: 1 };
  return { cx: x, cy: y ?? HEADER_H + (islandH - HEADER_H) / 2, diameter: size, opacity: 1 };
}

// ── Colours ───────────────────────────────────────────────────────────────────

/** The soft glow behind the jelly, by mood (the same hues as the engine's moods). */
const GLOW: Partial<Record<BotStateName, string>> = {
  working: "#3E9BFF",
  thinking: "#8B66F4",
  searching: "#6468F2",
  approval: "#F6A62A",
  question: "#26D0EC",
  error: "#F2525F",
  finished: "#36D39A",
  ratelimit: "#FA933E",
};

export function botGlowColor(s: BotStateName): string {
  return GLOW[s] ?? "#FFFFFF";
}

export function botGlowOpacity(s: BotStateName): number {
  if (s === "dizzy") return 0;
  return s === "idle" || s === "sleeping" ? 0.15 : 0.6;
}

/** Colours for sessions (Claude Code), picked by name so a project keeps its colour. */
export const TASK_COLORS = ["#34D399", "#F4C542", "#60A5FA", "#E879F9", "#FB923C", "#8B7CF6"];

export function colorForName(name: string): string {
  // FNV-1a: a tiny, well-spread string hash.
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return TASK_COLORS[(hash >>> 0) % TASK_COLORS.length];
}

/** A card's tint, by mood. */
export type Wash = "red" | "green" | "pink" | "amber" | "cyan" | "indigo" | "soft" | null;

const WASH: Record<Exclude<Wash, null>, string> = {
  red: "rgba(242,82,95,0.5)",
  green: "rgba(54,211,154,0.45)",
  pink: "rgba(242,115,181,0.5)",
  amber: "rgba(246,166,42,0.4)",
  cyan: "rgba(38,208,236,0.36)",
  indigo: "rgba(100,104,242,0.45)",
  soft: "rgba(255,255,255,0.08)",
};

export function washRGBA(wash: Wash): string {
  return wash ? WASH[wash] : "rgba(0,0,0,0)";
}
