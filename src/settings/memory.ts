// Memory: what Tute remembers about you, yours to see, edit, add to or wipe;
// and how long saved chats are kept. All of it stays on this PC
// (src-tauri/src/memory.rs).

import { ChatsBridge, MemoryBridge } from "../core/bridge";
import type { MemoryItem } from "../core/state";
import { ICONS } from "../views/icons";
import { h } from "../views/kit";
import { choice, group, item, onOff, resultLine, type Page, type SettingsHost } from "./form";

const KEEP = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 0, label: "Always" },
];

export function memoryPage(host: SettingsHost): Page {
  const list = h("div", { class: "group" });
  const count = h("span");
  const result = resultLine();
  let memories: MemoryItem[] = [];

  /** One memory: its text, which turns into a field to edit it. */
  function row(m: MemoryItem): HTMLElement {
    const text = h("div", { class: "item-title memory-text", text: m.text });
    const field = h("input", { type: "text", value: m.text, maxlength: "200" });
    field.hidden = true;
    const done = async () => {
      if (field.value.trim() !== m.text) {
        await MemoryBridge.edit(m.id, field.value).catch((err) => result.fail(err));
      }
      await load();
    };
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void done();
      if (e.key === "Escape") void load();
    });
    field.addEventListener("blur", () => void done());
    const editButton = h("button", {
      class: "quiet",
      text: "Edit",
      onclick: () => {
        text.hidden = true;
        field.hidden = false;
        field.focus();
        field.select();
      },
    });
    const forget = h("button", {
      class: "quiet",
      text: "Forget",
      onclick: async () => {
        await MemoryBridge.forget(m.id);
        await load();
      },
    });
    const el = h("div", { class: "item" }, h("div", { class: "item-text" }, text, field), h("div", { class: "item-control" }, editButton, forget));
    return el;
  }

  /** "+ Add something yourself": a field that saves on Enter. */
  function adder(): HTMLElement {
    const field = h("input", { type: "text", placeholder: "Something Tute should know, like “I prefer metric units”", maxlength: "200" });
    const add = async () => {
      if (!field.value.trim()) return;
      try {
        await MemoryBridge.add(field.value);
        field.value = "";
        await load();
      } catch (err) {
        result.fail(err);
      }
    };
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void add();
    });
    return h("div", { class: "item" }, h("div", { class: "item-text" }, field), h("div", { class: "item-control" }, h("button", { text: "Add", onclick: () => void add() })));
  }

  async function load() {
    memories = (await MemoryBridge.list()) ?? [];
    count.textContent = memories.length ? `It remembers (${memories.length})` : "It remembers";
    list.replaceChildren(
      ...(memories.length
        ? memories.map(row)
        : [h("div", { class: "empty", text: "Nothing yet. Tell it about yourself in the chat, or add something here." })]),
      adder(),
    );
  }

  const s = host.settings();
  const on = onOff(s.memoryOn, (value) => {
    host.settings().memoryOn = value;
    void host.save();
  });

  let sureAll = false;
  const forgetAll = h("button", { class: "danger", text: "Forget everything" });
  forgetAll.addEventListener("click", async () => {
    if (!sureAll) {
      sureAll = true;
      forgetAll.textContent = "Click again to forget it all";
      window.setTimeout(() => {
        sureAll = false;
        forgetAll.textContent = "Forget everything";
      }, 3000);
      return;
    }
    await MemoryBridge.forgetAll().catch((err) => result.fail(err));
    result.ok("Done. Tute doesn't remember anything about you now.");
    await load();
  });

  // ── Saved chats ──
  const chatsAbout = h("span");
  const keep = choice(KEEP, s.chatKeepDays, (days) => {
    host.settings().chatKeepDays = days;
    void host.save().then(countChats);
  });
  let sureChats = false;
  const clearChats = h("button", { class: "danger", text: "Clear all" });
  clearChats.addEventListener("click", async () => {
    if (!sureChats) {
      sureChats = true;
      clearChats.textContent = "Click again to clear";
      window.setTimeout(() => {
        sureChats = false;
        clearChats.textContent = "Clear all";
      }, 3000);
      return;
    }
    await ChatsBridge.clear().catch((err) => result.fail(err));
    result.ok("All saved chats are gone.");
    await countChats();
  });
  async function countChats() {
    const n = (await ChatsBridge.list())?.length ?? 0;
    chatsAbout.textContent = n ? `${n} saved chat${n === 1 ? "" : "s"}, kept on this PC.` : "Chats are saved on this PC as you go.";
  }

  return {
    id: "memory",
    title: "Memory",
    lead: "What Tute knows about you. Only on this PC, only sent to your chosen model.",
    icon: ICONS.brain,
    lines: true,
    el: h(
      "div",
      {},
      group(
        null,
        item("Remember things I tell it", "It picks up lasting things, like preferences and how you work. Off: it forgets after each chat.", on),
      ),
      h("div", { class: "group-wrap" }, h("h3", { class: "group-title" }, count), list),
      group("Saved chats", item("Keep chats for", chatsAbout, keep), item("Start fresh", "Delete every saved chat, or everything Tute remembers.", clearChats, forgetAll)),
      result.el,
    ),
    sync() {
      on.classList.toggle("on", host.settings().memoryOn);
      keep.set(host.settings().chatKeepDays);
      void load();
      void countChats();
    },
  };
}
