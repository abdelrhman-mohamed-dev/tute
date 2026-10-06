// Claude Code sessions on the island. Rust (src-tauri/src/claude.rs) turns each
// Claude Code hook into a `claude-event`; this keeps one task per session and
// decides when the island speaks up:
//   - a question or permission prompt (`claude-ask`) opens the ask card and
//     stays until it's answered there or handed to the terminal,
//   - a finished turn or an error opens it for the usual auto-close time,
//   - prompts and tool calls only move the step trail, quietly.

import {
  DoWithClaude, claudeReply, claudeWaiting, onEvent, type ClaudeAsk, type ClaudeEvent, type ClaudeReply,
} from "../core/bridge";
import { TASK_COLORS, colorForName, type BotStateName, type IslandViewName } from "../core/layout";
import { Sound } from "../core/sound";
import { State, type AgentTask, type PillBadge } from "../core/state";
import { award } from "./bond";
import type { Island } from "./island";

/** Views the user is busy in: an alert waits as a badge instead of taking over. */
const BUSY_VIEWS: ReadonlySet<IslandViewName> = new Set([
  "prompt", "upload", "uploading", "choose", "personality", "greeting", "settings", "confused", "obsidian",
]);

/**
 * A question is worth interrupting the chat or the settings for; only these
 * can't be covered. It waits (as a badge, and as the view the island opens on)
 * until they're done.
 */
const ASK_BLOCKED: ReadonlySet<IslandViewName> = new Set([
  "upload", "uploading", "choose", "personality", "greeting", "confused",
]);

/**
 * Sessions whose ask was just handed to the terminal, and when: the
 * "needs your permission" notification that follows is expected, not news.
 */
const handedOff = new Map<string, number>();
const HANDOFF_QUIET_MS = 10_000;

/** The views a session's alert is shown in. */
const ALERT_VIEWS: ReadonlySet<IslandViewName> = new Set(["approval", "finished", "error"]);

const SEARCH_TOOLS = new Set(["Grep", "Glob", "ToolSearch", "WebSearch", "WebFetch"]);

/** How long a closed session lingers (its ✓ still showing) before it goes. */
const END_LINGER_MS = 1500;

export async function wireClaude(island: Island) {
  island.onAnswerAsk = (id, reply) => answerAsk(island, id, reply);
  await onEvent<ClaudeAsk>("claude-ask", (a) => onAsk(island, a));
  // Rust gave up waiting (timeout, or Claude Code hung up): the terminal has it.
  await onEvent<{ requestId: number }>("claude-ask-closed", ({ requestId }) =>
    removeAsk(island, requestId, null));
  await onEvent<ClaudeEvent>("claude-event", (e) => handle(island, e));
  // A reload (or a restart of the page) mid-question: Claude is still waiting.
  for (const ask of (await claudeWaiting()) ?? []) {
    if (!State.asks.some((a) => a.requestId === ask.requestId)) onAsk(island, ask);
  }
}

// ── Asks ──────────────────────────────────────────────────────────────────────

function onAsk(island: Island, ask: ClaudeAsk) {
  const task = ensureTask(ask.sessionId, ask.cwd);
  State.asks.push(ask);
  if (ask.kind === "permission") {
    set(task, "approval", "needs you", `Allow ${ask.tool ?? "a tool"}?`);
    Sound.play("approval");
  } else {
    set(task, "question", "asking", ask.questions?.[0]?.question);
    Sound.play("question");
  }
  showAsks(island);
}

/** Puts the oldest waiting ask on screen, if nothing more important is. */
function showAsks(island: Island) {
  const first = State.asks[0];
  if (!first || State.paused) return;
  if (State.mode === "expanded" && ASK_BLOCKED.has(State.view)) {
    if (State.focusId !== first.sessionId) State.setPillBadge(first.sessionId, "approval");
    return;
  }
  State.setFocus(first.sessionId);
  State.isPinned = true;
  island.alert("ask");
}

function answerAsk(island: Island, requestId: number, reply: ClaudeReply | null) {
  if (!State.asks.some((a) => a.requestId === requestId)) return;
  void claudeReply(requestId, reply);
  Sound.play(reply ? "approve" : "blip");
  removeAsk(island, requestId, reply);
}

/** The ask is done with: answered (`reply`), or gone to the terminal (null). */
function removeAsk(island: Island, requestId: number, reply: ClaudeReply | null) {
  const ask = State.asks.find((a) => a.requestId === requestId);
  if (!ask) return;
  State.asks = State.asks.filter((a) => a.requestId !== requestId);

  const task = State.tasks.find((t) => t.id === ask.sessionId);
  if (task) {
    if (!reply) {
      // Still waiting, now in the terminal: the character keeps asking.
      handedOff.set(ask.sessionId, Date.now());
    } else if ("decision" in reply && reply.decision === "deny") {
      set(task, "thinking", "thinking", `Denied ${ask.tool ?? "the tool"}`);
    } else {
      set(task, "working", "working", "answers" in reply ? `You picked ${Object.values(reply.answers).join(" · ")}` : null);
    }
  }

  if (State.asks.length > 0) {
    showAsks(island);
    State.notify();
    return;
  }
  island.dropPin();
  if (State.mode === "expanded" && State.view === "ask") island.collapse();
  else State.notify();
}

function projectName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() || "Claude";
}

/** The tool as a short label: "mcp__Claude_Browser__navigate" → "Claude Browser". */
function toolLabel(tool: string): string {
  if (!tool.startsWith("mcp__")) return tool;
  return (tool.split("__")[1] ?? tool).replace(/[_-]+/g, " ").trim();
}

/** "Editing island.ts", "Running npm test", "Searching TODO"… */
function toolStep(tool: string, detail: string | null): string {
  const d = detail ? ` ${detail}` : "";
  switch (tool) {
    case "Read":
    case "WebFetch":
      return `Reading${d}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Editing${d}`;
    case "Write":
      return `Writing${d}`;
    case "Bash":
    case "PowerShell":
      return `Running${d}`;
    case "Grep":
    case "Glob":
    case "ToolSearch":
      return `Searching${d}`;
    case "WebSearch":
      return `Searching the web${d}`;
    case "Task":
    case "Agent":
      return `Asking a helper${d}`;
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return "Updating the plan";
    case "AskUserQuestion":
      return "Asking you a question";
    case "Skill":
      return `Using a skill${d}`;
    default:
      return tool.startsWith("mcp__") ? `Using ${toolLabel(tool)}${d}` : `${tool}${d}`;
  }
}

function ensureTask(sessionId: string, cwd: string): AgentTask {
  let task = State.tasks.find((t) => t.id === sessionId);
  if (!task) {
    // Two sessions in one folder: "tute", "tute 2" — and their own colours.
    const base = projectName(cwd);
    let name = base;
    for (let n = 2; State.tasks.some((t) => t.name === name); n++) name = `${base} ${n}`;
    // Its own colour too, while there are colours left.
    const used = new Set(State.tasks.map((t) => t.color));
    const own = colorForName(name);
    const color = used.has(own) ? TASK_COLORS.find((c) => !used.has(c)) ?? own : own;
    State.addTask({ id: sessionId, name, color, label: "ready" });
    task = State.tasks.find((t) => t.id === sessionId)!;
  }
  return task;
}

function set(task: AgentTask, state: BotStateName, label: string, step?: string | null) {
  task.state = state;
  task.label = label;
  // The same step twice in a row (two searches for one thing) scrolls nothing new.
  if (step && step !== task.steps.at(-1)) State.appendStep(task.id, step);
  State.notify();
}

/** The session moved on: close its alert card if that's what's showing. */
function leaveAlert(island: Island, task: AgentTask) {
  if (State.focusId !== task.id) {
    if (task.pillBadge === "approval") State.setPillBadge(task.id, null);
    return;
  }
  island.dropPin();
  if (State.mode === "expanded" && ALERT_VIEWS.has(State.view)) island.setView("overview");
}

function badgeFor(view: IslandViewName): PillBadge {
  return view === "approval" ? "approval" : view === "error" ? "error" : "finished";
}

/** Opens the island on `view` for this session, unless that would get in the way. */
function alertFor(island: Island, task: AgentTask, view: IslandViewName, pin: boolean) {
  if (State.paused) return;
  const busy = State.mode === "expanded" && BUSY_VIEWS.has(State.view);
  // Another session's permission prompt is up: don't cover it.
  const coveringOther = State.isPinned && State.focusId !== task.id;
  if (busy || coveringOther) {
    if (State.focusId !== task.id) State.setPillBadge(task.id, badgeFor(view));
    return;
  }
  State.setFocus(task.id);
  State.isPinned = pin;
  island.alert(view);
}

function handle(island: Island, e: ClaudeEvent) {
  switch (e.event) {
    case "SessionStart": {
      const task = ensureTask(e.sessionId, e.cwd);
      if (e.kind === "clear") {
        task.steps = [];
        task.stepIndex = 0;
      }
      set(task, "idle", "ready");
      if (!State.paused) island.reveal();
      break;
    }

    case "UserPromptSubmit": {
      const task = ensureTask(e.sessionId, e.cwd);
      linkIssue(task, e.text);
      leaveAlert(island, task);
      task.pillBadge = null;
      set(task, "thinking", "thinking", e.text ?? "New prompt");
      break;
    }

    case "PreToolUse": {
      const task = ensureTask(e.sessionId, e.cwd);
      const tool = e.tool ?? "tool";
      set(task, SEARCH_TOOLS.has(tool) ? "searching" : "working", toolLabel(tool), toolStep(tool, e.detail));
      break;
    }

    case "PostToolUse": {
      // Only matters after a permission prompt: the answer was yes, work goes on.
      const task = State.tasks.find((t) => t.id === e.sessionId);
      if (task?.state === "approval") {
        leaveAlert(island, task);
        set(task, "working", e.tool ?? "working");
      }
      break;
    }

    case "Notification": {
      const task = ensureTask(e.sessionId, e.cwd);
      if (e.kind === "permission_prompt" || e.kind === "elicitation_dialog") {
        // The ask card already has it, or it was just handed to the terminal.
        if (State.asks.some((a) => a.sessionId === e.sessionId)) break;
        const handed = handedOff.get(e.sessionId);
        if (handed != null && Date.now() - handed < HANDOFF_QUIET_MS) {
          set(task, "approval", "needs you", e.text);
          break;
        }
        set(task, "approval", "needs you", e.text ?? "Claude needs your permission");
        Sound.play("approval");
        alertFor(island, task, "approval", true);
      } else if (e.kind === "agent_needs_input") {
        set(task, "question", "waiting", e.text ?? "Claude is waiting for your input");
        Sound.play("question");
        alertFor(island, task, "approval", false);
      } else if (e.kind === "idle_prompt" && task.state !== "approval") {
        // Comes a minute after every finished turn: the "done" card already
        // said so, so only the character changes, without opening again.
        set(task, "question", "waiting");
      }
      break;
    }

    case "Stop": {
      const task = ensureTask(e.sessionId, e.cwd);
      leaveAlert(island, task);
      // Working on an issue and ending on a question: it's waiting for the
      // user, not done — so nothing goes to Linear yet.
      const asking = !!task.issue && !task.issue.finished && (e.text ?? "").trim().endsWith("?");
      if (asking) {
        set(task, "question", "waiting", firstLine(e.text));
        Sound.play("question");
        alertFor(island, task, "approval", false);
        break;
      }
      set(task, "finished", "done", firstLine(e.text) ?? "All done");
      Sound.play("finish");
      island.emote("proud");
      award("claude");
      if (task.issue && !task.issue.finished) void finishIssue(task, e.text ?? "");
      alertFor(island, task, "finished", false);
      break;
    }

    case "StopFailure": {
      const task = ensureTask(e.sessionId, e.cwd);
      leaveAlert(island, task);
      const limited = (e.kind ?? "").includes("rate") || (e.kind ?? "").includes("quota");
      set(task, limited ? "ratelimit" : "error", e.kind?.replace(/_/g, " ") ?? "stopped",
        e.text ?? "Claude stopped with an error");
      Sound.play("error");
      alertFor(island, task, "error", false);
      break;
    }

    case "SessionEnd": {
      const id = e.sessionId;
      // Rust also notices the hang-up and closes them; this just doesn't wait.
      for (const a of State.asks.filter((x) => x.sessionId === id)) removeAsk(island, a.requestId, null);
      handedOff.delete(id);
      window.setTimeout(() => {
        const task = State.tasks.find((t) => t.id === id);
        if (!task) return;
        const showing = State.focusId === id && State.mode === "expanded" && ALERT_VIEWS.has(State.view);
        if (State.focusId === id) island.dropPin();
        State.removeTask(id);
        if (showing || (State.view === "overview" && State.defaultView() !== "overview")) {
          if (State.mode === "expanded") island.setView(State.defaultView());
          else State.view = State.defaultView();
        }
      }, END_LINGER_MS);
      break;
    }
  }
}

// ── Do it with Claude ─────────────────────────────────────────────────────────

/** The issue a session's first prompt names: the task text, or its file. */
const ISSUE_IN_PROMPT = [/^Work on Linear issue ([A-Za-z0-9]+-\d+):/, /tasks[\\/]([A-Za-z0-9]+-\d+)\.md/];

/**
 * A Claude window Tute just opened sends its task as the first prompt; that's
 * where the session learns which issue it is working on. The session then
 * goes by the issue's id, in Linear's violet.
 */
function linkIssue(task: AgentTask, prompt: string | null) {
  if (task.issue || !prompt) return;
  const id = ISSUE_IN_PROMPT.map((re) => prompt.match(re)?.[1]).find(Boolean);
  if (!id) return;
  const launch = State.claudeLaunches.find((l) => l.issue.id === id);
  if (!launch) return;
  State.claudeLaunches = State.claudeLaunches.filter((l) => l !== launch);
  task.issue = { id, url: launch.issue.url, team: launch.issue.team, startedAt: launch.at };
  if (!State.tasks.some((t) => t !== task && t.name === id)) task.name = id;
  task.color = "#5e6ad2";
}

/** "When done": the summary goes to the issue as a comment, the issue to review. */
async function finishIssue(task: AgentTask, summary: string) {
  const issue = task.issue;
  if (!issue) return;
  const { claudeDoneComment: comment, claudeDoneReview: review } = State.settings;
  if (!comment && !review) {
    issue.finished = { commented: false, movedTo: null };
    return;
  }
  issue.finished = "posting";
  State.notify();
  try {
    issue.finished = await DoWithClaude.finish(issue.id, issue.team, summary, comment, review);
    State.linearIssues = null; // its status changed: reload the list next time
  } catch (err) {
    issue.finished = { error: String(err).replace(/^Error:\s*/, "") };
  }
  State.notify();
}

/** Claude's reply, minus markdown marks, for a two-line card. */
function firstLine(text: string | null): string | null {
  if (!text) return null;
  const plain = text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  return plain || null;
}
