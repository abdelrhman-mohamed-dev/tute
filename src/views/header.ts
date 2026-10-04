// The header of the open island: three tabs (home, chat, drop) and three
// buttons (bond, settings, sound), all little drops at the top right.

import { State } from "../core/state";
import type { IslandViewName } from "../core/layout";
import { ICONS } from "./icons";
import { h, svg } from "./kit";
import type { ViewActions, ViewHost } from "./views";

export function buildHeader(actions: ViewActions): ViewHost {
  const go = (view: IslandViewName | (() => IslandViewName)) => () => {
    actions.blip();
    actions.setView(typeof view === "function" ? view() : view);
  };
  const drop = (title: string, onclick: () => void, icon: string, size = 13, cls?: string) =>
    h("button", { class: cls, title, onclick }, svg(icon, size));

  const home = drop("Home", go(() => State.defaultView()), ICONS.house, 13, "tab");
  const chat = drop("Chat", go("prompt"), ICONS.bubble, 13, "tab");
  const files = drop("Drop a file", go("upload"), ICONS.plus, 13, "tab");
  const bond = drop("Our bond", go("bond"), ICONS.heart);
  const gear = drop("Settings", go("settings"), ICONS.gear, 14);
  const sound = drop("Sound", () => actions.toggleSound(), ICONS.speakerOn, 14);

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, home, chat, files),
    h("div", { class: "header-actions" }, bond, gear, sound),
  );

  return {
    el,
    sync() {
      const v = State.view;
      const lit: [HTMLElement, boolean][] = [
        [home, v === "overview" || v === "empty"],
        [chat, v === "prompt"],
        [files, v === "upload"],
        [bond, v === "bond"],
        [gear, v === "settings"],
      ];
      for (const [b, on] of lit) b.classList.toggle("on", on);
      gear.replaceChildren(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 14));
      sound.replaceChildren(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14));
      sound.title = State.settings.soundEnabled ? "Mute" : "Unmute";
      // Nowhere to go while it's dizzy, or before a character is picked.
      el.style.opacity = v === "confused" || v === "personality" ? "0" : "1";
      el.style.pointerEvents = v === "personality" ? "none" : "";
    },
  };
}
