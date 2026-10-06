// The pieces every settings page is made of. A page is a stack of groups; a
// group is a stack of items; an item is a title, a line saying what it does,
// and its control on the right. Every change saves on its own.

import type { Settings } from "../core/state";
import { h } from "../views/kit";

type Kid = Node | string | null | undefined | false;

/** What every page gets: the settings, and a way to save them. */
export interface SettingsHost {
  settings(): Settings;
  save(): Promise<void>;
}

/** A page of the window: its menu entry and what it shows. */
export interface Page {
  id: string;
  title: string;
  /** One line under the title. */
  lead: string;
  icon: string;
  /** Line icons are drawn with a stroke; the others are filled. */
  lines?: boolean;
  el: HTMLElement;
  /** Called when the page is shown, and when settings change elsewhere. */
  sync?(): void;
}

/** A card of items, with an optional small heading above it. */
export function group(title: string | null, ...kids: Kid[]): HTMLElement {
  return h("div", { class: "group-wrap" }, title && h("h3", { class: "group-title", text: title }), h("div", { class: "group" }, ...kids));
}

/** One setting: title and explanation on the left, its control on the right. */
export function item(title: string, about: string | Node, ...controls: Kid[]): HTMLElement {
  return h(
    "div",
    { class: "item" },
    h("div", { class: "item-text" }, h("div", { class: "item-title", text: title }), h("div", { class: "item-about" }, about)),
    h("div", { class: "item-control" }, ...controls),
  );
}

/** An on/off switch. */
export function onOff(on: boolean, changed: (on: boolean) => void): HTMLButtonElement {
  const el = h("button", { class: "switch", role: "switch" });
  const show = (v: boolean) => {
    el.classList.toggle("on", v);
    el.setAttribute("aria-checked", String(v));
  };
  show(on);
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    show(next);
    changed(next);
  });
  return el;
}

/** A row of choices, one lit. `set` changes which, without calling back. */
export function choice<T extends string | number>(
  options: { value: T; label: string }[],
  current: T,
  picked: (value: T) => void,
): HTMLElement & { set(value: T): void } {
  const buttons = options.map((o) =>
    h("button", {
      text: o.label,
      onclick: () => {
        set(o.value);
        picked(o.value);
      },
    }),
  );
  const set = (value: T) => buttons.forEach((b, i) => b.classList.toggle("on", options[i].value === value));
  set(current);
  return Object.assign(h("div", { class: "choice" }, ...buttons), { set });
}

/** A status: a coloured dot and a few words. */
export function status(kind: "on" | "off" | "wait" | "bad", text: string): HTMLElement {
  return h("span", { class: `status ${kind}` }, h("i"), text);
}

/** A place for one result line under a control: it worked, or here's why not. */
export function resultLine(): { el: HTMLElement; ok(text: string): void; fail(err: unknown): void; clear(): void } {
  const el = h("div", { class: "result" });
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
