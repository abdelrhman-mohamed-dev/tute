// The island chat: talks to the model chosen in Settings → AI models (or in
// the menu at the top of the chat). Replies stream in as they are written.

import { h, svg, clear } from "./kit";
import { ICONS } from "./icons";
import { Bridge, onEvent } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import { modelPicker } from "./modelpick";
import { award } from "../island/bond";
import type { ViewActions, ViewHost } from "./views";

let nextId = 1;
let nextRequest = 1;

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h("div", { class: "chat-row user" }, h("div", { class: "bubble", text: message.content }));
  }
  return h("div", { class: "chat-row" }, h("div", { class: "reply", text: message.content }));
}

function typingDots(): HTMLElement {
  return h("div", { class: "chat-row" }, h("div", { class: "typing" }, h("i"), h("i"), h("i")));
}

export function buildPrompt(actions: ViewActions, onHeightChange: () => void): ViewHost {
  const picker = modelPicker((m) => actions.setActiveModel(m));
  const newChat = h("button", { class: "link-btn chat-new", text: "New chat" });
  // Fun or Focus: how the answers sound (the system prompt in lib.rs).
  const modeFun = h("span", { text: "Fun" });
  const modeFocus = h("span", { text: "Focus" });
  const mode = h("button", { class: "mode-seg", title: "How I answer" }, modeFocus, modeFun);
  mode.addEventListener("click", () => {
    actions.setChatMode(State.settings.chatMode === "fun" ? "focus" : "fun");
  });
  const top = h("div", { class: "chat-top" }, picker.el, h("div", { class: "grow" }), mode, newChat);

  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Ask me anything…",
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Send" }, svg(ICONS.arrowUp, 11));
  const bar = h("div", { class: "chat-bar" }, input, send);

  // No model yet: say where to add one instead of an input that can't work.
  const setup = h(
    "div",
    { class: "chat-setup" },
    h("span", { text: "Add a model first to start chatting." }),
    h("button", { class: "btn primary", text: "Open Settings", onclick: () => actions.openSettingsWindow() }),
  );

  const card = h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, top, log, setup, bar));
  card.style.setProperty("--wash", "rgba(99,102,241,0.5)");
  const el = h("div", { class: "view" }, card);

  /** The request currently streaming, or null. */
  let pending: number | null = null;
  /** Inline error under the conversation (not part of the history). */
  let error: string | null = null;
  let renderedKey = "";
  let lastReplyEl: HTMLElement | null = null;

  // Streamed pieces of the answer, for the request in flight only.
  void onEvent<{ requestId: number; text: string }>("chat-delta", ({ requestId, text }) => {
    if (requestId !== pending) return;
    const last = State.chatHistory.at(-1);
    if (last?.role === "assistant") last.content += text;
    else State.chatHistory.push({ id: nextId++, role: "assistant", content: text });
    State.stateOverride = "working";
    State.notify();
  });

  async function submit() {
    const query = input.value.trim();
    if (!query || pending != null || !State.settings.activeModel) return;
    input.value = "";
    error = null;
    Sound.play("send");

    State.chatHistory.push({ id: nextId++, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const request = nextRequest++;
    pending = request;
    // The full conversation so far; the reply is appended as it streams.
    const messages = State.chatHistory.map((m) => ({ role: m.role, content: m.content }));
    try {
      const full = await Bridge.aiChat(request, messages);
      // Events can trail the reply: make sure the bubble holds the whole answer.
      const last = State.chatHistory.at(-1);
      if (last?.role === "assistant") last.content = full;
      else State.chatHistory.push({ id: nextId++, role: "assistant", content: full });
      Sound.play("finish");
      award("chat");
      // In Fun mode the character enjoys its own answer a little.
      if (State.settings.chatMode === "fun") actions.emote("happy");
    } catch (err) {
      // A half-streamed answer stays; the error is shown under it.
      error = String(err).replace(/^Error:\s*/, "");
      Sound.play("error");
    } finally {
      if (pending === request) pending = null;
      State.stateOverride = null;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      void submit();
    }
    e.stopPropagation(); // Escape closes the island, not the chat
  });
  newChat.addEventListener("click", () => {
    if (pending != null) return;
    State.chatHistory = [];
    error = null;
    actions.blip();
    State.notify();
    onHeightChange();
    input.focus();
  });

  return {
    el,
    sync() {
      picker.sync();
      const fun = State.settings.chatMode === "fun";
      modeFun.classList.toggle("on", fun);
      modeFocus.classList.toggle("on", !fun);
      const ready = State.settings.activeModel != null;
      const anyModel = State.settings.providers.some((p) => p.models.length > 0);
      setup.style.display = anyModel ? "none" : "";
      bar.style.display = anyModel ? "" : "none";

      // Rebuild the log when its shape changes; while a reply streams, only
      // the last bubble's text is updated.
      const waiting = pending != null && State.chatHistory.at(-1)?.role === "user";
      const key = `${State.chatHistory.length}|${waiting}|${error ?? ""}`;
      if (key !== renderedKey) {
        renderedKey = key;
        clear(log);
        lastReplyEl = null;
        for (const m of State.chatHistory) {
          const b = bubble(m);
          log.append(b);
          if (m.role === "assistant") lastReplyEl = b.querySelector(".reply");
        }
        if (waiting) log.append(typingDots());
        if (error) log.append(h("div", { class: "chat-row" }, h("div", { class: "chat-error", text: error })));
        log.scrollTop = log.scrollHeight;
      } else {
        const last = State.chatHistory.at(-1);
        if (last?.role === "assistant" && lastReplyEl && lastReplyEl.textContent !== last.content) {
          const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
          lastReplyEl.textContent = last.content;
          if (atBottom) log.scrollTop = log.scrollHeight;
        }
      }

      newChat.style.visibility = State.chatHistory.length ? "visible" : "hidden";
      input.placeholder = !ready
        ? "Choose a model above…"
        : State.chatHistory.length === 0 ? "Ask me anything…" : "Continue…";
      input.disabled = pending != null || !ready;
      send.toggleAttribute("disabled", pending != null || !ready);
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
