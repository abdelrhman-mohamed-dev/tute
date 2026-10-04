// The pieces the settings window is built from: a panel, a row, a switch, a
// result line. Each section of the window is a function returning its panel.

import { h } from "../views/kit";

type Kid = Node | string | null | undefined | false;

/** A panel with a heading. */
export function panel(title: string, ...kids: Kid[]): HTMLElement {
  return h("section", {}, h("h2", { text: title }), ...kids);
}

/** One setting: its name on the left, its controls after. `top` aligns tall controls. */
export function row(name: string, ...kids: Kid[]): HTMLElement {
  return h("div", { class: "row" }, h("label", { text: name }), ...kids);
}

export function topRow(name: string, ...kids: Kid[]): HTMLElement {
  const el = row(name, ...kids);
  el.classList.add("top");
  return el;
}

export function hint(text: string): HTMLElement {
  return h("span", { class: "hint", text });
}

/** An on/off switch. */
export function onOff(on: boolean, changed: (on: boolean) => void): HTMLButtonElement {
  const el = h("button", { class: "switch", "aria-pressed": String(on) });
  el.classList.toggle("on", on);
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    el.setAttribute("aria-pressed", String(next));
    changed(next);
  });
  return el;
}

/** A place for one result line under a control: it worked, or here's why not. */
export function resultLine(): { el: HTMLElement; ok(text: string): void; fail(err: unknown): void; clear(): void } {
  const el = h("div");
  const show = (kind: "ok" | "err", text: string) => el.replaceChildren(h("div", { class: `notice ${kind}`, text }));
  return {
    el,
    ok: (text) => show("ok", text),
    fail: (err) => show("err", errorText(err)),
    clear: () => el.replaceChildren(),
  };
}

/** An error from Rust, as a sentence. */
export function errorText(err: unknown): string {
  return String(err).replace(/^Error:\s*/, "");
}
