// Tute's sounds, made in code — no audio files, nothing borrowed. Every sound is
// a short recipe of oscillators and filtered noise: round, bubbly "bloops"
// for the jelly, soft chimes for good news, a muffled splat for a slap. They
// are rendered once at startup (OfflineAudioContext) into buffers, so playing
// one is as cheap as playing a file.

const SR = 44100;

// Notes used below (Hz).
const F4 = 349.23, G4 = 392.0, A4 = 440.0;
const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880.0, B5 = 987.77;
const C6 = 1046.5, D6 = 1174.66;

interface ToneOpts {
  /** Start, seconds. */
  t?: number;
  f0: number;
  /** Glide to this pitch (exponential), over `glide` seconds (default: the whole tone). */
  f1?: number;
  glide?: number;
  /** Seconds from the peak until it has faded out. */
  dur: number;
  type?: OscillatorType;
  peak?: number;
  attack?: number;
  /** A little wobble: rate in Hz, depth in Hz. */
  vibrato?: [number, number];
}

/** One voice with a quick rise and an exponential fade. */
function tone(c: BaseAudioContext, out: AudioNode, o: ToneOpts) {
  const t0 = o.t ?? 0;
  const attack = o.attack ?? 0.006;
  const osc = c.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f0, t0);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + (o.glide ?? o.dur));
  if (o.vibrato) {
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = o.vibrato[0];
    depth.gain.value = o.vibrato[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + attack + o.dur + 0.05);
  }
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.peak ?? 0.4, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + o.dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + attack + o.dur + 0.05);
}

/** A jelly "bloop": a round sine that slides in pitch, with a soft octave under it. */
function bloop(c: BaseAudioContext, out: AudioNode, t: number, f0: number, f1: number, dur = 0.1, peak = 0.45) {
  tone(c, out, { t, f0, f1, glide: dur * 0.7, dur, peak });
  tone(c, out, { t, f0: f0 / 2, f1: f1 / 2, glide: dur * 0.7, dur: dur * 0.8, peak: peak * 0.25, type: "triangle" });
}

/** A bell-ish note: the tone plus a quiet overtone that fades sooner. */
function chime(c: BaseAudioContext, out: AudioNode, t: number, f: number, dur = 0.7, peak = 0.4) {
  tone(c, out, { t, f0: f, dur, peak, attack: 0.004 });
  tone(c, out, { t, f0: f * 2.01, dur: dur * 0.55, peak: peak * 0.18, attack: 0.004 });
  tone(c, out, { t, f0: f * 3.02, dur: dur * 0.3, peak: peak * 0.06, attack: 0.004 });
}

interface NoiseOpts {
  t?: number;
  dur: number;
  peak?: number;
  filter: BiquadFilterType;
  /** Filter frequency, sliding from f0 to f1. */
  f0: number;
  f1?: number;
  q?: number;
}

/** Filtered white noise: whooshes, splats, clicks. */
function noise(c: BaseAudioContext, out: AudioNode, o: NoiseOpts) {
  const t0 = o.t ?? 0;
  const len = Math.ceil((o.dur + 0.05) * c.sampleRate);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  // A fixed seed, so a sound is the same every time Tute starts.
  let seed = 0x2f6b9a1d;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = seed / 0x80000000 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = o.filter;
  filter.Q.value = o.q ?? 0.9;
  filter.frequency.setValueAtTime(o.f0, t0);
  if (o.f1) filter.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.peak ?? 0.2, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t0);
}

type Recipe = [seconds: number, build: (c: BaseAudioContext, out: AudioNode) => void];

/** Every sound the island plays, by name. */
export const RECIPES: Record<string, Recipe> = {
  // ── The island itself ──
  peek: [0.3, (c, o) => { bloop(c, o, 0, 420, 620, 0.08, 0.35); bloop(c, o, 0.08, 620, 900, 0.1, 0.35); }],
  open: [0.35, (c, o) => {
    bloop(c, o, 0, 300, 820, 0.16, 0.5);
    noise(c, o, { dur: 0.18, peak: 0.05, filter: "bandpass", f0: 600, f1: 2400 });
  }],
  close: [0.3, (c, o) => {
    bloop(c, o, 0, 820, 300, 0.16, 0.45);
    noise(c, o, { dur: 0.16, peak: 0.04, filter: "bandpass", f0: 2400, f1: 600 });
  }],
  hover: [0.12, (c, o) => tone(c, o, { f0: 620, f1: 720, dur: 0.08, peak: 0.2 })],
  blip: [0.12, (c, o) => tone(c, o, { f0: 900, f1: 1300, glide: 0.05, dur: 0.07, peak: 0.4 })],
  tick: [0.04, (c, o) => tone(c, o, { f0: 2400, dur: 0.012, attack: 0.001, peak: 0.3 })],

  // ── Touching the jelly ──
  pop: [0.15, (c, o) => {
    tone(c, o, { f0: 220, f1: 1000, glide: 0.025, dur: 0.05, peak: 0.6, attack: 0.002 });
    noise(c, o, { dur: 0.015, peak: 0.2, filter: "highpass", f0: 3000 });
  }],
  slap: [0.25, (c, o) => {
    noise(c, o, { dur: 0.07, peak: 0.55, filter: "lowpass", f0: 1800, f1: 400 });
    tone(c, o, { f0: 170, f1: 80, dur: 0.12, peak: 0.55, attack: 0.002 });
  }],
  annoyed: [0.45, (c, o) => {
    tone(c, o, { type: "triangle", f0: 240, f1: 190, dur: 0.12, peak: 0.35 });
    tone(c, o, { t: 0.16, type: "triangle", f0: 220, f1: 160, dur: 0.16, peak: 0.35 });
  }],
  dizzy: [0.9, (c, o) => tone(c, o, { f0: 900, f1: 280, glide: 0.8, dur: 0.8, peak: 0.35, vibrato: [9, 60] })],
  love: [0.8, (c, o) => {
    tone(c, o, { f0: G5, dur: 0.18, peak: 0.3, vibrato: [6, 6] });
    tone(c, o, { t: 0.14, f0: B5, dur: 0.18, peak: 0.3, vibrato: [6, 6] });
    tone(c, o, { t: 0.28, f0: D6, dur: 0.4, peak: 0.3, vibrato: [6, 7] });
  }],
  wink: [0.25, (c, o) => {
    tone(c, o, { f0: 600, f1: 1250, glide: 0.04, dur: 0.06, peak: 0.35 });
    tone(c, o, { t: 0.07, f0: 2500, dur: 0.12, peak: 0.08 });
  }],
  yawn: [0.9, (c, o) => tone(c, o, { f0: 520, f1: 240, glide: 0.75, dur: 0.8, peak: 0.28, attack: 0.08, vibrato: [4, 6] })],
  sleep: [1.2, (c, o) => {
    tone(c, o, { f0: 220, dur: 0.45, peak: 0.18, attack: 0.15 });
    tone(c, o, { t: 0.55, f0: 196, dur: 0.5, peak: 0.14, attack: 0.15 });
  }],
  greet: [0.8, (c, o) => {
    [C5, E5, G5, C6].forEach((f, i) => bloop(c, o, i * 0.11, f * 0.85, f, 0.14, 0.38));
    tone(c, o, { t: 0.46, f0: 2093, dur: 0.22, peak: 0.08 });
  }],
  proud: [0.85, (c, o) => {
    [C5, E5, G5].forEach((f, i) => tone(c, o, { t: i * 0.08, type: "triangle", f0: f, dur: 0.12, peak: 0.28 }));
    chime(c, o, 0.24, C6, 0.5, 0.32);
  }],

  // ── Work going on ──
  work: [0.35, (c, o) => {
    tone(c, o, { type: "triangle", f0: G4, dur: 0.08, peak: 0.28 });
    tone(c, o, { t: 0.09, type: "triangle", f0: C5, dur: 0.12, peak: 0.28 });
  }],
  think: [0.6, (c, o) => tone(c, o, { f0: 330, f1: 350, dur: 0.5, peak: 0.22, attack: 0.06, vibrato: [5, 8] })],
  search: [0.5, (c, o) => {
    tone(c, o, { f0: 500, f1: 1500, glide: 0.18, dur: 0.2, peak: 0.25 });
    tone(c, o, { t: 0.2, f0: 1500, f1: 800, glide: 0.2, dur: 0.22, peak: 0.16 });
  }],
  rate: [0.8, (c, o) => tone(c, o, { type: "triangle", f0: 480, f1: 340, glide: 0.6, dur: 0.65, peak: 0.28, vibrato: [3, 12] })],

  // ── News ──
  finish: [1.0, (c, o) => { chime(c, o, 0, E5); chime(c, o, 0.14, A5); }],
  approve: [0.7, (c, o) => { chime(c, o, 0, G5, 0.45, 0.35); chime(c, o, 0.09, D6, 0.5, 0.35); }],
  error: [0.6, (c, o) => {
    tone(c, o, { type: "triangle", f0: A4, dur: 0.16, peak: 0.32 });
    tone(c, o, { t: 0.18, type: "triangle", f0: F4, dur: 0.3, peak: 0.32 });
  }],
  approval: [0.85, (c, o) => { chime(c, o, 0, E5, 0.55, 0.4); chime(c, o, 0.2, C5, 0.6, 0.4); }],
  question: [0.5, (c, o) => tone(c, o, { f0: 420, f1: 720, glide: 0.22, dur: 0.3, peak: 0.35, vibrato: [6, 10] })],

  // ── Files and chat ──
  gulp: [0.4, (c, o) => {
    tone(c, o, { f0: 260, f1: 90, glide: 0.12, dur: 0.16, peak: 0.55 });
    bloop(c, o, 0.18, 500, 800, 0.05, 0.18);
  }],
  attach: [0.35, (c, o) => { bloop(c, o, 0, 900, 700, 0.07, 0.35); bloop(c, o, 0.09, 700, 500, 0.09, 0.35); }],
  send: [0.35, (c, o) => {
    noise(c, o, { dur: 0.16, peak: 0.1, filter: "bandpass", f0: 500, f1: 3500 });
    bloop(c, o, 0.05, 500, 1100, 0.1, 0.32);
  }],
};

/** Renders every recipe into a buffer. A sound that fails is simply left out. */
export async function renderAll(): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  await Promise.all(
    Object.entries(RECIPES).map(async ([name, [seconds, build]]) => {
      try {
        const c = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
        build(c, c.destination);
        out.set(name, await c.startRendering());
      } catch {
        /* a missing sound must never break the island */
      }
    }),
  );
  return out;
}
