// The settings window: a menu of pages on the left (Buddy, Island, Chat
// models, Memory, Connections, About), one page at a time on the right. Every change
// saves at once; "Saved" at the bottom of the menu says so. Changes made on
// the island (another model, the other buddy) show up here too.

import "./settings.css";
import { Bridge, onEvent } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { LOOKS } from "../jelly/looks";
import { JellyPreview } from "../jelly/preview";
import { h, svg } from "../views/kit";
import { aboutPage } from "./about";
import { buddyPage } from "./buddy";
import { connectionsPage } from "./connections";
import type { Page, SettingsHost } from "./form";
import { islandPage } from "./island";
import { memoryPage } from "./memory";
import { modelsPage } from "./models";

/** The page you were on, kept for next time (best effort). */
const PAGE_KEY = "tute.settingsPage";

function remembered(): string | null {
  try {
    return localStorage.getItem(PAGE_KEY);
  } catch {
    return null;
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(PAGE_KEY, id);
  } catch {
    // No storage: it opens on Buddy next time.
  }
}

/** "Saving…" while a save runs, then "Saved" for a moment. */
function savedNote(): { el: HTMLElement; saving(): void; saved(): void } {
  const el = h("div", { class: "saved" });
  let timer: number | undefined;
  return {
    el,
    saving() {
      window.clearTimeout(timer);
      el.textContent = "Saving…";
      el.classList.add("show");
    },
    saved() {
      el.textContent = "✓ Saved";
      timer = window.setTimeout(() => el.classList.remove("show"), 1600);
    },
  };
}

async function main() {
  const boot = await Bridge.boot();
  let settings: Settings = { ...DEFAULT_SETTINGS, ...boot?.settings };
  const note = savedNote();
  const host: SettingsHost = {
    settings: () => settings,
    save: async () => {
      note.saving();
      await Bridge.saveSettings(settings);
      note.saved();
    },
  };

  const models = modelsPage(host);
  const pages: Page[] = [buddyPage(host), islandPage(host), models, memoryPage(host), connectionsPage(host), aboutPage(boot?.version ?? "")];

  // A tiny jelly by the name, in the chosen look.
  const mascot = new JellyPreview(LOOKS[settings.personality ?? "tute"], 26, 6);
  mascot.tick(performance.now());

  const title = h("h1");
  const lead = h("p", { class: "lead" });
  const body = h("div", { class: "page-body" });
  const tabs = pages.map((p) =>
    h("button", { class: "tab", onclick: () => show(p) }, svg(p.icon, 16, p.lines ? { stroke: 1.8 } : {}), h("span", { text: p.title })),
  );

  function show(page: Page) {
    tabs.forEach((t, i) => t.classList.toggle("on", pages[i] === page));
    title.textContent = page.title;
    lead.textContent = page.lead;
    body.replaceChildren(page.el);
    page.sync?.();
    document.querySelector(".page")?.scrollTo(0, 0);
    remember(page.id);
  }

  document.getElementById("settings-root")!.replaceChildren(
    h(
      "nav",
      { class: "side" },
      h("div", { class: "brand" }, mascot.canvas, h("span", { text: "Tute" })),
      ...tabs,
      h("div", { class: "grow" }),
      note.el,
    ),
    h("main", { class: "page" }, h("header", {}, title, lead), body),
  );
  show(pages.find((p) => p.id === remembered()) ?? pages[0]);
  // The island can ask for a page (Obsidian's chip opens Connections) by
  // setting the key; the other window's change arrives as a storage event.
  window.addEventListener("storage", (e) => {
    const page = e.key === PAGE_KEY && pages.find((p) => p.id === e.newValue);
    if (page) show(page);
  });

  // Changes from the island. The models page only redraws when the active
  // model really changed, so a half-typed key isn't wiped by our own saves.
  let active = JSON.stringify(settings.activeModel);
  void onEvent<Settings>("settings-changed", (next) => {
    settings = { ...settings, ...next };
    mascot.engine.look = LOOKS[settings.personality ?? "tute"];
    mascot.tick(performance.now());
    const now = JSON.stringify(settings.activeModel);
    const shown = pages.find((p) => p.el.isConnected);
    if (shown && shown !== models) shown.sync?.();
    if (now !== active) {
      active = now;
      models.refresh();
    }
  });
}

void main();
