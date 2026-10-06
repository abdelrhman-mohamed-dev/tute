// Draws Tute — the pale jelly with big shiny eyes on a dark slate tile, like
// the island itself — into the PNG/ICO set
// Tauri needs. No dependencies: the icons are rasterised here and encoded with
// node:zlib, so the app icon stays "drawn in code" like the character itself.
// The shape mirrors src/jelly/jelly.ts (BODY and puddlePoint).
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

// ── Tute ──────────────────────────────────────────────────────────────────────

// Same shape constants as jelly.ts.
const BODY = { halfW: 1.1, top: 0.64, base: 0.52, scallop: 0.09 };

const JELLY_TOP = [230, 240, 252]; // #E6F0FC
const JELLY_BOTTOM = [180, 205, 238];
const RIM = [150, 178, 220]; // a soft edge, lighter than the tile
const TILE = [27, 33, 48]; // #1B2130, the island's slate
const TILE_EDGE = [52, 62, 84]; // a hairline so the tile holds on dark taskbars
const INK = [26, 20, 18]; // #1A1412
const WHITE = [255, 255, 255];

const SS = 4; // supersampling factor

/** Inside the jelly outline (body-local, units of R)? Inverts jelly.ts's puddlePoint. */
function insideJelly(x, y, R) {
  const W = R * BODY.halfW;
  if (Math.abs(x) > W) return false;
  if (y < 0) {
    const ca = Math.pow(Math.abs(x) / W, 1 / 0.8);
    const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
    return y >= -R * BODY.top * Math.pow(sa, 0.85);
  }
  const ca = Math.pow(Math.abs(x) / W, 1 / 0.42);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const u = (x / W + 1) / 2;
  const bump = Math.abs(Math.sin(u * Math.PI * 4)) * R * BODY.scallop;
  return y <= R * BODY.base * Math.pow(sa, 0.3) + bump * sa;
}

const inEllipse = (x, y, cx, cy, rx, ry, rot = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = x - cx, dy = y - cy;
  const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
  return u * u + v * v <= 1;
};

/** Coverage of the rounded tile at (x, y): 1 inside, 0 outside. */
function inTile(x, y, size) {
  const m = size * 0.16; // room around the tile, like other apps leave
  const r = size * 0.17; // corner radius
  const lo = m + r, hi = size - m - r;
  const dx = Math.max(lo - x, 0, x - hi);
  const dy = Math.max(lo - y, 0, y - hi);
  return dx * dx + dy * dy <= r * r;
}

function renderTute(size) {
  const px = new Uint8Array(size * size * 4);
  const R = size * 0.235;
  const cx = size / 2;
  const cy = size / 2 + R * 0.12;
  const rim = Math.max(R * 0.06, 0.6);
  const edge = Math.max(size * 0.012, 0.6); // the tile's hairline

  // Eyes: same spacing and size as the engine's round eyes.
  const ex = R * 0.4;
  const ey = R * 0.08;
  // Bigger eyes at tray sizes, or they vanish.
  const er = R * (size <= 24 ? 0.21 : size <= 48 ? 0.18 : 0.15);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tileHits = 0, edgeHits = 0, rimHits = 0, bodyHits = 0, eyeHits = 0, eyeShine = 0, shine = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (!inTile(fx, fy, size)) continue;
          tileHits++;
          // The hairline: inside the tile, but not inside the tile shrunk a little.
          const k = size / (size - 2 * edge);
          if (!inTile((fx - size / 2) * k + size / 2, (fy - size / 2) * k + size / 2, size)) edgeHits++;
          const px0 = fx - cx;
          const py0 = fy - cy;
          // The rim is the outline grown outwards a little.
          const outer = insideJelly(px0 * (R / (R + rim)), py0 * (R / (R + rim)), R);
          if (!outer) continue;
          rimHits++;
          if (!insideJelly(px0, py0, R)) continue;
          bodyHits++;
          if (inEllipse(px0, py0, -R * 0.55, -R * 0.24, R * 0.16, R * 0.09, -0.6)) shine++;
          for (const sd of [-1, 1]) {
            if (inEllipse(px0, py0, sd * ex, ey, er, er * 1.08)) {
              eyeHits++;
              if (inEllipse(px0, py0, sd * ex - er * 0.35, ey - er * 0.4, er * 0.36, er * 0.36)) eyeShine++;
            }
          }
        }
      }
      if (tileHits === 0) continue;

      const total = SS * SS;
      const tileA = tileHits / total;
      const edgeF = edgeHits / tileHits;
      const jellyF = rimHits / tileHits;
      const bodyF = rimHits ? bodyHits / rimHits : 0;

      // Jelly gradient, light at the top to deeper at the base.
      const t = Math.min(1, Math.max(0, (y - cy + R * BODY.top) / (R * (BODY.top + BODY.base))));
      const body = [0, 1, 2].map((i) => JELLY_TOP[i] + (JELLY_BOTTOM[i] - JELLY_TOP[i]) * t);

      let col = TILE.map((c, i) => c * (1 - edgeF) + TILE_EDGE[i] * edgeF);
      const mix = (target, k) => { col = col.map((c, i) => c * (1 - k) + target[i] * k); };
      mix(RIM.map((c, i) => c * (1 - bodyF) + body[i] * bodyF), jellyF);
      if (shine) mix(WHITE, (shine / tileHits) * 0.8);
      if (eyeHits) mix(INK, eyeHits / tileHits);
      if (eyeShine) mix(WHITE, eyeShine / tileHits);

      const o = (y * size + x) * 4;
      px[o] = Math.round(col[0]);
      px[o + 1] = Math.round(col[1]);
      px[o + 2] = Math.round(col[2]);
      px[o + 3] = Math.round(Math.min(1, tileA) * 255);
    }
  }
  return px;
}

/**
 * The notification-area icon: a flat white jelly with its eyes cut out, no
 * background — a plain glyph like the other tray icons, not a picture.
 */
function renderTray(size) {
  const px = new Uint8Array(size * size * 4);
  const R = size * 0.42;
  const cx = size / 2;
  // A taller dome than the app's, so the small glyph reads as a jelly.
  const DOME = 1.4;
  const cy = size / 2 + R * 0.2;
  const ex = R * 0.38;
  const ey = -R * 0.12;
  const er = R * 0.15;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px0 = x + (sx + 0.5) / SS - cx;
          const py0 = y + (sy + 0.5) / SS - cy;
          if (!insideJelly(px0, py0 < 0 ? py0 / DOME : py0, R)) continue;
          if ([-1, 1].some((sd) => inEllipse(px0, py0, sd * ex, ey, er, er * 1.35))) continue;
          hits++;
        }
      }
      const o = (y * size + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = 255;
      px[o + 3] = Math.round((hits / (SS * SS)) * 255);
    }
  }
  return px;
}

// ── PNG ───────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO (PNG-in-ICO, Vista and later) ─────────────────────────────────────────

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ── Go ────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const png = (size) => encodePNG(size, renderTute(size));

const files = {
  "32x32.png": png(32),
  "128x128.png": png(128),
  "128x128@2x.png": png(256),
  "icon.png": png(512),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name} — ${data.length} bytes`);
}

// The tray icon as raw RGBA, embedded by src-tauri/src/tray.rs (no PNG decoder needed).
const TRAY = 32;
writeFileSync(join(OUT, "tray-32.rgba"), renderTray(TRAY));
writeFileSync(join(OUT, "tray.png"), encodePNG(TRAY, renderTray(TRAY)));
console.log("tray-32.rgba, tray.png (preview)");

const ico = encodeICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) })));
writeFileSync(join(OUT, "icon.ico"), ico);
console.log(`icon.ico — ${ico.length} bytes`);
