// The ask card: a Claude Code question (AskUserQuestion) with its options as
// buttons, or a permission prompt with Allow / Deny. Whatever is picked goes
// straight back to Claude (island/claude.ts → src-tauri/src/claude.rs);
// "Answer in terminal" hands it to Claude Code's own dialog instead.

import { h, clear, dot } from "./kit";
import { State } from "../core/state";
import type { ClaudeAsk, ClaudeReply } from "../core/bridge";
import type { ViewActions, ViewHost } from "./views";

export function buildAsk(actions: ViewActions): ViewHost {
  const who = h("div", { class: "who-row" });
  const title = h("div", { class: "title clamp2 ask-title" });
  const body = h("div", { class: "ask-body" });
  const footer = h("div", { class: "actions ask-footer" });
  const el = h("div", { class: "view" },
    h("div", { class: "card" }, h("div", { class: "stack ask-stack" }, who, title, body, footer)));

  // Where we are in the current ask: which question, what's picked so far.
  let shownId = -1;
  let index = 0;
  let answers: Record<string, string> = {};
  let picked = new Set<string>();
  let renderedKey = "";

  const send = (ask: ClaudeAsk, reply: ClaudeReply | null) => actions.answerAsk(ask.requestId, reply);

  function next(ask: ClaudeAsk, answer: string) {
    const questions = ask.questions ?? [];
    answers[questions[index].question] = answer;
    if (index + 1 < questions.length) {
      index++;
      picked = new Set();
      render(ask);
    } else {
      send(ask, { answers });
    }
  }

  function terminalLink(ask: ClaudeAsk): HTMLElement {
    return h("button", {
      class: "link-btn ask-terminal",
      text: "Answer in terminal",
      onclick: () => send(ask, null),
    });
  }

  function render(ask: ClaudeAsk) {
    renderedKey = `${ask.requestId}:${index}:${State.asks.length}`;
    const task = State.tasks.find((t) => t.id === ask.sessionId);
    clear(who);
    if (task) who.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
    const waiting = State.asks.length - 1;
    clear(body);
    clear(footer);

    if (ask.kind === "permission") {
      who.append(h("span", { text: "wants to go ahead" }));
      title.textContent = `Allow ${ask.tool ?? "this tool"}?`;
      if (ask.detail) body.append(h("div", { class: "ask-detail clamp2", text: ask.detail }));
      footer.append(
        h("button", { class: "btn primary", text: "Allow", onclick: () => send(ask, { decision: "allow" }) }),
        h("button", { class: "btn secondary", text: "Deny", onclick: () => send(ask, { decision: "deny" }) }),
      );
    } else {
      const questions = ask.questions ?? [];
      const q = questions[index];
      if (q.header) who.append(h("span", { class: "ask-chip", text: q.header }));
      if (questions.length > 1) who.append(h("span", { text: `${index + 1} of ${questions.length}` }));
      title.textContent = q.question;

      const grid = h("div", { class: "ask-options" });
      for (const opt of q.options) {
        const button = h(
          "button",
          { class: "ask-option", title: opt.description ?? "" },
          h("span", { class: "l", text: opt.label }),
          opt.description ? h("span", { class: "d", text: opt.description }) : null,
        );
        button.classList.toggle("on", picked.has(opt.label));
        button.addEventListener("click", () => {
          if (!q.multiSelect) {
            next(ask, opt.label);
            return;
          }
          if (picked.has(opt.label)) picked.delete(opt.label);
          else picked.add(opt.label);
          button.classList.toggle("on", picked.has(opt.label));
          sendBtn.style.opacity = picked.size ? "1" : "0.45";
        });
        grid.append(button);
      }
      body.append(grid);

      const last = index + 1 >= questions.length;
      const sendBtn = h("button", {
        class: "btn primary",
        text: last ? "Send" : "Next",
        style: `opacity:${picked.size ? 1 : 0.45}`,
        onclick: () => {
          if (!picked.size) return;
          next(ask, q.options.map((o) => o.label).filter((l) => picked.has(l)).join(", "));
        },
      });
      if (q.multiSelect) footer.append(sendBtn);
    }

    footer.append(h("div", { class: "grow" }));
    if (waiting > 0) footer.append(h("span", { class: "ask-more", text: `+${waiting} waiting` }));
    footer.append(terminalLink(ask));
  }

  return {
    el,
    sync() {
      const ask = State.asks[0];
      if (!ask) return;
      if (ask.requestId !== shownId) {
        shownId = ask.requestId;
        index = 0;
        answers = {};
        picked = new Set();
      }
      // Every new step syncs the views; rebuild only when something here
      // changed, so the buttons don't flicker under the cursor.
      const key = `${ask.requestId}:${index}:${State.asks.length}`;
      if (key === renderedKey) return;
      renderedKey = key;
      render(ask);
    },
  };
}
