// The gear view: the settings you change most, without leaving the island.
// Sound and volume, auto-close, the chat's model, the character. Everything
// else is in the settings window.

import { State } from "../core/state";
import { LOOKS, PERSONALITIES } from "../jelly/looks";
import { JellyPreview } from "../jelly/preview";
import { ICONS } from "./icons";
import { card, h, svg } from "./kit";
import { modelPicker } from "./modelpick";
import type { ViewActions, ViewHost } from "./views";

const AUTO_CLOSE = [10, 15, 30];

export function buildGear(actions: ViewActions): ViewHost {
  const sound = h("button", { class: "switch", title: "Sound", onclick: () => actions.toggleSound() });
  const volume = h("input", {
    type: "range",
    min: "0",
    max: "0.2",
    step: "0.005",
    title: "Volume",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  });
  const autoText = h("span");
  const autoClose = AUTO_CLOSE.map((s) => h("button", { text: `${s}s`, onclick: () => actions.setAutoClose(s) }));
  // Each character's button holds a tiny live one, following the cursor.
  const characters = PERSONALITIES.map((p) => {
    const preview = new JellyPreview(LOOKS[p], 26, 6);
    const pick = h(
      "button",
      { class: "buddy-btn", onclick: () => actions.setPersonality(p) },
      preview.canvas,
      h("span", { text: LOOKS[p].name }),
    );
    return { p, preview, pick };
  });
  const models = modelPicker((m) => actions.setActiveModel(m));

  const row = (...kids: (Node | string)[]) => h("div", { class: "settings-row" }, ...kids);
  const rows = h(
    "div",
    { class: "settings-rows" },
    row(sound, h("span", { text: "Sound" }), volume),
    row(svg(ICONS.timer, 12), autoText, h("div", { class: "seg" }, ...autoClose)),
    row(svg(ICONS.bubble, 12), h("span", { text: "Model" }), models.el),
    row(
      h("span", { text: "Buddy" }),
      h("div", { class: "seg", style: "margin-left:0" }, ...characters.map((c) => c.pick)),
      h("div", { class: "grow" }),
      h("button", {
        class: "link-btn",
        style: "color:var(--text-dim);font-size:11.5px",
        text: "Settings…",
        onclick: () => actions.openSettingsWindow(),
      }),
    ),
  );

  const content = h("div", { class: "stack", style: "padding:14px 16px 14px 84px" }, rows);
  return {
    el: h("div", { class: "view" }, card(null, content)),
    tick(nowMs) {
      for (const { preview } of characters) {
        preview.lookAt(State.mouse.x, State.mouse.y);
        preview.tick(nowMs);
      }
    },
    sync() {
      const s = State.settings;
      sound.classList.toggle("on", s.soundEnabled);
      volume.value = String(s.soundVolume);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoText.textContent = `Auto-close · ${Math.round(s.autoCloseInterval)}s`;
      autoClose.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === AUTO_CLOSE[i]));
      for (const c of characters) c.pick.classList.toggle("on", (s.personality ?? "tute") === c.p);
      models.sync();
    },
  };
}
