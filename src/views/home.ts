// Home. With sessions running: the overview, the focused one's step trail on
// the left and the others as pills on the right. With nothing running: a
// hello, the quick actions (Linear), and buttons to drop a file or chat.

import { State, type AgentTask } from "../core/state";
import { createMini } from "../jelly/minibots";
import { ICONS } from "./icons";
import { body, button, card, dot, h, lighter, rgbOf, svg } from "./kit";
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
        if (n > 1) who.append(h("span", { class: "count", text: `${Math.min(task.stepIndex + 1, n)}/${n}` }));
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

export function buildEmpty(actions: ViewActions): ViewHost {
  // Linear first: connect it, then it's your issues.
  const linearDot = h("i", { class: "quick-dot" });
  const linearText = h("span");
  const linear = h("button", { class: "quick", onclick: () => actions.linearAction() }, linearDot, linearText);
  const newIssue = h("button", {
    class: "quick",
    text: "+ New issue",
    onclick: () => {
      actions.blip();
      actions.setView("linear-new");
    },
  });

  const content = body(
    118,
    h(
      "div",
      { class: "home-text" },
      h("div", { class: "title", text: "Nothing running right now." }),
      h("div", { class: "sub", text: "Ask me anything, or drop a file on me." }),
      h("div", { class: "quick-row" }, linear, newIssue),
    ),
    h("div", { class: "grow" }),
    button("Drop a file", "secondary", () => actions.setView("upload")),
    button("Ask me", "primary", () => actions.setView("prompt")),
  );
  content.classList.add("home");

  return {
    el: h("div", { class: "view" }, card(null, content)),
    sync() {
      const s = State.linear;
      linear.hidden = !s;
      newIssue.hidden = !s?.connected;
      if (!s) return;
      // Keeps the count fresh while home is on screen (at most once a minute).
      if (s.connected && State.mode === "expanded") actions.linear.refresh();
      const count = State.linearIssues?.length;
      linear.classList.toggle("on", s.connected);
      // Linear's violet once connected; amber while the browser is open.
      linearDot.style.background = s.connected ? "var(--linear)" : s.signingIn ? "var(--warn)" : "var(--text-faint)";
      linearText.textContent = s.connected
        ? `My issues${count != null ? ` · ${count}` : ""}`
        : s.signingIn ? "Finish in your browser…" : "Connect Linear";
      linear.title = s.connected ? `Open issues assigned to ${s.user ?? "you"} in Linear` : "Connect your Linear workspace";
    },
  };
}
