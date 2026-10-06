// The file drop's three views. The drop canvas (upload/canvas.ts) normally
// draws all of this itself; these are what shows if it isn't drawing, and the
// "Keep it / Cancel" card's text.

import { State } from "../core/state";
import { button, card, h } from "./kit";
import type { ViewActions, ViewHost } from "./views";

/** The Drop tab before anything is dragged over: an invitation. */
export function buildUpload(): ViewHost {
  return {
    el: h(
      "div",
      { class: "view" },
      card(
        null,
        h(
          "div",
          { class: "drop-body" },
          h("div", { class: "drop-title", text: "Drop a file on me" }),
          h("div", { class: "drop-sub", text: "I'll absorb it and keep a copy safe in my inbox." }),
        ),
      ),
    ),
    sync() {},
  };
}

/** Copying: the name, how far, and a bar. */
export function buildUploading(): ViewHost {
  const name = h("span", { class: "up-name" });
  const percent = h("span", { class: "up-pct" });
  const fill = h("div", { class: "up-fill" });
  return {
    el: h(
      "div",
      { class: "view" },
      card(null, h("div", { class: "up-row" }, name, percent), h("div", { class: "up-track" }, fill)),
    ),
    sync() {
      const p = State.uploadProgress;
      const done = p >= 0.999;
      const file = State.droppedFile?.name ?? "file";
      name.textContent = done ? `✓  ${file}` : `Copying ${file}`;
      name.classList.toggle("done", done);
      percent.textContent = done ? "" : `${Math.round(p * 100)} %`;
      fill.style.width = `${p * 100}%`;
    },
  };
}

/** "<name> is ready." with Keep it / Cancel. */
export function buildChoose(actions: ViewActions): ViewHost {
  const name = h("b");
  // With a vault, the file can go straight into it.
  const toObsidian = button("Save to Obsidian", "primary", () => actions.saveToObsidian());
  return {
    el: h(
      "div",
      { class: "view" },
      card(
        null,
        h(
          "div",
          { class: "stack", style: "padding:0 18px 0 98px" },
          h("div", { class: "title" }, name, " is ready."),
          h("div", { class: "sub", text: "What do you want to do with it?" }),
          h(
            "div",
            { class: "actions" },
            toObsidian,
            button("Keep it", "secondary", () => actions.keepFile()),
            button("Cancel", "secondary", () => actions.cancelFile()),
          ),
        ),
      ),
    ),
    sync() {
      name.textContent = State.droppedFile?.name ?? "The file";
      toObsidian.hidden = !State.settings.obsidianVault;
    },
  };
}
