// What happens around a file drop: the island opens as you drag a file over
// it, the jelly absorbs it (drawn by upload/canvas.ts) while the copy into the
// inbox runs in the background, a tick plays every tenth of the way, and the
// "Keep it / Cancel" card follows.

import { Bridge, ObsidianBridge } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { IslandViewName } from "../core/layout";
import type { JellyEngine } from "../jelly/engine";
import { CARD_DELAY, Drop, FILL, HUGE_FILE_BYTES, reactionForName } from "../upload/sequence";
import type { Play } from "./play";

/** The views the drop owns; going anywhere else ends it. */
const DROP_VIEWS: ReadonlySet<IslandViewName> = new Set(["upload", "uploading", "choose"]);

export interface DropHost {
  engine: JellyEngine;
  play: Play;
  alert(view: IslandViewName): void;
  setView(view: IslandViewName): void;
  /** Shows a short message, then goes back to the usual view. */
  note(message: string, ms: number): void;
  kick(): void;
}

export class DropFlow {
  private ticks = 0; // tenths of the copy already ticked
  private full = false; // the ✓ has played

  constructor(private host: DropHost) {}

  /** The drop is drawing over the island right now. */
  get showing(): boolean {
    return State.mode === "expanded" && Drop.active && DROP_VIEWS.has(State.view);
  }

  /** Something is still running (it keeps the frame loop awake). */
  get active(): boolean {
    return Drop.active;
  }

  /** What the drop canvas draws this frame. */
  frame() {
    return Drop.frame();
  }

  /** The island is going to `view`: a drop it doesn't own is over. */
  leaving(view: IslandViewName) {
    if (Drop.active && !DROP_VIEWS.has(view)) Drop.end();
  }

  /** The island shut: nothing of the drop can be seen, so nothing may keep running. */
  stop() {
    Drop.end();
  }

  /** The cursor, in island coordinates. Windows reports none during a drag, so the cursor watcher feeds it. */
  cursor(x: number, y: number) {
    if (Drop.active && !Drop.dropped) Drop.follow(x, y);
  }

  /** A drag-and-drop event from Rust. */
  drag(e: { type: string; paths?: string[] }) {
    if (e.type !== "over") void Bridge.log(`drag ${e.type} ${e.paths?.length ?? 0} file(s)`);
    if (State.paused) return;
    switch (e.type) {
      case "enter":
      case "over":
        if (State.fileDragOver) return;
        State.fileDragOver = true;
        // Started before the island opens, so the drop owns the view from its first frame.
        Drop.begin(State.mouseInIsland.x, State.mouseInIsland.y);
        this.host.alert("upload");
        break;
      case "leave":
        if (!State.fileDragOver) return;
        // The island stays open: the drag isn't over, you may come back.
        State.fileDragOver = false;
        State.notify();
        break;
      case "drop": {
        State.fileDragOver = false;
        const path = e.paths?.[0];
        if (path) this.absorb(path);
        else this.host.setView(State.defaultView());
        break;
      }
    }
  }

  /**
   * The jelly takes the file. Nothing here waits on the disk: the copy runs in
   * the background and swaps its path in when it lands, so a slow drive can't
   * stall the animation.
   */
  private absorb(path: string) {
    const name = path.split(/[\\/]/).pop() || "file";
    State.droppedFile = { name, path };
    State.uploadProgress = 0;
    this.host.play.dropped();

    Drop.drop(State.uploadDuration);
    // Images and code show in the name. "Huge" needs the size, which only the
    // copy reports, but a copy still going after a second is big anyway.
    Drop.reaction = reactionForName(name);
    const slow = window.setTimeout(() => {
      if (Drop.active) Drop.reaction = "huge";
    }, 1000);
    this.ticks = 0;
    this.full = false;

    Sound.play("pop");
    this.host.setView("uploading");
    this.host.kick();

    Bridge.ingestFile(path)
      .then((file) => {
        if (file.size > HUGE_FILE_BYTES) Drop.reaction = "huge";
        State.droppedFile = { name: file.name, path: file.path };
        State.notify();
      })
      .catch((err) => {
        Drop.end();
        Sound.play("error");
        this.host.note(String(err).replace(/^Error:\s*/, ""), 2400);
      })
      .finally(() => window.clearTimeout(slow));
  }

  /** Per frame while a drop runs: the ticks, the ✓, then the card. */
  step() {
    const since = Drop.sinceDrop();
    if (since === null) return;
    const copy = State.uploadDuration;
    const p = Math.max(0, Math.min(1, (since - FILL) / copy));

    const tenths = Math.floor(p * 10);
    if (tenths > this.ticks && tenths < 10) {
      this.ticks = tenths;
      Sound.play("tick");
    }
    if (!this.full && p >= 1) {
      this.full = true;
      Sound.play("approve");
      this.host.engine.triggerEmote("happy");
    }
    // The canvas paints the card from CARD_DELAY; a beat later the view catches up.
    if (since >= FILL + copy + CARD_DELAY + 0.1 && State.view === "uploading") this.host.setView("choose");
  }

  /** "Keep it": the file stays in the inbox. TODO(tute): decide what a dropped file is for. */
  keep() {
    Sound.play("approve");
    this.host.note(`${State.droppedFile?.name ?? "The file"} is saved in AppData\\Local\\Tute\\inbox.`, 2400);
    // Back on screen: a run of drops gets its celebration now.
    window.setTimeout(() => this.host.play.celebrateStreak(), 350);
  }

  /** "Save to Obsidian": into the vault's attachments, linked in today's note. */
  toObsidian() {
    const file = State.droppedFile;
    if (!file) return;
    ObsidianBridge.saveFile(file.path)
      .then(() => {
        Sound.play("approve");
        this.host.note(`${file.name} is in your vault, linked in today's note.`, 2600);
        window.setTimeout(() => this.host.play.celebrateStreak(), 350);
      })
      .catch((err) => {
        Sound.play("error");
        this.host.note(String(err).replace(/^Error:\s*/, ""), 3200);
      });
  }

  /** "Cancel": as if it was never dropped. Deletes our copy, never the original. */
  cancel() {
    const file = State.droppedFile;
    State.droppedFile = null;
    // Rust only deletes inside the inbox, so the file you dragged in is never at risk.
    if (file) void Bridge.discardFile(file.path);
    Sound.play("blip");
    this.host.setView(State.defaultView());
  }
}
