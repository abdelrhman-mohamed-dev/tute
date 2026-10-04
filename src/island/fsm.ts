// When the island is hidden, a small bar, open ("home"), or greeting on
// launch. It holds one pending move at a time — "go to the bar in 15 s",
// "hide in 60 s" — and replaces it whenever something new happens, so two
// timers can never fight over the island. No DOM, no Tauri: it only says
// when the state changes.

export type FsmState = "hidden" | "bar" | "home" | "greeting";

export class IslandStateMachine {
  state: FsmState = "hidden";

  onTransition: ((from: FsmState, to: FsmState) => void) | null = null;

  /** Open → bar after the mouse leaves, seconds (Settings → Auto-close). */
  homeToBarDelay = 15;
  /** Bar → hidden after the mouse leaves, seconds (only with hideWhenIdle). */
  barToHiddenDelay = 60;
  /** A pinned alert (a question, a permission prompt) stays open. */
  pinned = false;
  /** Off (the default): the bar stays on screen. On: it hides when idle. */
  hideWhenIdle = false;

  /** The greeting folds into the bar this soon after it ends… */
  private readonly greetEndDelay = 0.6;
  /** …or this long after the mouse arrives on it. */
  private readonly greetHoverDelay = 10;

  private pending: { timer: number; to: FsmState; at: number } | null = null;

  /** When the open island will fold to the bar (performance.now ms), if it will. */
  get closesAt(): number | null {
    return this.state === "home" && this.pending?.to === "bar" ? this.pending.at : null;
  }

  // ── What happens ──────────────────────────────────────────────────────────

  launch() {
    this.go("greeting");
  }

  mouseEntered() {
    switch (this.state) {
      case "hidden":
        this.go("bar");
        break;
      case "greeting":
        this.after(this.greetHoverDelay, "bar");
        break;
      default:
        // Back on the bar or the open island: whatever was about to close it waits.
        this.cancel();
    }
  }

  mouseLeft() {
    switch (this.state) {
      case "bar":
        if (this.hideWhenIdle) this.after(this.barToHiddenDelay, "hidden");
        break;
      case "home":
        if (!this.pinned) this.after(this.homeToBarDelay, "bar");
        break;
      case "greeting":
        this.go("bar");
        break;
    }
  }

  click() {
    if (this.state === "bar") this.go("home");
  }

  /** The greeting animation ended. A hover's longer wait isn't cut short. */
  greetComplete() {
    if (this.state === "greeting" && !this.pending) this.after(this.greetEndDelay, "bar");
  }

  /** Work happened while hidden: peek out as the bar. */
  reveal() {
    if (this.state !== "hidden") return;
    this.go("bar");
    if (this.hideWhenIdle) this.after(this.barToHiddenDelay, "hidden");
  }

  forceHome() {
    this.go("home");
  }

  /** Close to the bar now (OK, Escape, an answered alert). */
  forceBar() {
    this.go("bar");
  }

  forceHidden() {
    this.go("hidden");
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  /** Move now, dropping anything pending. */
  private go(to: FsmState) {
    this.cancel();
    if (to === this.state) return;
    const from = this.state;
    this.state = to;
    this.onTransition?.(from, to);
  }

  /** Move later — unless something else happens first. */
  private after(seconds: number, to: FsmState) {
    this.cancel();
    const from = this.state;
    const timer = window.setTimeout(() => {
      this.pending = null;
      // Only if nothing changed meanwhile, and the rules still allow it.
      if (this.state !== from) return;
      if (to === "hidden" && !this.hideWhenIdle) return;
      if (from === "home" && this.pinned) return;
      this.go(to);
    }, seconds * 1000);
    this.pending = { timer, to, at: performance.now() + seconds * 1000 };
  }

  private cancel() {
    if (this.pending) window.clearTimeout(this.pending.timer);
    this.pending = null;
  }
}
