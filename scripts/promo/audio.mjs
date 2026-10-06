// The promo's sound, made in code like Tute's own (src/core/synth.ts): a soft
// music bed (pad, bass, plucks, light drums) and sound effects timed to the
// animation in promo.html. Writes target/promo/audio.wav, then puts it into
// docs/promo/tute.mp4 (the video stream is copied, not re-encoded).
//
//   node scripts/promo/audio.mjs

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SR = 44100;
const LENGTH = 28;
const N = SR * LENGTH;
const root = join(import.meta.dirname, "..", "..");

// Two buses: dry (stereo) and a reverb send (mono, spread later).
const L = new Float32Array(N), R = new Float32Array(N), VERB = new Float32Array(N);

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** Writes one sample into the mix with a pan (−1…1) and a reverb send. */
function put(i, v, pan = 0, send = 0.2) {
  if (i < 0 || i >= N) return;
  const a = (pan + 1) * Math.PI / 4;
  L[i] += v * Math.cos(a);
  R[i] += v * Math.sin(a);
  VERB[i] += v * send;
}

/**
 * A voice: an oscillator with a pitch glide, quick attack and exponential
 * fade. `shape` mixes in harmonics: 0 pure sine, 1 triangle-ish, 2 brighter.
 */
function tone({ t, f0, f1 = f0, glide = 0.1, dur, peak = 0.3, attack = 0.005, shape = 0, pan = 0, send = 0.2, vib = 0, release }) {
  const start = Math.floor(t * SR);
  const len = Math.floor((attack + dur * 1.6) * SR);
  let ph = 0;
  const tau = dur / 4.6; // reaches about −40 dB at `dur`
  for (let k = 0; k < len; k++) {
    const s = k / SR;
    const g = Math.min(1, s / glide);
    let f = f0 * Math.pow(f1 / f0, g);
    if (vib) f += Math.sin(s * 2 * Math.PI * 5.5) * vib;
    ph += (2 * Math.PI * f) / SR;
    let v = Math.sin(ph);
    if (shape >= 1) v += Math.sin(3 * ph) / 9 - Math.sin(5 * ph) / 25;
    if (shape >= 2) v += Math.sin(2 * ph) * 0.35 + Math.sin(4 * ph) * 0.12;
    const env = s < attack ? s / attack : Math.exp(-(s - attack) / tau);
    const rel = release && s > release ? Math.exp(-(s - release) / 0.08) : 1;
    put(start + k, v * env * rel * peak, pan, send);
  }
}

/** A biquad filter (RBJ), for noise. */
function biquad(type, f, q) {
  const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
  else if (type === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cs) / a0, a2: (1 - al) / a0 };
}

/** Filtered noise with a sliding filter: whooshes, ticks, hats, buzz. */
function noise({ t, dur, peak = 0.2, type = "bp", f0, f1 = f0, q = 1, attack = 0.003, pan = 0, send = 0.2, swell = false }) {
  const start = Math.floor(t * SR), len = Math.floor(dur * SR);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c;
  for (let k = 0; k < len; k++) {
    const p = k / len;
    if (k % 32 === 0) c = biquad(type, f0 * Math.pow(f1 / f0, p), q);
    const x = rand();
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const s = k / SR;
    const env = swell ? Math.sin(Math.PI * p) ** 1.5 : (s < attack ? s / attack : Math.pow(1 - p, 2.2));
    put(start + k, y * env * peak, pan, send);
  }
}

// ── Sound effects (Tute's own palette) ──────────────────────────────────────
const bloop = (t, f0, f1, dur = 0.12, peak = 0.32, pan = 0) => {
  tone({ t, f0, f1, glide: dur * 0.7, dur, peak, pan });
  tone({ t, f0: f0 / 2, f1: f1 / 2, glide: dur * 0.7, dur: dur * 0.8, peak: peak * 0.3, shape: 1, pan });
};
const chime = (t, f, dur = 0.9, peak = 0.16, pan = 0) => {
  tone({ t, f0: f, dur, peak, attack: 0.003, pan, send: 0.45 });
  tone({ t, f0: f * 2.01, dur: dur * 0.5, peak: peak * 0.2, attack: 0.003, pan, send: 0.45 });
  tone({ t, f0: f * 3.02, dur: dur * 0.3, peak: peak * 0.07, attack: 0.003, pan, send: 0.45 });
};
const pop = (t, f = 900, peak = 0.16, pan = 0) => tone({ t, f0: f * 0.7, f1: f * 1.4, glide: 0.04, dur: 0.07, peak, pan, send: 0.15 });
const tick = (t, peak = 0.08, pan = 0) => noise({ t, dur: 0.025, peak, type: "bp", f0: 3800, q: 2.5, pan, send: 0.05 });
const whoosh = (t, dur, f0, f1, peak = 0.22, pan = 0) => noise({ t, dur, peak, type: "bp", f0, f1, q: 1.3, swell: true, pan, send: 0.35 });
const sparkle = (t, peak = 0.08) => [0, 0.06, 0.12, 0.2].forEach((d, i) => chime(t + d, midi(96 + [0, 4, 7, 12][i]), 0.35, peak, (i - 1.5) * 0.4));

// Scene 1: the fall, the landing, the title, a jump, love.
whoosh(0.3, 0.65, 400, 2200, 0.16);
bloop(0.95, 220, 120, 0.22, 0.45);
noise({ t: 0.95, dur: 0.12, peak: 0.12, type: "lp", f0: 600, f1: 200 });
chime(1.25, midi(84), 1.6, 0.1, -0.2); chime(1.25, midi(91), 1.6, 0.07, 0.2);
bloop(1.7, 300, 720, 0.16);
bloop(2.12, 500, 260, 0.1, 0.22);
[0, 0.12, 0.24].forEach((d, i) => bloop(2.6 + d, midi(76 + i * 4), midi(79 + i * 4), 0.1, 0.18, (i - 1) * 0.4));

// Scene 2: the island drops in, steps tick off, done.
whoosh(4.05, 0.8, 2400, 300, 0.2);
bloop(4.92, 160, 90, 0.18, 0.35);
[5.3, 6.1, 6.9, 7.6].forEach((t, i) => { pop(t, 700 + i * 90, 0.12, 0.35); if (i) tick(t, 0.07, 0.4); });
bloop(8.3, 330, 660, 0.14, 0.28);
[0, 0.09, 0.18, 0.3].forEach((d, i) => chime(8.4 + d, midi([72, 76, 79, 84][i]), 1.0, 0.13, 0.3));

// Scene 3: typing, thinking, the answer, remembered.
for (let t = 9.9; t < 10.8; t += 0.055 + Math.abs(rand()) * 0.035) tick(t, 0.05 + Math.abs(rand()) * 0.03, 0.3);
tone({ t: 10.9, f0: midi(67), dur: 0.5, peak: 0.08, vib: 6, send: 0.4 });
tone({ t: 11.25, f0: midi(71), dur: 0.5, peak: 0.07, vib: 6, send: 0.4 });
[11.9, 12.22, 12.54].forEach((t, i) => pop(t, 1000 + i * 120, 0.08, 0.3));
chime(12.95, midi(79), 0.8, 0.13, 0.2); chime(13.07, midi(84), 1.0, 0.13, 0.25);

// Scene 4: the file flies in, gulp, options, picked, saved.
whoosh(14.35, 0.85, 500, 2600, 0.2, 0.6);
bloop(15.15, 420, 140, 0.2, 0.42);
bloop(15.32, 260, 520, 0.12, 0.25);
[15.6, 15.75, 15.9].forEach((t, i) => pop(t, 760 + i * 140, 0.12, 0.35));
tick(16.7, 0.12, 0.35);
chime(17.2, midi(84), 0.9, 0.14, 0.35); chime(17.28, midi(88), 0.9, 0.12, 0.35);
sparkle(17.32, 0.05);

// Scene 5: a message comes in, the phone buzzes, thumbs tap, sent.
chime(18.92, midi(88), 0.5, 0.12, 0.4); chime(19.0, midi(83), 0.6, 0.1, 0.4);
for (let k = 0; k < 2; k++) {
  noise({ t: 19.0 + k * 0.22, dur: 0.16, peak: 0.16, type: "lp", f0: 180, q: 4, attack: 0.01, send: 0.05 });
  tone({ t: 19.0 + k * 0.22, f0: 150, dur: 0.16, peak: 0.1, shape: 2, send: 0.02 });
}
for (let t = 20.15, i = 0; t < 21.85; t += 0.11, i++) tick(t, 0.06, i % 2 ? 0.15 : -0.15);
pop(21.0, 900, 0.1, 0.35);
whoosh(21.9, 0.4, 600, 3200, 0.16);
bloop(21.92, 400, 900, 0.1, 0.2);
chime(22.15, midi(91), 0.6, 0.09, 0.3);

// Scene 6: the tile lifts, a riser, the dance, the title, the pills.
whoosh(22.8, 0.6, 300, 2600, 0.18);
noise({ t: 22.6, dur: 1.1, peak: 0.1, type: "bp", f0: 300, f1: 5000, q: 1.5, swell: true, send: 0.4 });
noise({ t: 23.7, dur: 1.4, peak: 0.12, type: "hp", f0: 5000, q: 0.7, send: 0.6 }); // a soft cymbal
[23.75, 24.17, 24.59, 25.01].forEach((t, i) => bloop(t, 260 + i * 40, 560 + i * 60, 0.13, 0.26, i % 2 ? 0.3 : -0.3));
[60, 64, 67, 71, 76].forEach((n) => chime(24.05, midi(n + 12), 2.4, 0.07));
[0, 1, 2, 3, 4, 5].forEach((i) => pop(24.6 + i * 0.1, midi(79 + [0, 2, 4, 7, 9, 12][i]), 0.08, (i - 2.5) * 0.25));
bloop(26.0, 700, 900, 0.07, 0.15);

// ── Music: 100 bpm, Cmaj7 · Am7 · Fmaj7 · G6, soft and round ────────────────
const BEAT = 0.6, BAR = BEAT * 4;
const CHORDS = [
  { bass: 36, notes: [60, 64, 67, 71] },
  { bass: 33, notes: [57, 60, 64, 67] },
  { bass: 29, notes: [57, 60, 65, 69] },
  { bass: 31, notes: [55, 59, 62, 64] },
];
const MUSIC_END = 26.4;
const drums = (t) => t >= 4.4 && t < 22.7 || t >= 23.7 && t < MUSIC_END;
for (let bar = 0; bar * BAR < LENGTH; bar++) {
  const t0 = bar * BAR;
  const last = t0 + BAR > MUSIC_END;
  const c = last ? CHORDS[0] : CHORDS[bar % 4];
  const hold = last ? 3.2 : BAR;
  if (t0 > MUSIC_END + 0.01) break;
  // Pad: slow-swelling detuned voices.
  c.notes.forEach((n, i) => {
    for (const det of [-0.004, 0.004]) {
      tone({ t: t0, f0: midi(n) * (1 + det), dur: hold * 1.1, peak: 0.022, attack: 0.5, shape: 1, pan: (i - 1.5) * 0.35 + det * 60, send: 0.5 });
    }
  });
  // Bass, once the island is in.
  if (t0 >= 4.0) {
    tone({ t: t0, f0: midi(c.bass + 12), dur: 0.9, peak: 0.2, attack: 0.01, shape: 1, send: 0.05 });
    if (!last) tone({ t: t0 + BEAT * 2.5, f0: midi(c.bass + 12), dur: 0.6, peak: 0.14, attack: 0.01, shape: 1, send: 0.05 });
  }
  // Plucks: eighth notes up and down the chord, an octave up.
  if (t0 + BAR > 1.2 && !last) {
    const order = [0, 1, 2, 3, 2, 1, 2, 3];
    order.forEach((o, i) => {
      const t = t0 + i * BEAT / 2;
      if (t < 1.2) return;
      tone({ t, f0: midi(c.notes[o] + 12), dur: 0.28, peak: 0.045, attack: 0.002, shape: 2, pan: i % 2 ? 0.45 : -0.45, send: 0.35 });
    });
  }
  // Drums: a round kick, a soft clap, little hats.
  for (let b = 0; b < 4; b++) {
    const t = t0 + b * BEAT;
    if (!drums(t)) continue;
    if (b === 0 || b === 2) tone({ t, f0: 130, f1: 45, glide: 0.09, dur: 0.3, peak: 0.42, send: 0 });
    if (b === 1 || b === 3) noise({ t, dur: 0.14, peak: 0.07, type: "bp", f0: 1500, q: 0.9, send: 0.3 });
    noise({ t: t + BEAT / 2, dur: 0.035, peak: 0.035, type: "hp", f0: 7000, q: 0.7, pan: 0.3, send: 0.05 });
  }
}

// ── Reverb (a small Schroeder room), master fade, soft limit ────────────────
function reverb(input) {
  const out = [new Float32Array(N), new Float32Array(N)];
  const combs = [[1557, 1617, 1491, 1422], [1277, 1356, 1188, 1116]];
  combs.forEach((set, ch) => {
    for (const d of set) {
      const buf = new Float32Array(d); let idx = 0, lp = 0;
      for (let i = 0; i < N; i++) {
        const y = buf[idx];
        lp = y * 0.6 + lp * 0.4; // damping
        buf[idx] = input[i] + lp * 0.8;
        out[ch][i] += y * 0.25;
        idx = (idx + 1) % d;
      }
    }
    for (const d of [225, 556]) {
      const buf = new Float32Array(d); let idx = 0;
      for (let i = 0; i < N; i++) {
        const b = buf[idx], x = out[ch][i];
        out[ch][i] = -x + b;
        buf[idx] = x + b * 0.5;
        idx = (idx + 1) % d;
      }
    }
  });
  return out;
}
const [wl, wr] = reverb(VERB);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.3) * (1 - Math.max(0, Math.min(1, (t - 27.0) / 1.0)));
  L[i] = (L[i] + wl[i] * 0.35) * fade;
  R[i] = (R[i] + wr[i] * 0.35) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.9 / peak;

// ── WAV out, then into the video ────────────────────────────────────────────
const wav = Buffer.alloc(44 + N * 4);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write("WAVE", 8);
wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const s = (v) => Math.round(Math.tanh(v * gain * 1.1) * 32000);
  wav.writeInt16LE(s(L[i]), 44 + i * 4);
  wav.writeInt16LE(s(R[i]), 46 + i * 4);
}
mkdirSync(join(root, "target", "promo"), { recursive: true });
const wavPath = join(root, "target", "promo", "audio.wav");
writeFileSync(wavPath, wav);
console.log("wrote target/promo/audio.wav");

const video = join(root, "docs", "promo", "tute.mp4");
const frames = join(root, "target", "promo", "frames", "f00000.png");
if (existsSync(frames)) {
  // Encode from the frames, so running this twice never stacks audio tracks.
  const tmp = join(root, "target", "promo", "tute-with-sound.mp4");
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", join(root, "target", "promo", "frames", "f%05d.png"), "-i", wavPath,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", tmp], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
  renameSync(tmp, video);
  console.log("wrote docs/promo/tute.mp4 with sound");
}
