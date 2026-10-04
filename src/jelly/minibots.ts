// Little jellies for other sessions: the pills in the overview and the grid in
// the bar. Each is a solid-coloured JellyEngine on its own canvas. The island's
// frame loop calls `tickMinis` once per frame; a mini whose canvas has left the
// page (views are rebuilt wholesale) drops out on the next tick by itself.

import { JellyEngine, hexToRGB } from "./engine";
import type { AgentTask } from "../core/state";

/** The engine draws the body at this share of its canvas. */
const BODY_SHARE = 0.6;

class Mini {
  readonly slot: HTMLSpanElement;
  readonly engine = new JellyEngine();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly size: number;
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);
  private readonly born = performance.now();

  constructor(readonly taskId: string, body: number) {
    // The canvas is bigger than the body, centred in a body-sized slot and
    // spilling over it, so the jelly itself is exactly `body` px across.
    this.size = body / BODY_SHARE;
    this.slot = document.createElement("span");
    this.slot.className = "mini";
    this.slot.style.width = this.slot.style.height = `${body}px`;

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = Math.round(this.size * this.dpr);
    this.canvas.style.width = this.canvas.style.height = `${this.size}px`;
    this.slot.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.engine.isMini = true;
  }

  /** Gone from the page. A brand-new slot gets a moment to be appended first. */
  get gone(): boolean {
    return !this.canvas.isConnected && performance.now() - this.born > 1000;
  }

  show(task: AgentTask, first = false) {
    this.engine.bodyColor = hexToRGB(task.color);
    this.engine.setState(task.state, first);
  }

  frame(dt: number) {
    if (!this.ctx) return;
    this.engine.update(dt);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.size, this.size);
    this.engine.draw(this.ctx, this.size, this.size);
  }
}

const minis = new Set<Mini>();

/** A mini jelly for `task`, `body` CSS px across. Append the returned slot anywhere. */
export function createMini(task: AgentTask, body: number): HTMLElement {
  const mini = new Mini(task.id, body);
  mini.show(task, true);
  if (task.emote) mini.engine.setPermanentEmote(task.emote);
  if (task.miniEye) {
    mini.engine.permanentEye = task.miniEye;
    mini.engine.eyeOverride = task.miniEye;
    mini.engine.eyeOverrideUntil = Number.POSITIVE_INFINITY;
  }
  minis.add(mini);
  return mini.slot;
}

/** Brings every mini's mood and colour up to date with its session. */
export function syncMinis(tasks: AgentTask[]) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const mini of minis) {
    const task = byId.get(mini.taskId);
    if (task) mini.show(task);
  }
}

/** Advances and redraws every mini still on the page. */
export function tickMinis(dt: number) {
  for (const mini of minis) {
    if (mini.gone) minis.delete(mini);
    else mini.frame(dt);
  }
}

export const miniCount = () => minis.size;
