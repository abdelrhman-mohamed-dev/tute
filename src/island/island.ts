// The island controller: builds the tile, follows the state machine between
// hidden, bar and open, switches views, and runs the frame loop — which stops
// as soon as nothing moves, so an idle island costs nothing.
//
// The parts it puts together:
//   shape.ts      the outline (size, corners) and the click area for Rust
//   character.ts  the jelly on the island, its glow, where it looks
//   pointer.ts    cursor, clicks, keys, the hover heart
//   dropflow.ts   a dropped file, from the drag to "Keep it"
//   actions.ts    what the views can ask for
//   play.ts       petting, pokes and the rest of the jelly's games

import { Bridge, onDragDrop, type ClaudeReply } from "../core/bridge";
import { EXPANDED_W, PANEL_H, PANEL_W, VIEW_LAYOUTS, type BotEmoteName, type IslandMode, type IslandViewName } from "../core/layout";
import { clamp } from "../core/anim";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { activeLook, setActiveLook, type Skin } from "../jelly/looks";
import { Greeting } from "../jelly/greeting";
import { createMini, syncMinis, tickMinis } from "../jelly/minibots";
import { UploadCanvas } from "../upload/canvas";
import { buildHeader, buildViews, type ViewHost } from "../views/views";
import { h } from "../views/kit";
import { islandActions } from "./actions";
import { has, onLevelUp, type Level } from "./bond";
import { IslandCharacter } from "./character";
import { DropFlow } from "./dropflow";
import { IslandStateMachine } from "./fsm";
import { Play } from "./play";
import { Pointer } from "./pointer";
import { IslandShape } from "./shape";

const RANK: Record<IslandMode, number> = { hidden: 0, compact: 1, expanded: 2 };
/** Views that draw a character of their own, so the island's jelly steps aside. */
const OWN_CHARACTER: ReadonlySet<IslandViewName> = new Set(["greeting", "personality"]);
/** How long the dizzy spell (three pokes) lasts. */
const DIZZY_MS = 3300;
/** The countdown bar shows for the last stretch before the island closes, up to this long. */
const COUNTDOWN_MAX_S = 10;

export class Island {
  readonly fsm = new IslandStateMachine();
  readonly character = new IslandCharacter();
  readonly greeting = new Greeting();
  readonly play: Play;
  readonly drop: DropFlow;
  readonly shape: IslandShape;
  private readonly pointer: Pointer;

  /** Set by island/claude.ts: the ask card's answer goes back to Claude. */
  onAnswerAsk: ((requestId: number, reply: ClaudeReply | null) => void) | null = null;

  // The tile and what's in it.
  private tile!: HTMLElement;
  private content!: HTMLElement;
  private viewsEl!: HTMLElement;
  private greetingCanvas!: HTMLCanvasElement;
  private minis!: HTMLElement;
  private countdown!: HTMLElement;
  private wakeStrip!: HTMLElement;
  private header!: ViewHost;
  private views!: Map<IslandViewName, ViewHost>;
  private dropCanvas!: UploadCanvas;

  // The frame loop.
  private running = false;
  private lastFrame = 0;
  private dirty = true;
  private shownView: IslandViewName | null = null;

  /** Rust opens the window full size (for the greeting); hidden, it shrinks to the wake strip. */
  private shrunk = false;
  private shrinkTimer: number | null = null;
  private dizzyTimer: number | null = null;
  private beforeDizzy: IslandViewName = "overview";
  private noteTimer: number | null = null;

  constructor(private root: HTMLElement) {
    this.play = new Play({
      engine: this.character.engine,
      playable: () =>
        State.mode !== "hidden" &&
        !(State.mode === "expanded" && OWN_CHARACTER.has(State.view)) &&
        !this.drop.showing &&
        State.stateOverride !== "dizzy",
      kick: () => this.kick(),
    });
    this.drop = new DropFlow({
      engine: this.character.engine,
      play: this.play,
      alert: (v) => this.alert(v),
      setView: (v) => this.setView(v),
      note: (m, ms) => this.note(m, ms),
      kick: () => this.kick(),
    });

    this.build();
    this.shape = new IslandShape(this.tile, [this.greetingCanvas, this.dropCanvas.el]);
    this.pointer = new Pointer({
      fsm: this.fsm,
      shape: this.shape,
      character: this.character,
      greeting: this.greeting,
      play: this.play,
      drop: this.drop,
      collapse: () => this.collapse(),
      kick: () => this.kick(),
    });
    this.pointer.wire(this.tile, this.wakeStrip);
    this.shape.apply();

    this.followStateMachine();
    void onDragDrop((e) => this.drop.drag(e));
    this.character.engine.onDizzy = () => this.dizzy();
    this.greeting.onComplete = () => this.fsm.greetComplete();
    onLevelUp((level) => this.levelUp(level));
    State.subscribe(() => {
      this.dirty = true;
      this.kick();
    });
  }

  // ── Building ────────────────────────────────────────────────────────────────

  private build() {
    const actions = islandActions(this);
    this.header = buildHeader(actions);
    this.views = buildViews(actions, () => this.reshape(false));
    this.viewsEl = h("div", { id: "views" }, ...[...this.views.values()].map((v) => v.el));
    this.content = h("div", { id: "content" }, this.header.el, this.viewsEl);

    // The greeting and the drop draw on their own canvases, under the header.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.greetingCanvas = h("canvas", { id: "greeting-canvas" });
    this.greetingCanvas.width = Math.round(EXPANDED_W * dpr);
    this.greetingCanvas.height = Math.round(150 * dpr);
    this.greetingCanvas.style.width = `${EXPANDED_W}px`;
    this.greetingCanvas.style.height = "150px";
    this.dropCanvas = new UploadCanvas({ primary: () => this.drop.keep(), cancel: () => this.drop.cancel() });

    this.minis = h("div", { id: "mini-grid" });
    this.countdown = h("div", { id: "countdown" });
    this.wakeStrip = h("div", { id: "wake-strip" });
    this.tile = h(
      "div",
      { id: "island" },
      h("div", { id: "island-clip" }, this.greetingCanvas, this.dropCanvas.el, this.content),
      this.character.glow,
      this.character.canvas,
      this.minis,
      this.countdown,
    );
    this.root.append(this.wakeStrip, this.tile);
  }

  // ── The state machine ───────────────────────────────────────────────────────

  private followStateMachine() {
    this.fsm.homeToBarDelay = State.settings.autoCloseInterval;
    this.fsm.onTransition = (from, to) => {
      if (to === "hidden") {
        this.setMode("hidden");
      } else if (to === "bar") {
        if (from === "greeting") this.greeting.interrupt();
        if (from === "hidden") Sound.play("peek");
        this.setMode("compact");
        if (from === "greeting") State.view = State.defaultView();
      } else if (to === "home") {
        this.open(State.defaultView());
      } else {
        this.open("greeting");
        this.greeting.start();
      }
      // Arrived somewhere with the cursor already away: start the wait to close.
      if ((to === "bar" || to === "home") && !this.pointer.isInside) this.fsm.mouseLeft();
      State.notify();
    };
  }

  /** First launch asks for a character; every launch after that just greets. */
  launch() {
    if (State.settings.personality) this.fsm.launch();
    else this.alert("personality");
  }

  // ── Modes and views ─────────────────────────────────────────────────────────

  private setMode(mode: IslandMode) {
    const prev = State.mode;
    if (mode === prev) return;
    State.mode = mode;
    if (prev === "hidden") this.play.shown();
    if (mode === "hidden") this.play.hidden();
    if (mode === "expanded") Sound.play("open");
    if (prev === "expanded") {
      Sound.play("close");
      State.isPinned = false;
      void Bridge.focusWindow(false);
    }
    // Shut, nothing of a drop can be seen, and it mustn't keep the loop awake.
    if (mode !== "expanded") this.drop.stop();
    this.fitWindow();
    this.reshape(RANK[mode] < RANK[prev]);
    State.notify();
  }

  /** Open the island on `view` (or switch to it, if it's open already). */
  private open(view: IslandViewName) {
    this.drop.leaving(view);
    State.view = view;
    State.lastActivity = performance.now();
    if (State.mode !== "expanded") this.setMode("expanded");
    else this.reshape(false);
    State.notify();
  }

  setView(view: IslandViewName) {
    this.drop.leaving(view);
    if (State.mode !== "expanded") {
      this.fsm.forceHome();
      State.view = view;
      this.reshape(false);
    } else {
      const shrinking = VIEW_LAYOUTS[view].height < VIEW_LAYOUTS[State.view].height;
      State.view = view;
      State.lastActivity = performance.now();
      this.reshape(shrinking);
    }
    State.notify();
  }

  /** Back to the bar. Through the state machine, so it knows the island is shut. */
  collapse() {
    this.dropPin();
    this.fsm.forceBar();
  }

  /** Something needs you: open on `view`. A pinned alert stays until it's answered. */
  alert(view: IslandViewName) {
    // Until a character is picked, the picker is all there is, and it stays.
    if (!State.settings.personality) {
      view = "personality";
      State.isPinned = true;
    }
    this.fsm.pinned = State.isPinned;
    this.fsm.forceHome();
    this.open(view);
  }

  /** Work happened while hidden: peek out as the bar. */
  reveal() {
    this.fsm.reveal();
  }

  /** The alert no longer waits for an answer: the island may close by itself again. */
  dropPin() {
    State.isPinned = false;
    this.fsm.pinned = false;
  }

  /** A short message on the note card, then back to the usual view. */
  note(message: string, ms: number) {
    State.noteMessage = message;
    this.setView("note");
    if (this.noteTimer != null) window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => {
      this.noteTimer = null;
      if (State.view === "note") this.setView(State.defaultView());
    }, ms);
  }

  /** A one-off reaction from the jelly (a finished turn earns a proud star). */
  emote(name: BotEmoteName) {
    this.character.engine.triggerEmote(name);
    this.kick();
  }

  /**
   * A new bond level: shown now, unless you're in the middle of something
   * (chatting, a drop, answering Claude). Then it waits, and the island opens
   * on it next time (State.defaultView).
   */
  private levelUp(level: Level) {
    State.levelUp = level;
    Sound.play("proud");
    this.character.engine.celebrate(4);
    this.kick();
    const calm = ["empty", "overview", "finished", "bond"].includes(State.view);
    const busy = State.paused || State.isPinned || (State.mode === "expanded" && !calm);
    if (busy) State.notify();
    else this.alert("levelup");
  }

  /** Three pokes: dizzy, the confused view, then back to where it was. */
  private dizzy() {
    if (State.view !== "confused") this.beforeDizzy = State.view;
    State.stateOverride = "dizzy";
    this.character.engine.setState("dizzy");
    Sound.play("dizzy");
    this.alert("confused");
    if (this.dizzyTimer != null) window.clearTimeout(this.dizzyTimer);
    this.dizzyTimer = window.setTimeout(() => {
      this.dizzyTimer = null;
      State.stateOverride = null;
      this.character.engine.setState(State.effectiveState);
      if (State.view === "confused") this.setView(this.beforeDizzy);
      this.character.engine.triggerEmote("happy");
    }, DIZZY_MS);
  }

  // ── Size ────────────────────────────────────────────────────────────────────

  private reshape(shrinking: boolean) {
    this.shape.resize(State.mode, State.view, State.chatHistory.length, shrinking);
    this.kick();
  }

  /**
   * Hidden, the window shrinks to the wake strip once the island has folded
   * away: the OS then sends no cursor events at all, so nothing polls.
   */
  private fitWindow() {
    if (this.shrinkTimer != null) window.clearTimeout(this.shrinkTimer);
    this.shrinkTimer = null;
    if (State.mode === "hidden") {
      this.shrinkTimer = window.setTimeout(() => {
        this.shrinkTimer = null;
        if (State.mode !== "hidden") return;
        this.shrunk = true;
        void Bridge.setCollapsed(true);
      }, 420);
    } else if (this.shrunk) {
      // Full size again before the island starts opening.
      this.shrunk = false;
      void Bridge.setCollapsed(false);
    }
  }

  /** The cursor, in window coordinates (Rust polls it; main.ts passes it on). */
  onCursor(x: number, y: number) {
    this.pointer.move(x, y);
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  /** Makes sure a frame is coming. Anything that starts to move calls this. */
  kick() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.shape.step(dt, nowMs);
    this.shape.apply();
    this.minis.style.left = `${this.shape.w - 54.5}px`;
    this.minis.style.top = `${this.shape.h / 2 - 14.5}px`;

    if (this.dirty) {
      this.dirty = false;
      this.render();
    }

    const open = State.mode === "expanded";
    const greeting = open && State.view === "greeting";
    const dropping = this.drop.showing;
    this.character.aim(this.shape.h, dropping || (open && OWN_CHARACTER.has(State.view)));
    if (greeting) this.drawGreeting();
    // Drawn even under the drop canvas, so it's already in place when that fades.
    else this.character.frame(dt, this.shape.rect());

    if (dropping) this.dropCanvas.draw(this.drop.frame(), nowMs / 1000);
    this.dropCanvas.el.classList.toggle("on", dropping);
    this.viewsEl.classList.toggle("hidden-by-upload", dropping);
    if (this.drop.active) this.drop.step();

    tickMinis(dt);
    const view = this.views.get(State.view);
    view?.tick?.(nowMs);
    this.drawCountdown(nowMs);

    // Hidden, only the folding away may keep frames coming: the jelly's own
    // loops (breathing, z's) are never seen, so they mustn't count.
    const busy = this.shape.animating || (State.mode !== "hidden" && (
      this.character.moving || this.character.engine.busy || greeting ||
      this.drop.active || State.view === "personality" || (view?.busy?.() ?? false)
    ));
    if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
    }
  };

  private drawGreeting() {
    const ctx = this.greetingCanvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.greeting.draw(ctx);
  }

  /** A thin bar that runs down over the last seconds before the island closes. */
  private drawCountdown(nowMs: number) {
    const at = State.mode === "expanded" && !State.isPinned ? this.fsm.closesAt : null;
    const span = Math.min(COUNTDOWN_MAX_S, State.settings.autoCloseInterval * 0.6);
    const left = at === null ? Infinity : (at - nowMs) / 1000;
    this.countdown.style.width = left < span ? `${clamp(left / span, 0, 1) * 160}px` : "0px";
  }

  // ── Rendering the state ─────────────────────────────────────────────────────

  private render() {
    const open = State.mode === "expanded";
    const greeting = open && State.view === "greeting";
    this.content.style.opacity = open && !greeting ? "1" : "0";
    this.content.style.pointerEvents = open && !greeting ? "auto" : "none";
    this.greetingCanvas.style.display = greeting ? "block" : "none";

    this.header.sync();
    for (const [name, view] of this.views) {
      const on = name === State.view;
      view.el.classList.toggle("on", on);
      if (on) view.sync();
    }
    this.passFocus();
    this.renderMinis();

    this.character.engine.setState(State.effectiveState);
    // Wobble and bubbles only while open: the bar holds still, so an island
    // nobody is looking at stops redrawing.
    this.character.engine.live = open;
  }

  /** Only a view with a text field may take the keyboard, and it gives it back. */
  private passFocus() {
    if (this.shownView === State.view) return;
    const prev = this.shownView ? this.views.get(this.shownView) : undefined;
    const next = this.views.get(State.view);
    this.shownView = State.view;
    if (next?.focus) {
      void Bridge.focusWindow(true);
      window.setTimeout(() => next.focus?.(), 120);
    } else if (prev?.focus) {
      void Bridge.focusWindow(false);
    }
  }

  /** The bar's little grid of other sessions. */
  private renderMinis() {
    const show = State.mode === "compact";
    this.minis.style.opacity = show ? "1" : "0";
    if (show) {
      const others = State.otherTasks.slice(0, 4);
      const key = others.map((t) => t.id).join("|");
      if (this.minis.dataset.key !== key) {
        this.minis.dataset.key = key;
        this.minis.replaceChildren(...others.map((t) => createMini(t, 13)));
      }
    }
    syncMinis(State.tasks);
  }

  // ── Looks and settings ──────────────────────────────────────────────────────

  /**
   * Dresses the jelly in its unlocked colour and what was picked (bond.ts),
   * or, with `trying`, a locked look for a moment. Only what's really unlocked
   * stays on, whatever settings.json says.
   */
  dress(trying: { wear?: "hat" | "crown"; skin?: Skin } = {}) {
    const b = State.settings.bond;
    const wear = trying.wear ?? (b?.wear && has(b.wear) ? b.wear : null);
    const skin = trying.skin ?? (b?.skin && has("colours") ? b.skin : null);
    setActiveLook(State.settings.personality, skin, wear);
    const look = activeLook();
    this.character.engine.look = look;
    // The tile's accent follows the jelly (src/styles/shell.css builds the tints from them).
    this.tile.style.setProperty("--jelly", look.body);
    this.tile.style.setProperty("--jelly-rgb", look.rgb);
    this.dirty = true;
    this.kick();
  }

  /** Settings arrived (at boot, or changed): apply them all. */
  applySettings() {
    this.dress();
    this.fsm.hideWhenIdle = State.settings.hideWhenIdle;
    this.fsm.homeToBarDelay = State.settings.autoCloseInterval;
    Sound.setEnabled(State.settings.soundEnabled);
    Sound.setVolume(State.settings.soundVolume);
    State.notify();
  }

  get panelSize() {
    return { w: PANEL_W, h: PANEL_H };
  }
}
