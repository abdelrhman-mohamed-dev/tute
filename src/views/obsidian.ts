// Obsidian on the island: jot a thought into today's note, open today's note,
// or find a note and open it in Obsidian. One field does both: Enter adds the
// line, "Find" searches for it instead.

import { ObsidianBridge, type ObsidianFound } from "../core/bridge";
import { State } from "../core/state";
import { button, card, h } from "./kit";
import type { ViewActions, ViewHost } from "./views";

/** Obsidian's own violet. */
export const OBSIDIAN = "#a882ff";

/** The chosen vault's folder name ("Notes"), or "" without one. */
export const vaultName = () => State.settings.obsidianVault?.split(/[\\/]/).filter(Boolean).pop() ?? "";
const errorText = (err: unknown) => String(err).replace(/^Error:\s*/, "");

export function buildObsidian(actions: ViewActions): ViewHost {
  const input = h("input", { type: "text", class: "chat-input", placeholder: "Jot something into today's note…", maxlength: "500" });
  const add = button("Add", "primary", () => void jot());
  const find = button("Find", "secondary", () => void search());
  const today = h("button", { class: "quick", onclick: () => void openToday() }, h("i", { class: "quick-dot", style: `background:${OBSIDIAN}` }), h("span", { text: "Today's note ↗" }));
  const vault = h("span", { class: "dim-note" });
  const result = h("span", { class: "dim-note lin-result" });
  const list = h("div", { class: "lin-list" });

  let busy = false;
  let found: ObsidianFound[] | null = null;

  const say = (text: string, failed = false) => {
    result.replaceChildren(h("span", { class: failed ? "lin-err" : "", text }));
  };

  async function jot() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    try {
      const { note } = await ObsidianBridge.capture(text);
      input.value = "";
      found = null;
      render();
      say(`Added to ${note.split("/").pop()?.replace(/\.md$/, "")} ✓`);
      actions.emote("happy");
    } catch (err) {
      say(errorText(err), true);
    } finally {
      busy = false;
    }
  }

  async function search() {
    const query = input.value.trim();
    if (!query || busy) return;
    busy = true;
    say("Looking…");
    try {
      found = await ObsidianBridge.search(query);
      say(found.length ? `${found.length} note${found.length === 1 ? "" : "s"}` : "Nothing found.");
    } catch (err) {
      found = null;
      say(errorText(err), true);
    } finally {
      busy = false;
      render();
    }
  }

  async function openToday() {
    actions.blip();
    try {
      await ObsidianBridge.openToday();
    } catch (err) {
      say(errorText(err), true);
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void (e.ctrlKey ? search() : jot());
    if (e.key === "Escape" && found) {
      e.stopPropagation();
      found = null;
      render();
    }
  });

  function render() {
    list.replaceChildren(
      ...(found ?? []).map((note) =>
        h(
          "div",
          { class: "lin-row", title: note.path, onclick: () => ObsidianBridge.open(note.path).catch((err) => say(errorText(err), true)) },
          h("i", { class: "quick-dot", style: `background:${OBSIDIAN}` }),
          h("span", { class: "lin-text" }, h("b", { text: note.title }), note.snippet ? h("span", { class: "dim-note", text: `  ${note.snippet}` }) : null),
        ),
      ),
    );
    list.hidden = !found?.length;
  }

  return {
    el: h(
      "div",
      { class: "view" },
      card(
        null,
        h(
          "div",
          { class: "stack lin-stack obs-stack" },
          h("div", { class: "lin-head" }, h("span", { class: "lin-title", text: "Obsidian" }), vault),
          h("div", { class: "chat-bar lin-field" }, input),
          h("div", { class: "lin-chips" }, today, h("div", { class: "grow" }), result, find, add),
          list,
        ),
      ),
    ),
    focus: () => input.focus(),
    sync() {
      vault.textContent = vaultName() ? `· ${vaultName()}` : "";
      render();
    },
  };
}
