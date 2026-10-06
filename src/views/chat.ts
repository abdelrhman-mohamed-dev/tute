// The island chat: talks to the model chosen in Settings → Chat models (or in
// the menu at the top of the chat). Replies stream in as they are written.
//
// Chats are saved on this PC as they go, named after their first question;
// the menu at the top left goes back to one. The chat remembers lasting
// things you tell it: a chip says what it remembered (with Undo), and a tag
// says when a memory shaped an answer (src-tauri/src/memory.rs).
//
// With Tute's browser extension connected, the model can also browse (the
// globe, on by default): it decides itself when a question needs the web,
// its steps show here as it works (Watch, Stop), and the answer comes with
// the pages it read (src-tauri/src/browse.rs).

import { h, svg, clear } from "./kit";
import { ICONS } from "./icons";
import { Bridge, BrowseBridge, ChatsBridge, MemoryBridge, onEvent, type ChatInfo } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import { modelPicker } from "./modelpick";
import { award } from "../island/bond";
import type { ViewActions, ViewHost } from "./views";

let nextId = 1;
let nextRequest = 1;
/** Browsing's colour, on the island and in the chat. */
const BROWSE = "#3E9BFF";

const host = (url: string) => url.split("://")[1]?.split("/")[0]?.replace(/^www\./, "") ?? url;

/** A reply as it streams: the hidden notes at its end (⟦…⟧) never show. */
const visible = (text: string) => {
  const cut = text.indexOf("⟦");
  return (cut < 0 ? text : text.slice(0, cut)).trimEnd();
};

/** "now", "2h", "Mon", "Sep 30". */
function when(ms: number): string {
  const minutes = (Date.now() - ms) / 60_000;
  if (minutes < 60) return minutes < 2 ? "now" : `${Math.round(minutes)}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  const d = new Date(ms);
  return minutes < 6 * 24 * 60 ? d.toLocaleDateString(undefined, { weekday: "short" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface BubbleActions {
  openUrl(url: string): void;
  undoMemory(message: ChatMessage, id: string): void;
}

/** One message: a question (a globe if it browsed), or an answer with its sources and memory notes. */
function bubble(message: ChatMessage, act: BubbleActions): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble" }, message.browse ? h("span", { class: "globe" }, svg(ICONS.globe, 11, { stroke: 2 })) : null, message.content),
    );
  }
  const reply = h("div", { class: "reply", text: visible(message.content) });
  const tags = [
    ...(message.used ?? []).map((m) => h("span", { class: "source memo", title: "Something I remember shaped this", text: `🧠 ${m}` })),
    ...(message.sources ?? []).map((s) => h("button", { class: "source", title: s.title, text: `${host(s.url)} ↗`, onclick: () => act.openUrl(s.url) })),
  ];
  const chips = (message.remembered ?? []).map((m) =>
    h(
      "div",
      { class: "remembered" },
      h("span", { text: "🧠" }),
      h("b", { text: "Remembered" }),
      h("span", { text: m.text }),
      h("button", { class: "link-btn", text: "Undo", onclick: () => act.undoMemory(message, m.id) }),
    ),
  );
  return h("div", { class: "chat-row" }, h("div", {}, reply, tags.length ? h("div", { class: "sources" }, ...tags) : null, ...chips));
}

function typingDots(): HTMLElement {
  return h("div", { class: "chat-row" }, h("div", { class: "typing" }, h("i"), h("i"), h("i")));
}

export function buildPrompt(actions: ViewActions, onHeightChange: () => void): ViewHost {
  const picker = modelPicker((m) => actions.setActiveModel(m));
  const newChat = h("button", { class: "link-btn chat-new", text: "+ New chat" });
  // Fun or Focus: how the answers sound (the system prompt in lib.rs).
  const modeFun = h("span", { text: "Fun" });
  const modeFocus = h("span", { text: "Focus" });
  const mode = h("button", { class: "mode-seg", title: "How I answer" }, modeFocus, modeFun);
  mode.addEventListener("click", () => {
    actions.setChatMode(State.settings.chatMode === "fun" ? "focus" : "fun");
  });

  // ── The chats menu ──
  const chatsTitle = h("span", { class: "chats-title" });
  const chatsButton = h("button", { class: "chats-btn", title: "Your chats" }, chatsTitle, h("span", { class: "caret", text: "▾" }));
  const find = h("input", { type: "text", class: "chats-find", placeholder: "Find a chat…", spellcheck: "false" });
  const list = h("div", { class: "chats-list" });
  const menu = h("div", { class: "chats-menu" }, find, list);
  menu.hidden = true;
  let saved: ChatInfo[] = [];

  const drawList = () => {
    const q = find.value.trim().toLowerCase();
    const shown = saved.filter((c) => !q || c.title.toLowerCase().includes(q)).slice(0, 8);
    list.replaceChildren(
      ...(shown.length
        ? shown.map((c) =>
            h(
              "div",
              { class: `chats-item${c.id === State.chatId ? " on" : ""}`, onclick: () => void open(c.id) },
              h("span", { class: "chats-name", text: c.title }),
              h("span", { class: "chats-when", text: when(c.updated) }),
              h("button", {
                class: "chats-x",
                title: "Delete this chat",
                text: "✕",
                onclick: (e: Event) => {
                  e.stopPropagation();
                  void ChatsBridge.delete(c.id).then(() => {
                    saved = saved.filter((x) => x.id !== c.id);
                    if (State.chatId === c.id) startNew();
                    drawList();
                  });
                },
              }),
            ),
          )
        : [h("div", { class: "chats-empty", text: saved.length ? "No chat matches." : "Your chats show up here." })]),
    );
  };
  const toggleMenu = async (open = menu.hidden) => {
    menu.hidden = !open;
    if (!open) return;
    actions.blip();
    find.value = "";
    saved = (await ChatsBridge.list()) ?? [];
    drawList();
    find.focus();
  };
  chatsButton.addEventListener("click", () => void toggleMenu());
  find.addEventListener("input", drawList);
  find.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") void toggleMenu(false);
  });

  async function open(id: string) {
    if (pending != null) return;
    try {
      const chat = await ChatsBridge.load(id);
      State.chatHistory = chat.messages;
      State.chatId = chat.id;
      nextId = Math.max(nextId, ...chat.messages.map((m) => m.id + 1));
      error = null;
      void toggleMenu(false);
      State.notify();
      onHeightChange();
      input.focus();
    } catch (err) {
      error = String(err).replace(/^Error:\s*/, "");
      State.notify();
    }
  }

  function startNew() {
    State.chatHistory = [];
    State.chatId = null;
    error = null;
    State.notify();
    onHeightChange();
  }

  /** Saves the chat on screen (it gets its id with its first answer). */
  function save() {
    if (!State.chatHistory.length) return;
    State.chatId ??= `c-${Date.now().toString(36)}`;
    const first = State.chatHistory.find((m) => m.role === "user")?.content ?? "Chat";
    void ChatsBridge.save({ id: State.chatId, title: first.length > 60 ? `${first.slice(0, 59)}…` : first, messages: State.chatHistory });
  }

  const top = h("div", { class: "chat-top" }, chatsButton, picker.el, h("div", { class: "grow" }), mode, newChat);

  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Ask me anything…",
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Send" }, svg(ICONS.arrowUp, 11));

  // The web: offered while the extension is connected, on unless turned off.
  let webReady = false;
  let webOn = true;
  const globe = h("button", { class: "browse-toggle" }, svg(ICONS.globe, 14, { stroke: 1.8 }));
  globe.addEventListener("click", () => {
    webOn = !webOn;
    actions.blip();
    State.notify();
    input.focus();
  });
  const checkWeb = async () => {
    webReady = (await BrowseBridge.status())?.connected ?? false;
    State.notify();
  };
  const bar = h("div", { class: "chat-bar" }, globe, input, send);

  // No model yet: say where to add one instead of an input that can't work.
  const setup = h(
    "div",
    { class: "chat-setup" },
    h("span", { text: "Add a model first to start chatting." }),
    h("button", { class: "btn primary", text: "Open Settings", onclick: () => actions.openSettingsWindow() }),
  );

  const card = h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, top, log, setup, bar), menu);
  card.style.setProperty("--wash", "rgba(99,102,241,0.5)");
  const el = h("div", { class: "view" }, card);

  /** The request in flight, or null. */
  let pending: number | null = null;
  /** What it's doing on the web for that request, newest last. */
  let steps: string[] = [];
  /** Inline error under the conversation (not part of the history). */
  let error: string | null = null;
  let renderedKey = "";
  let lastReplyEl: HTMLElement | null = null;

  const bubbleActions: BubbleActions = {
    openUrl: actions.openUrl,
    undoMemory: (message, id) => {
      void MemoryBridge.forget(id);
      message.remembered = message.remembered?.filter((m) => m.id !== id);
      actions.blip();
      renderedKey = "";
      save();
      State.notify();
    },
  };

  // Streamed pieces of the answer, for the request in flight only.
  void onEvent<{ requestId: number; text: string }>("chat-delta", ({ requestId, text }) => {
    if (requestId !== pending) return;
    const last = State.chatHistory.at(-1);
    if (last?.role === "assistant") last.content += text;
    else State.chatHistory.push({ id: nextId++, role: "assistant", content: text });
    State.stateOverride = "working";
    State.notify();
  });

  // A browsing step. It also shows on the island, as a task like a Claude session.
  void onEvent<{ requestId: number; id: string; text: string }>("chat-step", ({ requestId, id, text }) => {
    if (requestId !== pending) return;
    if (!steps.length) {
      const question = State.chatHistory.at(-1);
      if (question?.role === "user") question.browse = true;
      State.addTask({ id, name: "Browsing", color: BROWSE, state: "searching", label: question?.content.slice(0, 48), steps: [], browse: { sources: [] } });
    }
    steps.push(text);
    State.appendStep(id, text);
    State.updateTask(id, text.startsWith("Searching") ? "searching" : "working");
    State.stateOverride = null;
    State.notify();
  });

  async function submit() {
    const query = input.value.trim();
    if (!query || pending != null || !State.settings.activeModel) return;
    input.value = "";
    error = null;
    steps = [];
    menu.hidden = true;
    Sound.play("send");

    State.chatHistory.push({ id: nextId++, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const request = nextRequest++;
    pending = request;
    // The conversation so far, as plain text; the reply is appended as it streams.
    const messages = State.chatHistory.map((m) => ({ role: m.role, content: m.role === "assistant" ? visible(m.content) : m.content }));
    try {
      const answer = await Bridge.aiChat(request, messages, webReady && webOn);
      // Events can trail the reply: make sure the bubble holds the whole answer.
      const extra = {
        content: answer.text,
        sources: answer.sources.length ? answer.sources : undefined,
        remembered: answer.remembered.length ? answer.remembered : undefined,
        used: answer.used.length ? answer.used : undefined,
      };
      const last = State.chatHistory.at(-1);
      if (last?.role === "assistant") Object.assign(last, extra);
      else State.chatHistory.push({ id: nextId++, role: "assistant", ...extra });
      renderedKey = ""; // sources and chips: draw the answer again
      Sound.play("finish");
      award("chat");
      // It enjoys learning about you; in Fun mode, its own answer too.
      if (answer.remembered.length) actions.emote("love");
      else if (State.settings.chatMode === "fun") actions.emote("happy");
    } catch (err) {
      // A half-streamed answer stays; the error is shown under it.
      const text = String(err).replace(/^Error:\s*/, "");
      error = text;
      Sound.play(text === "Stopped." ? "blip" : "error");
    } finally {
      if (steps.length) State.removeTask(`chat-${request}`);
      if (pending === request) pending = null;
      steps = [];
      save();
      State.stateOverride = null;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  /** While it browses: what it's doing now, and Watch / Stop. */
  function browsingRow(request: number): HTMLElement {
    const id = `chat-${request}`;
    return h(
      "div",
      { class: "chat-row" },
      h(
        "div",
        { class: "web-step" },
        h("span", { class: "globe" }, svg(ICONS.globe, 11, { stroke: 2 })),
        h("span", { class: "web-now", text: steps.at(-1) ?? "" }),
        h("button", { class: "link-btn task-act", text: "Watch ↗", onclick: () => actions.browseWatch(id) }),
        h("button", { class: "link-btn task-act", text: "Stop", onclick: () => actions.browseStop(id) }),
      ),
    );
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
    actions.blip();
    menu.hidden = true;
    startNew();
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

      const first = State.chatHistory.find((m) => m.role === "user")?.content;
      chatsTitle.textContent = first ?? "Chats";

      // Rebuild the log when its shape changes; while a reply streams, only
      // the last bubble's text is updated.
      const waiting = pending != null && State.chatHistory.at(-1)?.role === "user";
      const key = `${State.chatId}|${State.chatHistory.length}|${waiting}|${steps.length}|${error ?? ""}`;
      if (key !== renderedKey) {
        renderedKey = key;
        clear(log);
        lastReplyEl = null;
        for (const m of State.chatHistory) {
          const b = bubble(m, bubbleActions);
          log.append(b);
          if (m.role === "assistant") lastReplyEl = b.querySelector(".reply");
        }
        if (waiting) log.append(steps.length && pending != null ? browsingRow(pending) : typingDots());
        if (error) log.append(h("div", { class: "chat-row" }, h("div", { class: "chat-error", text: error })));
        log.scrollTop = log.scrollHeight;
      } else {
        const last = State.chatHistory.at(-1);
        const text = last?.role === "assistant" ? visible(last.content) : null;
        if (text != null && lastReplyEl && lastReplyEl.textContent !== text) {
          const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
          lastReplyEl.textContent = text;
          if (atBottom) log.scrollTop = log.scrollHeight;
        }
      }

      const web = webReady && webOn;
      globe.hidden = !webReady;
      globe.classList.toggle("on", web);
      globe.title = web ? "Browsing is on: I look things up when a question needs it. Click to turn it off." : "Browsing is off. Click to let me look things up.";
      newChat.style.visibility = State.chatHistory.length ? "visible" : "hidden";
      input.placeholder = !ready
        ? "Choose a model above…"
        : State.chatHistory.length === 0 ? (web ? "Ask me anything, I can look it up…" : "Ask me anything…") : "Continue…";
      input.disabled = pending != null || !ready;
      send.toggleAttribute("disabled", pending != null || !ready);
    },
    focus() {
      void checkWeb();
      input.focus();
      input.select();
    },
  };
}
