// The overview's step trail: a session's steps as a little timeline of dots on
// a rail, the newest at the bottom. A new step is appended and the whole stack
// slides up from one offset, eased by the island's frame loop (no timers), so
// a burst of steps just stacks up and scrolls, nothing is dropped.

import { h } from "./kit";
import { cubicBezier, clamp } from "../core/anim";
import type { AgentTask } from "../core/state";
import type { BotStateName } from "../core/layout";

const ROW_H = 22;
const SLIDE_MS = 340;
/** Rows kept in the stack (only the last two show; the rest fade out above). */
const KEEP = 4;
/** A burst never slides more than this many rows at once. */
const MAX_SLIDE = 3 * ROW_H;
const ease = cubicBezier(0.22, 1, 0.36, 1);
/** States in which the newest step is really in progress (its dot breathes). */
const ACTIVE: ReadonlySet<BotStateName> = new Set(["working", "thinking", "searching"]);

function stepRow(text: string): HTMLElement {
  return h("div", { class: "step now" }, h("i"), h("span", { text }));
}

export class StepTrail {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private taskId: string | null = null;
  private shown = -1; // the step index on screen
  private slide: { from: number; start: number } | null = null;
  private offset = 0;

  constructor() {
    this.list = h("div", { class: "trail-list" });
    this.el = h("div", { class: "trail" }, this.list);
  }

  get animating(): boolean {
    return this.slide !== null;
  }

  sync(task: AgentTask | null) {
    const steps = task && task.steps.length > 0 ? task.steps : ["…"];
    const idx = task ? Math.min(task.stepIndex, steps.length - 1) : 0;
    this.el.classList.toggle("stopped", !task || !ACTIVE.has(task.state));
    if (task) this.el.style.setProperty("--step", task.color);

    // Another session, the first render, or a restart: lay it out, no slide
    // (scrolling would mix one session's steps into another's).
    const id = task?.id ?? null;
    if (id !== this.taskId || idx < this.shown || this.shown < 0) {
      this.taskId = id;
      this.reset(steps, idx);
      return;
    }

    // The newest step's text can change in place (a tool call gets its detail).
    const last = this.list.lastElementChild?.querySelector("span");
    if (last && idx === this.shown && last.textContent !== steps[idx]) last.textContent = steps[idx];

    for (let i = this.shown + 1; i <= idx; i++) this.push(steps[i]);
    this.shown = idx;
  }

  private reset(steps: string[], idx: number) {
    this.list.replaceChildren();
    for (let i = Math.max(0, idx - 1); i <= idx; i++) this.list.append(stepRow(steps[i]));
    this.list.querySelectorAll(".now").forEach((r, i, all) => i < all.length - 1 && r.classList.remove("now"));
    this.shown = idx;
    this.slide = null;
    this.place(0);
  }

  private push(text: string) {
    this.list.lastElementChild?.classList.remove("now");
    this.list.append(stepRow(text));
    // The list is anchored at the bottom, so appending lifts everything a row:
    // push it back down by a row and let it slide up to rest.
    this.slide = { from: Math.min(this.offset + ROW_H, MAX_SLIDE), start: performance.now() };
    this.place(this.slide.from);
  }

  private place(offset: number) {
    this.offset = offset;
    this.list.style.transform = offset ? `translateY(${offset.toFixed(2)}px)` : "";
  }

  /** Called every frame by the island while the overview is on screen. */
  tick(nowMs: number) {
    if (!this.slide) return;
    const p = clamp((nowMs - this.slide.start) / SLIDE_MS, 0, 1);
    this.place(this.slide.from * (1 - ease(p)));
    if (p < 1) return;
    this.slide = null;
    // Rows that slid out of sight above go; the bottom anchor keeps the rest still.
    while (this.list.childElementCount > KEEP) this.list.firstElementChild?.remove();
  }
}
