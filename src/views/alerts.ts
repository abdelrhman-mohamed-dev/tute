// The cards that tell you something: a session failed, is waiting for you, or
// finished; the jelly is dizzy; or a short note.

import { washRGBA } from "../core/layout";
import { State } from "../core/state";
import { body, button, card, h, who } from "./kit";
import type { ViewActions, ViewHost } from "./views";

/** The text column starts right of the jelly in these cards. */
const INSET = 116;

export function buildError(actions: ViewActions): ViewHost {
  const head = h("div");
  const detail = h("div", { class: "detail" });
  const content = body(
    INSET,
    head,
    h("div", { class: "title", text: "Something went wrong." }),
    detail,
    h("div", { class: "actions" }, button("OK", "primary", () => actions.setView(State.defaultView()))),
  );
  return {
    el: h("div", { class: "view" }, card("red", content)),
    sync() {
      const task = State.focusTask;
      head.replaceChildren(who(task, task?.label ?? "stopped"));
      detail.textContent = task?.steps.at(-1) ?? "No detail available.";
    },
  };
}

/**
 * A session waits for you: a permission prompt (amber, stays until you look)
 * or an idle prompt (cyan). The answer is given in the terminal; this card only
 * makes sure you don't miss it.
 */
export function buildApproval(actions: ViewActions): ViewHost {
  const head = h("div");
  const title = h("div", { class: "title" });
  const detail = h("div", { class: "sub clamp2" });
  const box = card(
    "amber",
    body(INSET, head, title, detail, h("div", { class: "actions" }, button("Got it", "primary", () => actions.collapse()))),
  );
  return {
    el: h("div", { class: "view" }, box),
    sync() {
      const task = State.focusTask;
      const asking = task?.state === "approval";
      box.style.setProperty("--wash", washRGBA(asking ? "amber" : "cyan"));
      head.replaceChildren(who(task, asking ? "needs you" : "waiting"));
      title.textContent = asking ? "Claude needs your permission" : "Claude is waiting for you";
      detail.textContent = task?.steps.at(-1) ?? "";
    },
  };
}

export function buildFinished(actions: ViewActions): ViewHost {
  const head = h("div");
  // Claude's last reply can be long: two lines here, the rest is in the terminal.
  const title = h("div", { class: "title clamp2" });
  const row = h("div", { class: "actions" });
  return {
    el: h("div", { class: "view" }, card("green", body(INSET, head, title, row))),
    sync() {
      const task = State.focusTask;
      const issue = task?.issue;
      // "Do it with Claude": who did it, how long it took, what Linear got.
      const minutes = issue ? Math.max(1, Math.round((Date.now() - issue.startedAt) / 60_000)) : 0;
      head.replaceChildren(who(task, issue ? `done by Claude · ${minutes} min` : "finished"));
      title.textContent = task?.steps.at(-1) ?? "All done";

      row.replaceChildren();
      const f = issue?.finished;
      if (f === "posting") {
        row.append(h("span", { class: "quick", text: "Updating Linear…" }));
      } else if (f && "error" in f) {
        row.append(h("span", { class: "quick lin-err", text: `Linear: ${f.error}`, title: f.error }));
      } else if (f) {
        if (f.commented) row.append(h("span", { class: "quick", text: "💬 Summary posted" }));
        if (f.movedTo) row.append(h("span", { class: "quick", text: `→ ${f.movedTo.replace(/^[^\p{L}\p{N}]+/u, "")}` }));
      }
      if (issue) {
        row.append(
          h("div", { class: "grow" }),
          button("Open issue ↗", "primary", () => actions.openUrl(issue.url)),
          button("OK", "secondary", () => actions.collapse()),
        );
      } else {
        row.append(button("OK", "primary", () => actions.collapse()));
      }
    },
  };
}

/** After three pokes. */
export function buildConfused(): ViewHost {
  const content = body(
    128,
    h("div", { class: "title", text: "Ouch! That's my jelly." }),
    h("div", { class: "sub", text: "Hold on, pulling myself back together…" }),
  );
  return { el: h("div", { class: "view" }, card("pink", content)), sync() {} };
}

/** One line, for a moment (a saved file, an error from Linear). */
export function buildNote(): ViewHost {
  const title = h("div", { class: "title" });
  return {
    el: h("div", { class: "view" }, card(null, body(98, title))),
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}
