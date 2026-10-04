// First launch: "Who do you want on your screen?" Tute and Tutee, live, side
// by side. The one you pick is saved and greets you.

import { State } from "../core/state";
import { LOOKS, PERSONALITIES, type Personality } from "../jelly/looks";
import { JellyPreview } from "../jelly/preview";
import { h } from "./kit";
import type { ViewHost } from "./views";

export function buildPicker(onPick: (p: Personality) => void): ViewHost {
  const choices = PERSONALITIES.map((id) => {
    const look = LOOKS[id];
    const live = new JellyPreview(look, 70, 20);
    const tile = h(
      "button",
      {
        class: `persona ${id}`,
        title: `Choose ${look.name}`,
        // Hovered, it perks up and reacts: Tutee loves you, Tute grins.
        onmouseenter: () => {
          live.engine.tgEs = 1.08;
          live.engine.triggerEmote(id === "tutee" ? "love" : "happy");
        },
        onmouseleave: () => {
          live.engine.tgEs = 1;
        },
        onclick: () => {
          live.engine.triggerEmote("happy");
          onPick(id);
        },
      },
      live.canvas,
      h("span", { class: "persona-name", text: look.name }),
    );
    return { tile, live };
  });

  return {
    el: h(
      "div",
      { class: "view" },
      h(
        "div",
        { class: "card persona-card" },
        h(
          "div",
          { class: "persona-intro" },
          h("div", { class: "title", text: "Who do you want on your screen?" }),
          h("div", { class: "sub", text: "Pick your buddy. You can change it later in Settings." }),
        ),
        h("div", { class: "persona-tiles" }, ...choices.map((c) => c.tile)),
      ),
    ),
    sync() {},
    tick(nowMs) {
      // Each follows the cursor on its own, so they look at you, not at each other.
      for (const { live } of choices) {
        live.lookAt(State.mouse.x, State.mouse.y);
        live.tick(nowMs);
      }
    },
  };
}
