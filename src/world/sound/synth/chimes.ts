// The town clock's sounds (design §4.8; Recipes §7), rendered once by plain arithmetic: the chime bars the tune is
// played on, the wooden clacks of the figures and the doors, the doors' thud, and the ratchet's two-second loop.
//
// A chime is a small clamped bar: its fundamental, and one faint, short partial 6.27 times higher (the next, 17.55
// times, lies above hearing for most of these), with the tick of the hammer. Eleven bars: the tune's nine, E5 to F♯6
// in E Dorian, and two low ones, E4 and B4, for the first beat of each bar and the hour's count.

import { hash2 } from "../../core/hash.ts";
import { rngFor } from "../../core/rng.ts";
import { coefficients } from "./filters.ts";
import { gaussianInto } from "./noise.ts";

/** The bars, low to high, as semitones above E4. */
export const CHIME_NAMES = ["E4", "B4", "E5", "F#5", "G5", "A5", "B5", "C#6", "D6", "E6", "F#6"] as const;
export type ChimeName = (typeof CHIME_NAMES)[number];
const SEMITONES = [0, 7, 12, 14, 15, 17, 19, 21, 22, 24, 26];
const E4 = 329.628;
export const CHIME_PAD = 0.02;
export const chimeName = (i: number) => `chime${i}`;
export const clackName = (k: number) => `clack${k}`;
/** Clacks: one for each of the five figures, one for the doors. */
export const CLACKS = 6;
export const RATCHET_S = 2;
export const RATCHET_TICKS = 8;

const unit = (h: number) => h / 4294967296;

/** Bar i's pitch, Hz: equal temperament from E4, each bar its own few cents out (±6), as a hand-tuned set is. */
export function chimeHz(seed: number, i: number): number {
  return E4 * Math.pow(2, SEMITONES[i] / 12) * Math.pow(2, ((2 * unit(hash2(i, 0xc41e, seed)) - 1) * 6) / 1200);
}

/** Seconds a bar takes to fall 60 dB: 1.8 s at 800 Hz, longer the lower it is. */
export function chimeT60(hz: number): number {
  return (1.8 * 800) / hz;
}

/** One strike of bar i: peak 0.5, 20 ms of silence either side, faded to nothing over its last fifth. */
export function chime(seed: number, i: number, sampleRate: number): Float32Array {
  const hz = chimeHz(seed, i), t60 = chimeT60(hz);
  const seconds = Math.min(4.5, 1.05 * t60);
  const pad = Math.round(CHIME_PAD * sampleRate), body = Math.round(seconds * sampleRate);
  const out = new Float32Array(body + 2 * pad);
  // The hammer's tick: 2 ms of noise through a band at 4 kHz.
  const tick = gaussianInto(new Float32Array(Math.round(0.002 * sampleRate)), rngFor(seed, `sound/chime/${i}`));
  const c = coefficients({ type: "bandpass", hz: 4000, q: 1.5 }, sampleRate);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, peak = 0;
  const w1 = (2 * Math.PI * hz) / sampleRate, w2 = (2 * Math.PI * Math.min(6.27 * hz, 0.45 * sampleRate)) / sampleRate;
  const d1 = 6.908 / t60, d2 = 6.908 / 0.25;
  const tail = Math.round(0.2 * body);
  for (let k = 0; k < body; k++) {
    const t = k / sampleRate;
    const x = k < tick.length ? tick[k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (tick.length - 1))) : 0;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    let v = Math.sin(w1 * k) * Math.exp(-d1 * t) + 0.158 * Math.sin(w2 * k) * Math.exp(-d2 * t) + 0.5 * y;
    // A 1.5 ms rise: the bar speaks at once, but not as a step.
    if (t < 0.0015) v *= t / 0.0015;
    const left = body - 1 - k;
    if (left < tail) v *= (left / tail) * (left / tail);
    out[pad + k] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  for (let k = 0; k < body; k++) out[pad + k] *= 0.5 / peak;
  return out;
}

/** Wood on wood: 4 ms of noise ringing three short resonances (520, 1240, 2100 Hz, each ±10 % for this clack). */
export function clack(seed: number, k: number, sampleRate: number): Float32Array {
  const pad = Math.round(CHIME_PAD * sampleRate), body = Math.round(0.2 * sampleRate);
  const out = new Float32Array(body + 2 * pad);
  const burst = gaussianInto(new Float32Array(Math.round(0.004 * sampleRate)), rngFor(seed, `sound/clack/${k}`));
  const modes: [number, number, number][] = [[520, 0.07, 1], [1240, 0.045, 0.7], [2100, 0.025, 0.5]];
  let peak = 0;
  for (let m = 0; m < 3; m++) {
    const hz = modes[m][0] * (0.9 + 0.2 * unit(hash2(k, m, seed ^ 0xc1ac))), t60 = modes[m][1] * 3;
    // A two-pole resonator rung by the burst.
    const r = Math.exp(-6.908 / (t60 * sampleRate)), w = (2 * Math.PI * hz) / sampleRate;
    const a1 = 2 * r * Math.cos(w), a2 = -r * r;
    let y1 = 0, y2 = 0;
    for (let i = 0; i < body; i++) {
      const x = i < burst.length ? burst[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (burst.length - 1))) : 0;
      const y = x + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = y;
      out[pad + i] += modes[m][2] * y * (1 - r);
    }
  }
  const tail = Math.round(0.03 * sampleRate);
  for (let i = 0; i < body; i++) {
    const left = body - 1 - i;
    if (left < tail) out[pad + i] *= left / tail;
    peak = Math.max(peak, Math.abs(out[pad + i]));
  }
  for (let i = 0; i < body; i++) out[pad + i] *= 0.5 / peak;
  return out;
}

/** The doors' thud: a short low knock (noise under 200 Hz, 150 ms). */
export function thud(seed: number, sampleRate: number): Float32Array {
  const pad = Math.round(CHIME_PAD * sampleRate), body = Math.round(0.22 * sampleRate);
  const out = new Float32Array(body + 2 * pad);
  const x = gaussianInto(new Float32Array(body), rngFor(seed, "sound/thud"));
  const c = coefficients({ type: "lowpass", hz: 200, q: -3.01 }, sampleRate);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, peak = 0;
  for (let i = 0; i < body; i++) {
    const t = i / sampleRate;
    const y = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    const v = y * Math.min(1, t / 0.006) * Math.exp(-t / 0.045) * Math.min(1, (body - i) / (0.02 * sampleRate));
    out[pad + i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < body; i++) out[pad + i] *= 0.5 / peak;
  return out;
}

/** The ratchet: eight small ticks in two seconds (the figures step four times a second), a seamless loop. */
export function ratchet(seed: number, sampleRate: number): Float32Array {
  const n = Math.round(RATCHET_S * sampleRate);
  const out = new Float32Array(n);
  const rng = rngFor(seed, "sound/ratchet");
  for (let k = 0; k < RATCHET_TICKS; k++) {
    const at = Math.round(((k + 0.05) / RATCHET_TICKS) * n);
    const hz = 2600 + 500 * rng.float(), r = Math.exp(-6.908 / (0.03 * sampleRate)), w = (2 * Math.PI * hz) / sampleRate;
    const a1 = 2 * r * Math.cos(w), a2 = -r * r, level = 0.7 + 0.3 * rng.float();
    let y1 = 0, y2 = 0;
    const len = Math.round(0.06 * sampleRate);
    for (let i = 0; i < len; i++) {
      // Rung by a 1 ms bump, so the tick has no step in it.
      const x = i < 48 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 47) : 0;
      const y = x + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = y;
      out[(at + i) % n] += level * y * (1 - r) * Math.min(1, (len - i) / 200);
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) out[i] *= 0.5 / peak;
  return out;
}
