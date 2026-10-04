// A file drop, from the moment a file is dragged over the island until the
// "Keep it / Cancel" card: where the file is, when it landed, how long the copy
// takes and what the jelly makes of it. The drawing ("absorb") is in canvas.ts.
//
//   dragging  the file follows the cursor; the jelly leans towards it
//   sinking   it drops into the jelly with a splash          (0 → SINK)
//   filling   it floats inside while ten bubbles fill up     (FILL → FILL + copy time)
//   done      it dissolves into a sparkle, then the card shows (+ CARD_DELAY)

/** What the jelly makes of the file: star eyes, a thinking look, a struggle. */
export type DropReaction = "image" | "code" | "huge" | null;

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "avif", "ico", "tif", "tiff"]);
const CODE = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt", "swift", "c", "h", "cpp",
  "hpp", "cc", "cs", "rb", "php", "lua", "sh", "ps1", "bat", "sql", "html", "css", "scss", "json",
  "yml", "yaml", "toml", "xml", "vue", "svelte", "dart", "r", "m", "scala", "zig", "ipynb",
]);

/** The reaction a file's name earns, before its size is known. */
export function reactionForName(name: string): DropReaction {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (IMAGE.has(ext)) return "image";
  if (CODE.has(ext)) return "code";
  return null;
}

/** Bigger than this, a file is "huge" whatever it is. */
export const HUGE_FILE_BYTES = 50 * 1024 * 1024;

/** Seconds after the drop: the file has sunk in by SINK; the bubbles start at FILL. */
export const SINK = 0.36;
export const FILL = 0.55;
/** Seconds after the bubbles are full before the card shows. */
export const CARD_DELAY = 0.9;

/** One frame of the drop, everything the drawing needs. */
export interface DropFrame {
  /** False while the file is still being dragged. */
  dropped: boolean;
  /** Seconds since the file came over the island. */
  sinceEnter: number;
  /** Seconds since the drop (0 while dragging). */
  sinceDrop: number;
  /** The cursor (island coordinates), and where the file was let go. */
  cursorX: number;
  cursorY: number;
  dropX: number;
  dropY: number;
  /** How long the bubbles take to fill (the copy time). */
  duration: number;
  reaction: DropReaction;
}

const seconds = () => performance.now() / 1000;

class FileDrop {
  /** A drop is on screen (from the first drag until the card is closed). */
  active = false;
  reaction: DropReaction = null;

  private cursor = { x: 320, y: 100 };
  private landed = { x: 320, y: 100 };
  private enteredAt = 0;
  private droppedAt: number | null = null;
  private duration = 2.4;

  /** A file came over the island, at island coordinates (x, y). */
  begin(x: number, y: number) {
    this.active = true;
    this.reaction = null;
    this.droppedAt = null;
    this.enteredAt = seconds();
    this.follow(x, y);
  }

  /** The dragged file moved. Leaving the island changes nothing: it waits for you. */
  follow(x: number, y: number) {
    this.cursor = { x, y };
  }

  /** The file was let go; the copy is expected to take `duration` seconds. */
  drop(duration: number) {
    this.duration = duration;
    this.droppedAt = seconds();
    this.landed = { ...this.cursor };
  }

  end() {
    this.active = false;
    this.droppedAt = null;
  }

  get dropped(): boolean {
    return this.droppedAt !== null;
  }

  /** Seconds since the drop, or null while still dragging. */
  sinceDrop(): number | null {
    return this.droppedAt === null ? null : seconds() - this.droppedAt;
  }

  frame(): DropFrame {
    const t = seconds();
    return {
      dropped: this.droppedAt !== null,
      sinceEnter: this.active ? t - this.enteredAt : 0,
      sinceDrop: this.droppedAt === null ? 0 : t - this.droppedAt,
      cursorX: this.cursor.x,
      cursorY: this.cursor.y,
      dropX: this.landed.x,
      dropY: this.landed.y,
      duration: this.duration,
      reaction: this.reaction,
    };
  }
}

export const Drop = new FileDrop();
