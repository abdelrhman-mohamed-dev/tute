// Island: where it lives, when it closes, whether it hides, and starting with Windows.

import { Bridge } from "../core/bridge";
import type { Settings } from "../core/state";
import { ICONS } from "../views/icons";
import { h } from "../views/kit";
import { choice, group, item, onOff, type Page, type SettingsHost } from "./form";

const CLOSE_AFTER = [10, 15, 30, 60];

/** Where the island lives: the main display, the one under the cursor, or a pinned one. */
function displayPicker(host: SettingsHost): HTMLSelectElement {
  const pick = h("select");
  const fill = async () => {
    const displays = (await Bridge.listMonitors()) ?? [];
    const chosen = host.settings().screen;
    const options = [
      h("option", { value: "primary", text: "Main display" }),
      h("option", { value: "cursor", text: "Wherever the mouse is" }),
      // One by one only when there's a choice to make.
      ...(displays.length > 1 ? displays.map((d) => h("option", { value: d.id, text: d.label })) : []),
    ];
    if (chosen.startsWith("monitor:") && !displays.some((d) => d.id === chosen)) {
      // Pinned but unplugged: keep the choice, and say where the island is meanwhile.
      options.push(h("option", { value: chosen, text: "Unplugged display (using main)" }));
    }
    pick.replaceChildren(...options);
    pick.value = chosen;
  };
  // Refilled whenever the window comes back, so a display plugged in since shows up.
  void fill();
  window.addEventListener("focus", () => void fill());
  pick.addEventListener("change", () => {
    host.settings().screen = pick.value as Settings["screen"];
    void host.save();
  });
  return pick;
}

export function islandPage(host: SettingsHost): Page {
  const s = host.settings();
  const set = (change: (s: Settings) => void) => {
    change(host.settings());
    void host.save();
  };

  // A value saved by an older version (say 20 s) keeps its own chip.
  const seconds = Math.round(s.autoCloseInterval);
  const steps = CLOSE_AFTER.includes(seconds) ? CLOSE_AFTER : [...CLOSE_AFTER, seconds].sort((a, b) => a - b);
  const closeAfter = choice(
    steps.map((n) => ({ value: n, label: `${n}s` })),
    seconds,
    (n) => set((s) => (s.autoCloseInterval = n)),
  );

  return {
    id: "island",
    title: "Island",
    lead: "Where the island sits and when it gets out of your way.",
    icon: ICONS.screen,
    lines: true,
    el: h(
      "div",
      {},
      group(
        "Place",
        item("Lives on", "The display at the top of which the island sits.", displayPicker(host)),
      ),
      group(
        "Behaviour",
        item("Closes after", "How long the open island waits once the mouse leaves.", closeAfter),
        item(
          "Hide when idle",
          "Off: the small bar always stays at the top. On: it tucks away when nothing's going on.",
          onOff(s.hideWhenIdle, (on) => set((s) => (s.hideWhenIdle = on))),
        ),
        item("Start with Windows", "Tute is there when you sign in.", onOff(s.autostart, (on) => set((s) => (s.autostart = on)))),
      ),
    ),
    sync() {
      closeAfter.set(Math.round(host.settings().autoCloseInterval));
    },
  };
}
