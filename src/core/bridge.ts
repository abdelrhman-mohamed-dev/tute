// How the pages talk to Rust: every Tauri command and event, typed. Outside
// Tauri (`npm run dev` in a browser) nothing reaches Rust: calls answer null
// or fail politely and events never come, so the island can still be worked on.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { ChatMessage, MemoryItem, Settings } from "./state";

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Args = Record<string, unknown>;

/** A command whose failure isn't the user's business: logged, answered with null. */
async function call<T>(command: string, args?: Args): Promise<T | null> {
  if (!IS_TAURI) return null;
  return invoke<T>(command, args).catch((err) => {
    console.error(`[tute] ${command}:`, err);
    return null;
  });
}

/** A command whose failure the user should see: the error is passed on. */
async function callOrThrow<T>(command: string, args?: Args): Promise<T> {
  if (!IS_TAURI) throw new Error("This only works inside the Tute app.");
  return invoke<T>(command, args);
}

/** Listens to an event from Rust. Returns a function that stops listening. */
export async function onEvent<T>(name: string, handler: (payload: T) => void): Promise<() => void> {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}

// ── The app ─────────────────────────────────────────────────────────────────

export interface BootInfo {
  settings: Settings;
  /** The island's display, in logical pixels. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
}

/** A connected display, for "Island lives on". */
export interface MonitorInfo {
  /** What goes in `Settings.screen` to pin it. */
  id: `monitor:${string}`;
  label: string;
  primary: boolean;
}

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),
  /** Saves, and tells the other window. */
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),
  openUrl: (url: string) => call<void>("open_url", { url }),
  openSettingsWindow: () => call<void>("open_settings_window"),
  quit: () => call<void>("quit_app"),
  /** A line in %LOCALAPPDATA%Tute	ute.log, among Rust's. */
  log: (message: string) => call<void>("log_line", { message }),

  // The window.
  /** Hidden: fold the window to the wake strip. Shown: the full panel. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),
  /** The island's outline in the window. Rust lets clicks through everywhere else. */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),
  /** Takes the keyboard (a text field is up) or lets it go. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),
  /** Places the window again (the displays changed). */
  reposition: () => call<void>("reposition"),
  listMonitors: () => call<MonitorInfo[]>("list_monitors"),

  // Dropped files.
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** Deletes an inbox copy; Rust refuses anything outside the inbox. */
  discardFile: (path: string) => call<void>("discard_file", { path }),

  // AI providers. Keys go in and are never read back: only "is there one?".
  providerKeySet: (providerId: string, key: string) => callOrThrow<void>("provider_key_set", { providerId, key }),
  providerKeyPresent: (providerId: string) => call<boolean>("provider_key_present", { providerId }),
  providerKeyClear: (providerId: string) => call<void>("provider_key_clear", { providerId }),
  /** The same https-only rule Rust applies before every request. */
  checkProviderUrl: (url: string) => callOrThrow<void>("check_provider_url", { url }),
  aiListModels: (providerId: string) => callOrThrow<string[]>("ai_list_models", { providerId }),
  /** One short message to the model: its reply, and how long it took. */
  aiTest: (providerId: string, model: string) =>
    callOrThrow<{ reply: string; millis: number }>("ai_test", { providerId, model }),
  /**
   * A chat turn with the active model. The reply also streams as `chat-delta`
   * ({ requestId, text }). With `web`, it may browse first (`chat-step` per
   * step) and answers with the pages it read.
   */
  aiChat: (requestId: number, messages: { role: string; content: string }[], web: boolean) =>
    callOrThrow<ChatAnswer>("ai_chat", { requestId, messages, web }),
};

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/**
 * Files dragged onto the island: from our own drop catcher (`file-drag`, see
 * catcher.rs), and from Tauri's drag events in case a webview ever delivers them.
 */
export async function onDragDrop(handler: (e: DragDropPayload) => void): Promise<() => void> {
  if (!IS_TAURI) return () => {};
  const stops = await Promise.all([
    getCurrentWebview().onDragDropEvent((e) => handler(e.payload as DragDropPayload)),
    listen<DragDropPayload>("file-drag", (e) => handler(e.payload)),
  ]);
  return () => stops.forEach((stop) => stop());
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

// ── Obsidian ────────────────────────────────────────────────────────────────

export interface ObsidianVault {
  name: string;
  /** Its folder; what goes in `Settings.obsidianVault`. */
  path: string;
}

export interface ObsidianFound {
  /** Inside the vault, with forward slashes. */
  path: string;
  title: string;
  /** A line around the match, when it matched inside the note. */
  snippet: string | null;
}

export const ObsidianBridge = {
  /** The vaults Obsidian knows about on this PC, most recent first. */
  vaults: () => call<ObsidianVault[]>("obsidian_vaults"),
  /** Windows' folder picker; null if cancelled, an error if it isn't a vault. */
  pick: () => callOrThrow<ObsidianVault | null>("obsidian_pick"),
  /** Adds a line to today's note; says which note. */
  capture: (text: string) => callOrThrow<{ note: string }>("obsidian_capture", { text }),
  openToday: () => callOrThrow<void>("obsidian_open_today"),
  open: (path: string) => callOrThrow<void>("obsidian_open", { path }),
  search: (query: string) => callOrThrow<ObsidianFound[]>("obsidian_search", { query }),
  /** A dropped file (its inbox copy) into the vault, linked in today's note. */
  saveFile: (path: string) => callOrThrow<{ note: string }>("obsidian_save_file", { path }),
};

// ── Browsing ────────────────────────────────────────────────────────────────

export interface BrowserStatus {
  /** The extension asked Tute for work in the last minute. */
  connected: boolean;
  /** Where the extension's files are, once written. */
  folder: string | null;
}

export const BrowseBridge = {
  status: () => call<BrowserStatus>("browser_status"),
  /** Writes the extension (with this PC's token) and opens its folder. */
  setup: () => callOrThrow<string>("browser_setup"),
  /** Stops a browsing chat (`chat-<request>`). */
  stop: (id: string) => call<void>("browse_stop", { id }),
  /** Brings its tab to the front. */
  watch: (id: string) => callOrThrow<void>("browse_watch", { id }),
};

// ── Saved chats and memory ──────────────────────────────────────────────────

/** A chat answer: its text, the pages it read, what it remembered, which memories it used. */
export interface ChatAnswer {
  text: string;
  sources: { title: string; url: string }[];
  remembered: MemoryItem[];
  used: string[];
}

export interface ChatInfo {
  id: string;
  title: string;
  updated: number;
}

export interface SavedChat extends ChatInfo {
  /** The messages as the chat keeps them (State.chatHistory). */
  messages: ChatMessage[];
}

export const ChatsBridge = {
  /** Newest first; chats older than the "keep for" setting are cleared on the way. */
  list: () => call<ChatInfo[]>("chats_list"),
  load: (id: string) => callOrThrow<SavedChat>("chat_load", { id }),
  save: (chat: { id: string; title: string; messages: ChatMessage[] }) =>
    call<void>("chat_save", { chat: { ...chat, updated: 0 } }),
  delete: (id: string) => call<void>("chat_delete", { id }),
  clear: () => callOrThrow<void>("chats_clear"),
};

export const MemoryBridge = {
  list: () => call<MemoryItem[]>("memory_list"),
  add: (text: string) => callOrThrow<MemoryItem>("memory_add", { text }),
  edit: (id: string, text: string) => callOrThrow<void>("memory_edit", { id, text }),
  forget: (id: string) => call<void>("memory_forget", { id }),
  forgetAll: () => callOrThrow<void>("memory_forget_all"),
};
