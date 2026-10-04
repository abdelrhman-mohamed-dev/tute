// App state — everything the island renders from.

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../jelly/engine";
import type { Personality } from "../jelly/looks";
import type { ClaudeAsk, LinearFinished, LinearIssue, LinearStatus, LinearTeam } from "./bridge";
import type { Level } from "../island/bond";

export type PillBadge = "approval" | "finished" | "error";

/**
 * Something the island tracks: shown as the focused card in the overview and as
 * a pill / mini-bot for the others. Claude Code sessions are tasks (see
 * island/claude.ts); anything else can be added with `State.addTask`.
 */
export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  /** Short label next to the name in the overview card. */
  label?: string;
  emote?: BotEmoteName | null;
  /** A session started by "Do it with Claude": the Linear issue it works on. */
  issue?: IssueLink;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
}

/** A Claude session working on a Linear issue (island/claude.ts links them). */
export interface IssueLink {
  id: string;
  url: string;
  team: string;
  /** When Claude was started on it (ms), for "done by Claude · 14 min". */
  startedAt: number;
  /** "When done" ran: what it did. Undefined while Claude works. */
  finished?: LinearFinished | "posting" | { error: string };
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  absenceInterval: number;
  /** `monitor:<device name>` pins the island to one display. */
  screen: "primary" | "cursor" | `monitor:${string}`;
  autostart: boolean;
  /** Off: the small bar always stays at the top. On: it hides after a minute idle. */
  hideWhenIdle: boolean;
  /** Which character the user picked; null until the first-launch picker. */
  personality: Personality | null;
  /** AI providers. Keys are in the Windows Credential Manager, never here. */
  providers: Provider[];
  /** The model the island uses, if one is chosen. */
  activeModel: ActiveModel | null;
  /** The Linear team new issues go to: the last one picked on the island. */
  linearTeam: string | null;
  /** How the island chat talks: playful, or short and plain. */
  chatMode: "fun" | "focus";
  /** "Do it with Claude": the folder Claude works in, per Linear team name. */
  claudeFolders: Record<string, string>;
  /** When Claude finishes an issue: post its summary, move it to review. */
  claudeDoneComment: boolean;
  claudeDoneReview: boolean;
  /** The bond with the character (island/bond.ts); null until the first point. */
  bond: Bond | null;
}

/** Points, level and looks earned together. Lives in settings.json, on this PC only. */
export interface Bond {
  points: number;
  /** When the bond started (ms since epoch), for "together 23 days". */
  since: number;
  /** The highest level already celebrated, so each level-up shows once. */
  seen: number;
  /** Today's date (YYYY-MM-DD) and what has counted today, for the daily caps. */
  day: string;
  today: Partial<Record<"chat" | "claude" | "linear" | "pet", number>>;
  /** What it wears and its colour, once unlocked. */
  wear: "hat" | "crown" | null;
  skin: "mint" | "lemon" | "lilac" | null;
}

/** Which wire protocol a provider speaks (see src-tauri/src/ai.rs). */
export type ProviderKind = "openAi" | "anthropic";

export interface Provider {
  /** Also names the key in the Credential Manager. */
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  models: string[];
}

export interface ActiveModel {
  providerId: string;
  model: string;
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  absenceInterval: 180,
  screen: "primary",
  autostart: false,
  hideWhenIdle: false,
  personality: null,
  providers: [],
  activeModel: null,
  linearTeam: null,
  chatMode: "fun",
  claudeFolders: {},
  claudeDoneComment: true,
  claudeDoneReview: true,
  bond: null,
};

/** States in which a task is really doing something (or needs the user). */
const BUSY_STATES: ReadonlySet<BotStateName> = new Set([
  "working", "thinking", "searching", "approval",
]);

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "empty";

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;

  /** Cursor in logical screen pixels, origin top-left. */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  droppedFile: { name: string; path: string } | null = null;
  noteMessage: string | null = null;
  /** A level-up waiting to be celebrated (shown when the island next opens). */
  levelUp: Level | null = null;
  /** Claude questions and permission prompts waiting for an answer, oldest first. */
  asks: ClaudeAsk[] = [];
  /** Linear connection, for the home screen's quick action (null outside Tute). */
  linear: LinearStatus | null = null;
  /** Open issues assigned to the user (null until first loaded). */
  linearIssues: LinearIssue[] | null = null;
  linearTeams: LinearTeam[] | null = null;
  /** Why the last Linear call failed, shown in the issues view. */
  linearError: string | null = null;
  /** The last status change, offered as Undo for a few seconds. */
  linearUndo: { issue: LinearIssue; label: string } | null = null;
  /** The issue on the "Do it with Claude" card. */
  claudeIssue: LinearIssue | null = null;
  /** Claude windows just opened by Tute, waiting for their session to report in. */
  claudeLaunches: { issue: LinearIssue; at: number }[] = [];
  /** The island chat, kept until "New chat". */
  chatHistory: ChatMessage[] = [];

  lastActivity = performance.now();

  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
  }

  addTask(task: Pick<AgentTask, "id" | "name" | "color"> & Partial<AgentTask>) {
    if (this.tasks.some((t) => t.id === task.id)) return;
    this.tasks.push({ state: "idle", stepIndex: 0, steps: [], ...task });
    if (!this.focusId) this.focusId = task.id;
    this.notify();
  }

  removeTask(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.focusId === id) this.focusId = this.tasks[0]?.id ?? null;
    this.notify();
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    t.pillBadge = null;
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.steps.push(step);
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  defaultView(): IslandViewName {
    // A waiting Claude question is the first thing to see when the island opens.
    if (this.asks.length > 0) return "ask";
    if (this.levelUp) return "levelup";
    // The overview is for work in progress. Finished or idle sessions don't
    // hold the island: it goes back home (the empty view and its quick actions).
    return this.tasks.some((t) => BUSY_STATES.has(t.state)) ? "overview" : "empty";
  }
}

export const State = new AppState();
