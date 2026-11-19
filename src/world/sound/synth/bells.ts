// The abbey's bells (design §4.6; Recipes §5): five old-style bells, each a set of inharmonic partials, most of them a
// doublet (two modes a little apart, which beat), each partial with its own decay, so a stroke goes from bright clang
// to dark hum. Rendered once, by plain arithmetic: two ring takes a bell (the two sides of a swinging mouth: other
// shares of each doublet) and one strike (the clapper's noise and three short high partials).
//
// Rendered at the context's own sample rate. (The design had 32 kHz, since nothing in a bell is above 9 kHz; but a
// buffer played off the context's rate is resampled sample by sample, which costs the audio thread ten times as much
// for every ring that is sounding, and a peal has fifteen.)

import { hash2 } from "../../core/hash.ts";
import { rngFor } from "../../core/rng.ts";
import { gaussianInto } from "./noise.ts";

/** Bells, treble (0) to tenor (4): each one's nominal as a ratio of the tenor's. */
export const BELL_RATIOS: readonly number[] = [1.498, 1.335, 1.189, 1.122, 1];
export const TENOR = 4;
/** The tenor's nominal, Hz: about a tonne of bell, its strike note near E4. */
export const TENOR_NOMINAL = 660;
/** Seconds each bell's ring lasts, treble to tenor. The last 1.5 s of every ring is ramped to zero in the render. */
export const RING_S: readonly number[] = [7.6, 8.2, 9.0, 9.4, 10];
export const RING_TAIL_S = 1.5;
/** Seconds of digital silence at each end of every buffer. */
export const BELL_PAD = 0.02;
export const STRIKE_S = 0.34;

/**
 * The partials of an old-style bell, as ratios of its nominal: name, ratio, start level (dB), seconds to fall 60 dB
 * (for the tenor; smaller bells scale by tenor nominal / their nominal), and the range its doublet's split is drawn
 * from, Hz (null: a single mode). The hum is sharp and the prime flat of their octaves: the sourness of an old abbey.
 */
export const PARTIALS: readonly { name: string; ratio: number; db: number; t60: number; split: readonly [number, number] | null }[] = [
  { name: "hum", ratio: 0.25 * Math.pow(2, 40 / 1200), db: -14, t60: 30, split: [0.3, 0.8] },
  { name: "prime", ratio: 0.5 * Math.pow(2, -30 / 1200), db: -8, t60: 15, split: [0.5, 1.5] },
  { name: "tierce", ratio: 0.5945, db: -5, t60: 12, split: [0.5, 1.5] },
  { name: "quint", ratio: 0.749, db: -16, t60: 6, split: null },
  { name: "nominal", ratio: 1, db: 0, t60: 8, split: [0.6, 2] },
  { name: "superquint", ratio: 1.49, db: -4, t60: 3.5, split: [1, 3] },
  { name: "octave nominal", ratio: 2.04, db: -6, t60: 2.5, split: [1, 3] },
  { name: "I-7", ratio: 2.72, db: -10, t60: 1.2, split: null },
  { name: "I-8", ratio: 3.42, db: -14, t60: 0.8, split: null },
  { name: "I-9", ratio: 4.15, db: -18, t60: 0.5, split: null },
];

const unit = (h: number) => h / 4294967296;

export interface BellPartial {
  name: string;
  /** The partial's frequency, Hz: the middle of its doublet. */
  hz: number;
  /** Its ratio to this bell's nominal, as designed (table ratio and this bell's own offset). */
  ratio: number;
  /** Start level, linear, and seconds to fall 60 dB. */
  level: number;
  t60: number;
  /** The doublet's split, Hz (0: a single mode), and the share of the level its lower half takes in take 0. */
  split: number;
  share: number;
}

export interface BellDesign {
  bell: number;
  nominal: number;
  partials: BellPartial[];
}

/** One bell as designed: its nominal (±12 cents by seed), its hum and prime a little off the table (±20 cents), its doublets. */
export function bellDesign(seed: number, bell: number): BellDesign {
  const cents = (k: number, range: number) => (unit(hash2(bell, k, seed ^ 0xbe11)) * 2 - 1) * range;
  const nominal = TENOR_NOMINAL * BELL_RATIOS[bell] * Math.pow(2, cents(100, 12) / 1200);
  const scale = TENOR_NOMINAL / nominal;
  const partials = PARTIALS.map((p, k) => {
    // No old bell matches the table: its hum and prime sit where its own casting left them.
    const off = k < 2 ? cents(k, 20) : 0;
    const ratio = p.ratio * Math.pow(2, off / 1200);
    const split = p.split ? p.split[0] + (p.split[1] - p.split[0]) * unit(hash2(bell, k + 20, seed ^ 0xbe11)) : 0;
    return {
      name: p.name, hz: nominal * ratio, ratio, level: Math.pow(10, p.db / 20), t60: p.t60 * scale, split,
      share: 0.2 + 0.6 * unit(hash2(bell, k + 40, seed ^ 0xbe11)),
    };
  });
  return { bell, nominal, partials };
}

/**
 * A ring: every partial of the bell, each a decaying sinusoid (or two, beating), for RING_S seconds, its last 1.5 s
 * ramped to nothing so no buffer ends on a live hum. Take 1 swaps each doublet's shares: the mouth's other side.
 * Peak about 0.5. 20 ms of silence either side; a 3 ms rise so the first sample is not a step.
 */
export function ring(seed: number, bell: number, take: number, sampleRate: number): Float32Array {
  const d = bellDesign(seed, bell);
  const seconds = RING_S[bell];
  const pad = Math.round(BELL_PAD * sampleRate), n = Math.round(seconds * sampleRate);
  const body = n - 2 * pad;
  const acc = new Float64Array(body);
  for (let k = 0; k < d.partials.length; k++) {
    const p = d.partials[k];
    const share = take === 0 ? p.share : 1 - p.share;
    const halves = p.split > 0 ? [[p.hz - p.split / 2, share], [p.hz + p.split / 2, 1 - share]] : [[p.hz, 1]];
    const decay = 6.908 / p.t60;
    for (let h = 0; h < halves.length; h++) {
      const w = (2 * Math.PI * halves[h][0]) / sampleRate, amp = p.level * halves[h][1];
      // Each mode starts at its own phase (the clapper does not start them together), fixed for the bell.
      const phase = 2 * Math.PI * unit(hash2(bell * 16 + k, h + 60 + take, seed ^ 0xbe11));
      // sin(wi + phase) by rotation: no sine in the loop.
      let s = Math.sin(phase), c = Math.cos(phase);
      const sw = Math.sin(w), cw = Math.cos(w);
      const fall = Math.exp(-decay / sampleRate);
      let env = amp;
      for (let i = 0; i < body; i++) {
        acc[i] += env * s;
        const ns = s * cw + c * sw;
        c = c * cw - s * sw;
        s = ns;
        env *= fall;
      }
    }
  }
  const out = new Float32Array(n);
  const rise = Math.round(0.003 * sampleRate), tail = Math.round(RING_TAIL_S * sampleRate);
  let peak = 0;
  for (let i = 0; i < body; i++) {
    let v = acc[i];
    if (i < rise) v *= 0.5 - 0.5 * Math.cos((Math.PI * i) / rise);
    const left = body - 1 - i;
    if (left < tail) v *= (left / tail) * (left / tail) * (3 - (2 * left) / tail);
    acc[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  // Every bell and take is brought to the same peak; the ring's level is the schedule's to set.
  for (let i = 0; i < body; i++) out[pad + i] = (0.5 * acc[i]) / peak;
  return out;
}

/** The strike: 6 ms of the clapper's noise round three times the nominal, and three high partials gone in a quarter second. */
export function strike(seed: number, bell: number, sampleRate: number): Float32Array {
  const d = bellDesign(seed, bell);
  const pad = Math.round(BELL_PAD * sampleRate), n = Math.round(STRIKE_S * sampleRate);
  const body = n - 2 * pad;
  const out = new Float32Array(n);
  // Noise through a two-pole resonator (Q about 1.5) at 3 × the nominal, under a 6 ms window.
  const burst = Math.round(0.006 * sampleRate);
  const noise = gaussianInto(new Float32Array(burst), rngFor(seed, `sound/bell/strike/${bell}`));
  const w = (2 * Math.PI * Math.min(3 * d.nominal, 0.4 * sampleRate)) / sampleRate, r = 1 - w / 3;
  const a1 = 2 * r * Math.cos(w), a2 = -r * r;
  let y1 = 0, y2 = 0;
  for (let i = 0; i < body; i++) {
    const x = i < burst ? noise[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (burst - 1))) : 0;
    const y = x * (1 - r) + a1 * y1 + a2 * y2;
    y2 = y1;
    y1 = y;
    out[pad + i] = 0.9 * y;
  }
  const highs = [5.3, 6.6, 8.1], decay = 6.908 / 0.25;
  for (let k = 0; k < highs.length; k++) {
    const hz = Math.min(highs[k] * d.nominal, 0.45 * sampleRate);
    const wk = (2 * Math.PI * hz) / sampleRate;
    for (let i = 0; i < body; i++) {
      const t = i / sampleRate;
      out[pad + i] += 0.25 * Math.pow(0.7, k) * Math.sin(wk * i) * Math.exp(-decay * t);
    }
  }
  // Faded to nothing over its last 40 ms; levelled to a peak of 0.5.
  const tail = Math.round(0.04 * sampleRate);
  let peak = 0;
  for (let i = 0; i < body; i++) {
    const left = body - 1 - i;
    if (left < tail) out[pad + i] *= left / tail;
    if (i < 8) out[pad + i] *= i / 8;
    peak = Math.max(peak, Math.abs(out[pad + i]));
  }
  for (let i = 0; i < n; i++) out[i] *= 0.5 / peak;
  return out;
}

export const ringName = (bell: number, take: number) => `ring${bell}${take}`;
export const strikeName = (bell: number) => `strike${bell}`;
