// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Settings } from "./state";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[tute] ${cmd} failed`, err);
    return null;
  }
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside Tute");
  return invoke<T>(cmd, args);
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor watcher, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (for a text field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),

  /** Connected displays, for the "Island lives on" picker. */
  listMonitors: () => call<MonitorInfo[]>("list_monitors"),

  openUrl: (url: string) => call<void>("open_url", { url }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Writes to %LOCALAPPDATA%\Tute\tute.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),

  /** Deletes an inbox copy. Rust refuses anything outside the inbox. */
  discardFile: (path: string) => call<void>("discard_file", { path }),

  // ── AI providers ──────────────────────────────────────────────────────────
  /** Stores a key in the Credential Manager (empty removes it). Never readable back. */
  providerKeySet: (providerId: string, key: string) =>
    callOrThrow<void>("provider_key_set", { providerId, key }),
  providerKeyPresent: (providerId: string) => call<boolean>("provider_key_present", { providerId }),
  providerKeyClear: (providerId: string) => call<void>("provider_key_clear", { providerId }),
  /** Same https-only rule Rust applies before any request. */
  checkProviderUrl: (url: string) => callOrThrow<void>("check_provider_url", { url }),
  /** Asks the provider for its model list. The provider must be saved first. */
  aiListModels: (providerId: string) => callOrThrow<string[]>("ai_list_models", { providerId }),
  /** Sends one short message to the model; the reply and how long it took. */
  aiTest: (providerId: string, model: string) =>
    callOrThrow<{ reply: string; millis: number }>("ai_test", { providerId, model }),
  /**
   * One chat turn with the active model. The reply also streams in as
   * `chat-delta` events ({ requestId, text }) while this is pending.
   */
  aiChat: (requestId: number, messages: { role: string; content: string }[]) =>
    callOrThrow<string>("ai_chat", { requestId, messages }),
};

export interface MonitorInfo {
  /** Value to store in `Settings.screen`. */
  id: `monitor:${string}`;
  label: string;
  primary: boolean;
}

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/**
 * Files dragged onto the island. Only reaches us when the window takes the mouse.
 * Arrives as Tauri's own drag events or, since WebView2 154 took those over, as
 * `file-drag` from the island's own drop target (see catcher.rs).
 */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  const offTauri = await getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
  const offOwn = await listen<DragDropPayload>("file-drag", (e) => handler(e.payload));
  return () => {
    offTauri();
    offOwn();
  };
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}

// ── Claude Code ─────────────────────────────────────────────────────────────

export interface ClaudeHooksStatus {
  /** Tute's hooks are in ~/.claude/settings.json. */
  installed: boolean;
  /** The listener is up (false: another program holds the port). */
  listening: boolean;
  port: number;
  settingsPath: string;
}

export const ClaudeBridge = {
  status: () => call<ClaudeHooksStatus>("claude_hooks_status"),
  install: () => callOrThrow<ClaudeHooksStatus>("claude_hooks_install"),
  remove: () => callOrThrow<ClaudeHooksStatus>("claude_hooks_remove"),
};

/** One Claude Code hook, trimmed by Rust (src-tauri/src/claude.rs). */
export interface ClaudeEvent {
  event: string;
  sessionId: string;
  cwd: string;
  tool: string | null;
  detail: string | null;
  kind: string | null;
  text: string | null;
}

export interface ClaudeQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

/** A question (AskUserQuestion) or permission prompt waiting for the island. */
export interface ClaudeAsk {
  requestId: number;
  kind: "question" | "permission";
  sessionId: string;
  cwd: string;
  tool: string | null;
  detail: string | null;
  questions: ClaudeQuestion[] | null;
}

/** What the island answers: picked labels per question, or allow / deny. */
export type ClaudeReply =
  | { answers: Record<string, string> }
  | { decision: "allow" | "deny" };

/** Sends the answer back; null = "answer in the terminal". */
export const claudeReply = (requestId: number, reply: ClaudeReply | null) =>
  call<void>("claude_reply", { requestId, reply });

/** Questions Rust is still holding, oldest first (after a reload of the island). */
export const claudeWaiting = () => call<ClaudeAsk[]>("claude_waiting");

// ── Linear ──────────────────────────────────────────────────────────────────

/** Whether Linear is connected, and as whom. The tokens never leave Rust. */
export interface LinearStatus {
  connected: boolean;
  /** Connect was pressed; waiting for the browser to come back. */
  signingIn: boolean;
  user: string | null;
}

export const LinearBridge = {
  status: () => call<LinearStatus>("linear_status"),
  /** Opens Linear's consent page; the result arrives as `linear-changed`. */
  connect: () => callOrThrow<void>("linear_connect"),
  disconnect: () => callOrThrow<void>("linear_disconnect"),
};

export interface LinearIssue {
  /** The identifier, e.g. DEV-2283. */
  id: string;
  title: string;
  url: string;
  /** The team's own name for it ("🔁 Changes Requested"). */
  status: string;
  /** triage | backlog | unstarted | started | completed | canceled */
  statusType: string;
  /** 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: number;
  team: string;
}

export interface LinearTeam {
  id: string;
  name: string;
}

export interface LinearCreated {
  id: string;
  url: string;
}

export const LinearApi = {
  myIssues: () => callOrThrow<LinearIssue[]>("linear_my_issues"),
  /**
   * `state`: "started", "completed" or a status name (Undo). `team` lets Rust
   * pick the team's usual status ("In Progress", "Done"); empty for a name.
   */
  setState: (id: string, state: string, team: string) =>
    callOrThrow<void>("linear_set_state", { id, state, team }),
  teams: () => callOrThrow<LinearTeam[]>("linear_teams"),
  createIssue: (title: string, team: string, assignToMe: boolean, priority: number) =>
    callOrThrow<LinearCreated>("linear_create_issue", { title, team, assignToMe, priority }),
};

// ── Do it with Claude ───────────────────────────────────────────────────────

export interface LinearFinished {
  commented: boolean;
  /** The status the issue was moved to, if any. */
  movedTo: string | null;
}

export const DoWithClaude = {
  /** Windows' folder picker; null if cancelled. */
  pickFolder: () => call<string>("claude_pick_folder"),
  /** Moves the issue to In Progress and opens Claude Code on it in `folder`. */
  start: (issueId: string, team: string, folder: string) =>
    callOrThrow<void>("claude_do_issue", { issueId, team, folder }),
  /** Claude finished: comment its summary and/or move the issue to review. */
  finish: (id: string, team: string, summary: string, comment: boolean, review: boolean) =>
    callOrThrow<LinearFinished>("linear_finish_issue", { id, team, summary, comment, review }),
};
