// The island's state: everything it draws from, in one place. Whoever
// changes something calls `notify()`, and the island redraws on its next frame.

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../jelly/engine";
import type { Personality } from "../jelly/looks";
import type { ClaudeAsk, LinearFinished, LinearIssue, LinearStatus, LinearTeam } from "./bridge";
import type { Level } from "../island/bond";

export type PillBadge = "approval" | "finished" | "error";

/**
 * Something running that the island follows: the focused one gets the
 * overview's step trail, the others a pill and a mini jelly. Claude Code
 * sessions are tasks (island/claude.ts).
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
  /** A chat that's browsing (views/chat.ts): Watch and Stop show beside it. */
  browse?: { sources: WebSource[] };
}

/** Something Tute remembers about you (src-tauri/src/memory.rs). */
export interface MemoryItem {
  id: string;
  text: string;
  /** When it was saved, ms since 1970. */
  at: number;
}

/** A page an answer rests on. */
export interface WebSource {
  title: string;
  url: string;
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
  /** A browsing task (the question) or its answer, which has sources. */
  browse?: boolean;
  sources?: WebSource[];
  /** What this answer made Tute remember (each can be undone). */
  remembered?: MemoryItem[];
  /** Memories that shaped this answer. */
  used?: string[];
}

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  /** `monitor:<device name>` pins the island to one display. */
  screen: "primary" | "cursor" | `monitor:${string}`;
  autostart: boolean;
  /** Off: the bar always stays at the top. On: it hides when nothing's going on. */
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
  /** The chat remembers lasting things you tell it. */
  memoryOn: boolean;
  /** Saved chats untouched this many days are deleted; 0 keeps them all. */
  chatKeepDays: number;
  /** The Obsidian vault Tute writes to (its folder); null until one is chosen. */
  obsidianVault: string | null;
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
  memoryOn: true,
  chatKeepDays: 30,
  obsidianVault: null,
  bond: null,
};

/** A task in one of these is doing something (or needs you). */
const BUSY: ReadonlySet<BotStateName> = new Set(["working", "thinking", "searching", "approval"]);

class IslandState {
  // ── Where the island is ──
  mode: IslandMode = "hidden";
  view: IslandViewName = "empty";
  /** An alert that waits for an answer: the island won't close by itself. */
  isPinned = false;
  /** Paused from the tray: hidden, and nothing pops up. */
  paused = false;
  lastActivity = performance.now();

  // ── The cursor ──
  /** In window pixels, from the top-left. */
  mouse = { x: 0, y: 0 };
  /** The same, from the island's own top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  // ── What's running ──
  tasks: AgentTask[] = [];
  focusId: string | null = null;
  /** A mood that wins over the focused task's (asleep, dizzy). */
  stateOverride: BotStateName | null = null;

  // ── A dropped file ──
  fileDragOver = false;
  droppedFile: { name: string; path: string } | null = null;
  uploadProgress = 0;
  /** How long the absorb animation's bubbles take to fill, in seconds. */
  uploadDuration = 2.4;

  // ── Cards ──
  /** The note card's line. */
  noteMessage: string | null = null;
  /** A level-up still to celebrate (shown when the island next opens). */
  levelUp: Level | null = null;
  /** Claude's questions and permission prompts, oldest first. */
  asks: ClaudeAsk[] = [];
  /** The chat on screen, and its saved id (null until its first message is saved). */
  chatHistory: ChatMessage[] = [];
  chatId: string | null = null;

  // ── Linear and Claude ──
  /** The Linear connection (null outside the app). */
  linear: LinearStatus | null = null;
  /** Open issues assigned to you; null until loaded. */
  linearIssues: LinearIssue[] | null = null;
  linearTeams: LinearTeam[] | null = null;
  /** Why the last Linear call failed (the issues card shows it). */
  linearError: string | null = null;
  /** The last move, offered as Undo for a few seconds. */
  linearUndo: { issue: LinearIssue; label: string } | null = null;
  /** The issue on the "Do it with Claude" card. */
  claudeIssue: LinearIssue | null = null;
  /** Claude windows Tute just opened, waiting for their session to report in. */
  claudeLaunches: { issue: LinearIssue; at: number }[] = [];

  settings: Settings = { ...DEFAULT_SETTINGS };

  private watchers = new Set<() => void>();

  subscribe(watcher: () => void): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  /** Something changed: the island redraws on its next frame. */
  notify() {
    this.watchers.forEach((w) => w());
  }

  // ── Tasks ──

  get focusTask(): AgentTask | null {
    return this.task(this.focusId) ?? this.tasks[0] ?? null;
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
  }

  /** The mood the jelly shows: an override, else the focused task's, else idle. */
  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  private task(id: string | null): AgentTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  /** Changes one task (if it's there) and redraws. */
  private change(id: string, edit: (t: AgentTask) => void) {
    const t = this.task(id);
    if (!t) return;
    edit(t);
    this.notify();
  }

  addTask(task: Pick<AgentTask, "id" | "name" | "color"> & Partial<AgentTask>) {
    if (this.task(task.id)) return;
    this.tasks.push({ state: "idle", stepIndex: 0, steps: [], ...task });
    this.focusId ??= task.id;
    this.notify();
  }

  removeTask(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.focusId === id) this.focusId = this.tasks[0]?.id ?? null;
    this.notify();
  }

  /** Brings a task to the front (and clears its pill's badge: you've seen it). */
  setFocus(id: string) {
    this.change(id, (t) => {
      this.focusId = id;
      t.pillBadge = null;
    });
  }

  updateTask(id: string, state: BotStateName) {
    this.change(id, (t) => (t.state = state));
  }

  /** A new step for the trail; the last 20 are kept. */
  appendStep(id: string, step: string) {
    this.change(id, (t) => {
      t.steps = [...t.steps, step].slice(-20);
      t.stepIndex = t.steps.length - 1;
    });
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    this.change(id, (t) => (t.pillBadge = badge));
  }

  /** What the island opens on: a waiting question, a level-up, the work, or home. */
  defaultView(): IslandViewName {
    if (this.asks.length) return "ask";
    if (this.levelUp) return "levelup";
    // The overview is for work in progress; done or idle sessions don't hold it.
    return this.tasks.some((t) => BUSY.has(t.state)) ? "overview" : "empty";
  }
}

export const State = new IslandState();
