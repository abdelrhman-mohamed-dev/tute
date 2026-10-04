// General: the buddy, sound, auto-close, which display, hiding when idle,
// starting with Windows.

import { Bridge } from "../core/bridge";
import type { Settings } from "../core/state";
import { LOOKS, PERSONALITIES } from "../jelly/looks";
import { JellyPreview } from "../jelly/preview";
import { h } from "../views/kit";
import { hint, onOff, panel, row, topRow } from "./form";

export interface SettingsHost {
  settings(): Settings;
  save(): Promise<void>;
}

/** The two characters, live; the chosen one is outlined. `sync` follows a change from the island. */
function buddies(host: SettingsHost): { el: HTMLElement; sync(): void } {
  const tiles = PERSONALITIES.map((id) => {
    const live = new JellyPreview(LOOKS[id], 64, 18);
    const tile = h(
      "button",
      {
        class: `buddy-tile ${id}`,
        title: `Use ${LOOKS[id].name}`,
        onmouseenter: () => {
          live.engine.tgEs = 1.08;
          live.engine.triggerEmote(id === "tutee" ? "love" : "happy");
        },
        onmouseleave: () => {
          live.engine.tgEs = 1;
        },
        onclick: () => {
          const s = host.settings();
          if (s.personality === id) return;
          s.personality = id;
          live.engine.triggerEmote("happy");
          sync();
          void host.save();
        },
      },
      live.canvas,
      h("span", { class: "buddy-name", text: LOOKS[id].name }),
    );
    return { id, tile, live };
  });

  const sync = () => {
    const chosen = host.settings().personality ?? "tute";
    for (const t of tiles) t.tile.classList.toggle("on", t.id === chosen);
  };
  sync();

  // They move only while you can see them: hidden or in the background, the
  // window draws one still frame and then costs nothing.
  let mouse = { x: 0, y: 0 };
  let running = false;
  window.addEventListener("mousemove", (e) => {
    mouse = { x: e.clientX, y: e.clientY };
  });
  const frame = (nowMs: number) => {
    for (const { live } of tiles) {
      live.lookAt(mouse.x, mouse.y);
      live.tick(nowMs);
    }
    if (document.visibilityState === "visible" && document.hasFocus()) {
      requestAnimationFrame(frame);
    } else {
      running = false;
      for (const { live } of tiles) live.pause();
    }
  };
  const start = () => {
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  };
  window.addEventListener("focus", start);
  document.addEventListener("visibilitychange", start);
  start();

  return { el: h("div", { class: "buddy-tiles" }, ...tiles.map((t) => t.tile)), sync };
}

/** Where the island lives: the main display, the one under the cursor, or a pinned one. */
function displayPicker(host: SettingsHost): HTMLSelectElement {
  const pick = h("select");
  // Refilled whenever the window comes back, so a newly plugged display shows up.
  const fill = async () => {
    const displays = (await Bridge.listMonitors()) ?? [];
    const chosen = host.settings().screen;
    const options = [
      h("option", { value: "primary", text: "Main display" }),
      h("option", { value: "cursor", text: "Display under the cursor" }),
      // One by one only when there's a choice to make.
      ...(displays.length > 1 ? displays.map((d) => h("option", { value: d.id, text: d.label })) : []),
    ];
    if (chosen.startsWith("monitor:") && !displays.some((d) => d.id === chosen)) {
      // Pinned, but unplugged: keep the choice, and say where the island is meanwhile.
      options.push(h("option", { value: chosen, text: "Disconnected display (using main)" }));
    }
    pick.replaceChildren(...options);
    pick.value = chosen;
  };
  void fill();
  window.addEventListener("focus", () => void fill());
  pick.addEventListener("change", () => {
    host.settings().screen = pick.value as Settings["screen"];
    void host.save();
  });
  return pick;
}

export function generalPanel(host: SettingsHost): { el: HTMLElement; sync(): void } {
  const s = host.settings();
  const set = (change: (s: Settings) => void) => {
    change(host.settings());
    void host.save();
  };

  const volume = h("input", { type: "range", min: "0", max: "0.2", step: "0.005", value: String(s.soundVolume) });
  volume.addEventListener("input", () => set((s) => (s.soundVolume = Number(volume.value))));

  const autoClose = h("input", {
    type: "number",
    min: "5",
    max: "120",
    step: "1",
    value: String(Math.round(s.autoCloseInterval)),
    style: "width:72px",
  });
  autoClose.addEventListener("change", () => {
    const seconds = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(seconds);
    set((s) => (s.autoCloseInterval = seconds));
  });

  const buddy = buddies(host);
  const el = panel(
    "General",
    topRow("Buddy", buddy.el),
    row("Sound", onOff(s.soundEnabled, (on) => set((s) => (s.soundEnabled = on))), volume),
    row("Auto-close", autoClose, hint("seconds after you leave the island")),
    row("Island lives on", displayPicker(host)),
    row(
      "Hide when idle",
      onOff(s.hideWhenIdle, (on) => set((s) => (s.hideWhenIdle = on))),
      hint("off: the small bar always stays at the top"),
    ),
    row("Start with Windows", onOff(s.autostart, (on) => set((s) => (s.autostart = on)))),
  );
  return { el, sync: buddy.sync };
}
