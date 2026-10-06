// Home. With sessions running: the overview, the focused one's step trail on
// the left and the others as pills on the right. With nothing running: a calm
// line, the ask bar, and shortcuts to Linear and Obsidian.

import { State, type AgentTask } from "../core/state";
import { createMini } from "../jelly/minibots";
import { ICONS } from "./icons";
import { body, card, dot, h, lighter, rgbOf, svg } from "./kit";
import { OBSIDIAN, vaultName } from "./obsidian";
import { StepTrail } from "./trail";
import type { ViewActions, ViewHost } from "./views";

/** At most this many other sessions get a pill. */
const PILLS = 4;

export function buildOverview(actions: ViewActions): ViewHost {
  const trail = new StepTrail();
  const who = h("div", { class: "who" });
  const pills = h("div", { class: "pills" });
  let shown = "";

  const el = h(
    "div",
    { class: "view overview" },
    h("div", { class: "left" }, card(null, h("div", { class: "card-body" }, who, trail.el))),
    h("div", { class: "right" }, card(null, pills)),
  );

  return {
    el,
    tick: (nowMs) => trail.tick(nowMs),
    busy: () => trail.animating,
    sync() {
      const task = State.focusTask;
      who.replaceChildren();
      if (task) {
        who.append(dot(task.color, 7), h("span", { class: "name", text: task.name }));
        if (task.label) who.append(h("span", { class: "tool", text: task.label }));
        const n = task.steps.length;
        if (task.browse && task.state !== "finished" && task.state !== "error") {
          // Browsing: watch it in the browser, or stop it.
          who.append(
            h("span", { class: "count" },
              h("button", { class: "link-btn task-act", text: "Watch ↗", onclick: () => actions.browseWatch(task.id) }),
              h("button", { class: "link-btn task-act", text: "Stop", onclick: () => actions.browseStop(task.id) })),
          );
        } else if (n > 1) {
          who.append(h("span", { class: "count", text: `${Math.min(task.stepIndex + 1, n)}/${n}` }));
        }
      }
      trail.sync(task);

      // Rebuilt only when the set of pills (or a badge) changes.
      const others = State.otherTasks.slice(0, PILLS);
      const key = others.map((t) => `${t.id}:${t.pillBadge ?? ""}`).join("|");
      if (key !== shown) {
        shown = key;
        pills.replaceChildren(...others.map((t) => pill(t, () => actions.setFocus(t.id))));
      }
    },
  };
}

const BADGE_ICON = { approval: ICONS.bang, finished: ICONS.check, error: ICONS.xmark } as const;

/** Another session: its mini jelly and name, lit in its colour on hover. Click to focus it. */
function pill(task: AgentTask, onclick: () => void): HTMLElement {
  const el = h("div", { class: "pill", onclick }, createMini(task, 24), h("span", { class: "lbl", text: task.name }));
  el.style.setProperty("--c-rgb", rgbOf(task.color));
  el.style.setProperty("--c-light", lighter(task.color, 0.35));
  const badge = task.pillBadge;
  if (badge) {
    el.append(
      h("div", { class: `pill-badge ${badge}` },
        h("i", {}, svg(BADGE_ICON[badge], 6, { stroke: badge === "finished" ? 3 : 0 }))),
    );
  }
  return el;
}

/**
 * Home, with nothing running: a calm line, the ask bar (the main thing to do
 * here), and one row of shortcuts to what's connected. No drop button: a file
 * can be dropped anywhere on the island.
 */
export function buildEmpty(actions: ViewActions): ViewHost {
  // Opens the chat with its field ready. A live field here would take the
  // keyboard every time the island opens, away from whatever you're typing in.
  const ask = h(
    "button",
    { class: "ask-bar", title: "Chat with me", onclick: () => actions.setView("prompt") },
    h("span", { text: "Ask me anything…" }),
    h("i", { class: "ask-send" }, svg(ICONS.arrowUp, 13)),
  );

  const shortcut = (color: string | null, onclick: () => void) => {
    const label = h("span");
    const count = h("span", { class: "count" });
    const el = h(
      "button",
      { class: "shortcut", onclick },
      color ? h("i", { class: "quick-dot", style: `background:${color}` }) : null,
      label,
      count,
    );
    return { el, label, count };
  };
  // Linear: connect it, then it's your issues (and a quick new one).
  const linear = shortcut("var(--linear)", () => actions.linearAction());
  const obsidian = shortcut(OBSIDIAN, () => actions.obsidianAction());
  const newIssue = shortcut(null, () => {
    actions.blip();
    actions.setView("linear-new");
  });
  newIssue.label.textContent = "+ New issue";

  const content = body(
    118,
    h(
      "div",
      { class: "home-head" },
      h("span", { class: "title", text: "All quiet." }),
      h("span", { class: "sub", text: "Nothing running · drop a file on me anytime" }),
    ),
    ask,
    h("div", { class: "quick-row" }, linear.el, obsidian.el, newIssue.el),
  );
  content.classList.add("home");

  return {
    el: h("div", { class: "view" }, card(null, content)),
    sync() {
      const vault = vaultName();
      obsidian.label.textContent = vault ? "Obsidian" : "Connect Obsidian";
      obsidian.el.title = vault ? `Jot into today's note, or find a note in ${vault}` : "Connect your Obsidian vault";

      const s = State.linear;
      linear.el.hidden = !s;
      newIssue.el.hidden = !s?.connected;
      if (!s) return;
      // Keeps the count fresh while home is on screen (at most once a minute).
      if (s.connected && State.mode === "expanded") actions.linear.refresh();
      const count = State.linearIssues?.length;
      linear.label.textContent = s.connected ? "My issues" : s.signingIn ? "Finish in your browser…" : "Connect Linear";
      linear.count.textContent = s.connected && count != null ? String(count) : "";
      linear.el.title = s.connected ? `Open issues assigned to ${s.user ?? "you"} in Linear` : "Connect your Linear workspace";
    },
  };
}
