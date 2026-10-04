// The two personalities the user picks from on first launch, and the bits that
// make them look different: body colours, the boy's hair tuft, the girl's bow,
// lashes and blush. Every place that draws the character (the engine, the launch
// greeting, the drop sequence) reads the active look from here, so they always
// agree.

export type Personality = "tute" | "tutee";

export interface Look {
  id: Personality;
  name: string;
  /** Jelly colour: the rim, hands and mini bots are this, the body is a clear tint of it. */
  body: string;
  /** The same colour as "r,g,b", for the translucent fill. */
  rgb: string;
  /** Lighter and darker shades, for gradients on hands and the drop box. */
  top: string;
  bottom: string;
  /** What sits on top of the head. */
  accessory: "tuft" | "bow";
  /** Little lashes at the outer top corner of each open eye. */
  lashes: boolean;
  /** Resting blush, 0…1. */
  blush: number;
  /** Something earned through the bond (island/bond.ts), worn on top. */
  wear?: "hat" | "crown" | null;
}

/** Colours unlocked at bond level 5: the same jelly, another flavour. */
export type Skin = "mint" | "lemon" | "lilac";

export const SKINS: Record<Skin, Pick<Look, "body" | "rgb" | "top" | "bottom">> = {
  mint: { body: "#BDEFD9", rgb: "189,239,217", top: "#E3FAF0", bottom: "#97DCC0" },
  lemon: { body: "#F7E8A6", rgb: "247,232,166", top: "#FDF7DA", bottom: "#E9D27D" },
  lilac: { body: "#D9CCF7", rgb: "217,204,247", top: "#F1ECFD", bottom: "#BDA9EC" },
};

export const LOOKS: Record<Personality, Look> = {
  tute: {
    id: "tute",
    name: "Tute",
    body: "#C9DCF5",
    rgb: "201,220,245",
    top: "#E6F0FC",
    bottom: "#A7BFE0",
    accessory: "tuft",
    lashes: false,
    blush: 0,
  },
  tutee: {
    id: "tutee",
    name: "Tutee",
    body: "#F8CAD7",
    rgb: "248,202,215",
    top: "#FFF1F5",
    bottom: "#F2BACB",
    accessory: "bow",
    lashes: true,
    blush: 0.45,
  },
};

export const PERSONALITIES: Personality[] = ["tute", "tutee"];

let active: Look = LOOKS.tute;

/** The look the island's character currently wears. */
export function activeLook(): Look {
  return active;
}

/** The personality's look, in an unlocked colour and wearing what was picked. */
export function setActiveLook(
  p: Personality | null | undefined,
  skin: Skin | null = null,
  wear: Look["wear"] = null,
) {
  const base = LOOKS[p ?? "tute"] ?? LOOKS.tute;
  active = { ...base, ...(skin ? SKINS[skin] : {}), wear };
}

export function isPersonality(v: unknown): v is Personality {
  return v === "tute" || v === "tutee";
}

/** `#RRGGBB` → [r, g, b] in 0…1, the format the engine works in. */
export function lookRGB(hex: string): [number, number, number] {
  const v = parseInt(hex.replace("#", ""), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const HAIR = "#2D3B57";
const HAIR_SHINE = "rgba(255,255,255,0.28)";
const BOW = "#FF5C93";
const BOW_DARK = "#D93A72";
const BOW_LIGHT = "rgba(255,255,255,0.4)";

/**
 * Draws the accessory. Coordinates are body-local: the body is centred on
 * (0, 0) with half-width `rx` and half-height `ry`. `shift` moves it sideways
 * as the head turns; `alpha` fades it (e.g. while the body morphs into the drop
 * box).
 *
 * Call it twice: with `"back"` before the body is filled (hair grows out from
 * behind the head, so its roots are hidden) and with `"front"` after (a bow
 * sits on top).
 */
export function drawAccessory(
  x: CanvasRenderingContext2D,
  look: Look,
  rx: number,
  ry: number,
  layer: "back" | "front",
  shift = 0,
  alpha = 1,
) {
  if (alpha <= 0.01) return;
  const wanted = look.accessory === "tuft" ? "back" : "front";
  x.save();
  x.globalAlpha *= alpha;
  if (layer === wanted) {
    if (look.accessory === "bow") drawBow(x, rx * 0.46 + shift, -ry * 0.84, ry * 0.4);
    else drawTuft(x, shift, -ry * 0.8, ry * 0.85);
  }
  // Earned things sit on top, on the left of the dome: clear of the tuft and the bow.
  if (layer === "front" && look.wear === "hat") drawPartyHat(x, -rx * 0.3 + shift, -ry * 0.78, ry * 0.62);
  if (layer === "front" && look.wear === "crown") drawCrown(x, -rx * 0.24 + shift, -ry * 0.82, ry * 0.5);
  x.restore();
}

/** A striped party cone with a pom-pom, tipped jauntily to the left. */
function drawPartyHat(x: CanvasRenderingContext2D, bx: number, by: number, s: number) {
  x.save();
  x.translate(bx, by);
  x.rotate(-0.32);
  const cone = new Path2D();
  cone.moveTo(-s * 0.42, 0);
  cone.lineTo(0, -s * 1.15);
  cone.lineTo(s * 0.42, 0);
  cone.quadraticCurveTo(0, s * 0.12, -s * 0.42, 0);
  cone.closePath();
  x.fillStyle = "#F472B6";
  x.fill(cone);
  // Stripes, clipped to the cone.
  x.save();
  x.clip(cone);
  x.strokeStyle = "#FDE68A";
  x.lineWidth = s * 0.14;
  for (const k of [0.3, 0.62]) {
    x.beginPath();
    x.moveTo(-s, -s * k + s * 0.35);
    x.lineTo(s, -s * k - s * 0.15);
    x.stroke();
  }
  x.restore();
  x.strokeStyle = "rgba(255,255,255,0.85)";
  x.lineWidth = Math.max(0.6, s * 0.06);
  x.stroke(cone);
  x.fillStyle = "#FDE68A";
  x.beginPath();
  x.arc(0, -s * 1.17, s * 0.16, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

/** A small gold crown with three points and a ruby. */
function drawCrown(x: CanvasRenderingContext2D, bx: number, by: number, s: number) {
  x.save();
  x.translate(bx, by);
  x.rotate(-0.2);
  const w = s * 0.62;
  const p = new Path2D();
  p.moveTo(-w, 0);
  p.lineTo(-w, -s * 0.55);
  p.lineTo(-w * 0.45, -s * 0.22);
  p.lineTo(0, -s * 0.78);
  p.lineTo(w * 0.45, -s * 0.22);
  p.lineTo(w, -s * 0.55);
  p.lineTo(w, 0);
  p.closePath();
  x.fillStyle = "#F5C542";
  x.fill(p);
  x.strokeStyle = "#C9962A";
  x.lineWidth = Math.max(0.6, s * 0.07);
  x.lineJoin = "round";
  x.stroke(p);
  x.fillStyle = "#EF4565";
  x.beginPath();
  x.arc(0, -s * 0.2, s * 0.12, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "rgba(255,255,255,0.55)";
  for (const px of [-w, 0, w]) {
    x.beginPath();
    x.arc(px, px === 0 ? -s * 0.78 : -s * 0.55, s * 0.07, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}

/**
 * A swept tuft of hair: three chunky strands fanned to the right, the middle
 * one tallest. Drawn behind the body, so the roots disappear into the head.
 */
function drawTuft(x: CanvasRenderingContext2D, bx: number, by: number, s: number) {
  const strand = (ox: number, scale: number, lean: number) => {
    const p = new Path2D();
    const b = { x: bx + ox * s, y: by + s * 0.3 };
    const half = s * 0.3 * scale;
    p.moveTo(b.x - half, b.y);
    p.quadraticCurveTo(b.x - half * 0.9, b.y - s * 0.85 * scale, b.x + s * lean * scale, b.y - s * 1.15 * scale);
    p.quadraticCurveTo(b.x + half * 0.35, b.y - s * 0.6 * scale, b.x + half, b.y);
    p.closePath();
    return p;
  };
  x.fillStyle = HAIR;
  x.fill(strand(-0.34, 0.86, -0.05));
  x.fill(strand(0.34, 0.88, 0.62));
  x.fill(strand(0, 1, 0.48));
  // A shine along the tallest strand so it reads as hair, not a hole.
  x.strokeStyle = HAIR_SHINE;
  x.lineWidth = Math.max(0.6, s * 0.07);
  x.lineCap = "round";
  x.beginPath();
  x.moveTo(bx - s * 0.08, by - s * 0.25);
  x.quadraticCurveTo(bx - s * 0.08, by - s * 0.55, bx + s * 0.3, by - s * 0.76);
  x.stroke();
}

/** A ribbon bow, tilted a little, sitting on the top-right of the head. */
function drawBow(x: CanvasRenderingContext2D, bx: number, by: number, s: number) {
  x.save();
  x.translate(bx, by);
  x.rotate(0.32);
  const loop = (sd: number) => {
    const p = new Path2D();
    p.moveTo(0, 0);
    p.bezierCurveTo(sd * s * 0.3, -s * 0.62, sd * s * 1.08, -s * 0.66, sd * s * 1.02, 0);
    p.bezierCurveTo(sd * s * 1.08, s * 0.66, sd * s * 0.3, s * 0.62, 0, 0);
    p.closePath();
    return p;
  };
  // Two short tails under the knot.
  x.fillStyle = BOW_DARK;
  for (const sd of [-1, 1]) {
    x.beginPath();
    x.moveTo(sd * s * 0.08, s * 0.08);
    x.lineTo(sd * s * 0.5, s * 0.78);
    x.lineTo(sd * s * 0.2, s * 0.7);
    x.lineTo(sd * s * 0.02, s * 0.16);
    x.closePath();
    x.fill();
  }
  for (const sd of [-1, 1]) {
    const p = loop(sd);
    x.fillStyle = BOW;
    x.fill(p);
    x.strokeStyle = BOW_DARK;
    x.lineWidth = Math.max(0.5, s * 0.07);
    x.stroke(p);
  }
  // Fold lines inside each loop.
  x.strokeStyle = BOW_DARK;
  x.lineWidth = Math.max(0.5, s * 0.06);
  x.lineCap = "round";
  for (const sd of [-1, 1]) {
    x.beginPath();
    x.moveTo(sd * s * 0.2, -s * 0.12);
    x.quadraticCurveTo(sd * s * 0.55, -s * 0.2, sd * s * 0.72, -s * 0.08);
    x.stroke();
  }
  // Knot.
  x.fillStyle = BOW_DARK;
  x.beginPath();
  x.ellipse(0, 0, s * 0.24, s * 0.28, 0, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = BOW_LIGHT;
  x.beginPath();
  x.ellipse(-s * 0.06, -s * 0.08, s * 0.08, s * 0.06, 0, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

/**
 * Two lashes at the outer top corner of an open eye. Drawn in the eye's own
 * coordinates: centred on the eye, `w` its width, `top` the y of its top edge,
 * `sd` -1 for the left eye and 1 for the right.
 */
export function drawLashes(
  x: CanvasRenderingContext2D,
  sd: number,
  w: number,
  top: number,
  ink: string,
) {
  x.save();
  x.strokeStyle = ink;
  x.lineWidth = Math.max(0.6, w * 0.2);
  x.lineCap = "round";
  x.beginPath();
  x.moveTo(sd * w * 0.28, top * 0.92);
  x.lineTo(sd * w * 0.78, top * 1.28);
  x.moveTo(sd * w * 0.44, top * 0.62);
  x.lineTo(sd * w * 0.92, top * 0.82);
  x.stroke();
  x.restore();
}
