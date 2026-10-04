// The building blocks of every view: an element maker, icons, and the shared
// pieces (body column, buttons, a session's "who" line). No framework; a view
// is a function that builds its elements once and updates them in `sync`.

import { washRGBA, type Wash } from "../core/layout";
import type { AgentTask } from "../core/state";

type Props = Record<string, string | number | boolean | EventListener | null | undefined>;
type Kid = Node | string | null | undefined | false;

/**
 * Makes an element. Props: `class`, `text`, `html`, `style`, `on<event>`
 * handlers; anything else becomes an attribute (true = present, false/null = left out).
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") el.className = String(value);
    else if (key === "text") el.textContent = String(value);
    else if (key === "html") el.innerHTML = String(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  el.append(...kids.filter((k): k is Node | string => k != null && k !== false));
  return el;
}

const SVG = "http://www.w3.org/2000/svg";

/** An icon from views/icons.ts on a 24-unit grid: filled, or outlined at `stroke` width. */
export function svg(path: string, size = 14, { fill = "currentColor", stroke = 0 } = {}): SVGSVGElement {
  const el = document.createElementNS(SVG, "svg");
  const p = document.createElementNS(SVG, "path");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true" })) {
    el.setAttribute(k, String(v));
  }
  p.setAttribute("d", path);
  if (stroke) {
    for (const [k, v] of Object.entries({ fill: "none", stroke: "currentColor", "stroke-width": stroke, "stroke-linecap": "round", "stroke-linejoin": "round" })) {
      p.setAttribute(k, String(v));
    }
  } else {
    p.setAttribute("fill", fill);
  }
  el.append(p);
  return el;
}

export function clear(el: Element) {
  el.replaceChildren();
}

/** A round dot of colour, like the one beside every session's name. */
export function dot(color: string, size = 7): HTMLElement {
  return h("i", { class: "dot", style: `width:${size}px;height:${size}px;background:${color}` });
}

/** A view's card, tinted by mood (`wash`) or plain. */
export function card(wash: Wash, ...kids: Kid[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...kids);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

/** The column of text beside the jelly; `inset` leaves room for it on the left. */
export function body(inset: number, ...kids: Kid[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...kids);
  el.style.padding = `4px 16px 4px ${inset}px`;
  return el;
}

/** A bead-shaped button, solid (`primary`) or tinted. */
export function button(label: string, kind: "primary" | "secondary", onclick: () => void, key?: string): HTMLButtonElement {
  return h("button", { class: `btn ${kind}`, onclick }, h("span", { text: label }), key ? h("span", { class: "kbd", text: key }) : null);
}

/** "● tute  finished": the session's dot and name, then a grey note. */
export function who(task: AgentTask | null, note: string): HTMLElement {
  return h(
    "div",
    { class: "who-row" },
    task && dot(task.color, 8),
    task && h("span", { class: "n", text: task.name }),
    h("span", { text: note }),
  );
}

/** "#34D399" → "52, 211, 153", for rgba() in CSS. */
export function rgbOf(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** The colour, lifted towards white by `amount` (0…1). */
export function lighter(hex: string, amount: number): string {
  const lift = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = rgbOf(hex).split(", ").map(Number);
  return `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`;
}
