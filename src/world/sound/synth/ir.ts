// The reverb's impulse response (design §6.1): the abbey's stone and the valley round it, generated. 2.5 s, stereo,
// seeded noise that dies away at T60 2.2 s, each ear its own; a one-pole low-pass that slides from 6 kHz down to
// 1.2 kHz as it rings, so the tail darkens; four early taps between 150 and 600 ms (the first walls); each channel
// brought to unit energy, to be used with normalize = false. Never swapped.

import { rngFor } from "../../core/rng.ts";
import { gaussianInto } from "./noise.ts";

export const IR_S = 2.5;
export const IR_T60 = 2.2;
/** The early taps: seconds, and each one's level against the tail's start. */
export const IR_TAPS: readonly (readonly [number, number])[] = [[0.15, 0.9], [0.27, 0.7], [0.41, 0.55], [0.6, 0.4]];
/** The low-pass's cutoff at the start and at the end, Hz. */
const BRIGHT = 6000, DARK = 1200;

export function impulseResponse(seed: number, sampleRate: number): [Float32Array, Float32Array] {
  const n = Math.round(IR_S * sampleRate);
  const make = (ear: number): Float32Array => {
    const x = gaussianInto(new Float32Array(n), rngFor(seed, `sound/ir/${ear}`));
    const out = new Float32Array(n);
    const decay = 6.908 / IR_T60;
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      // The cutoff slides in log frequency; the one-pole's coefficient follows it.
      const fc = BRIGHT * Math.pow(DARK / BRIGHT, t / IR_S);
      const k = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
      y += k * (x[i] - y);
      // The tail swells in over 80 ms (sound takes that long to come back from anything), then dies away.
      const rise = t < 0.08 ? t / 0.08 : 1;
      // A lower cutoff lets less noise through: made up, so the decay is the envelope's alone.
      out[i] = (y / Math.sqrt(k / (2 - k))) * rise * Math.exp(-decay * t);
    }
    // Faded to nothing over the last 100 ms, so the response ends in silence.
    const tail = Math.round(0.1 * sampleRate);
    for (let i = 0; i < tail; i++) out[n - 1 - i] *= i / tail;
    // The early taps: single reflections, a little different in each ear.
    const tapRng = rngFor(seed, `sound/ir/taps/${ear}`);
    let rms = 0;
    const at0 = Math.round(0.1 * sampleRate);
    for (let i = at0; i < at0 + 2048; i++) rms += out[i] * out[i];
    rms = Math.sqrt(rms / 2048);
    for (const [seconds, level] of IR_TAPS) {
      const at = Math.round(seconds * sampleRate) + (ear === 0 ? 0 : Math.round(0.0007 * sampleRate * (1 + tapRng.float())));
      out[at] += 12 * rms * level * (tapRng.float() < 0.5 ? -1 : 1);
    }
    let e = 0;
    for (let i = 0; i < n; i++) e += out[i] * out[i];
    const g = 1 / Math.sqrt(e);
    for (let i = 0; i < n; i++) out[i] *= g;
    return out;
  };
  return [make(0), make(1)];
}

/** Seconds for the response's energy to fall 60 dB, by Schroeder's backward integration fitted between −5 and −25 dB. */
export function measuredT60(h: Float32Array, sampleRate: number): number {
  const n = h.length;
  const back = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    acc += h[i] * h[i];
    back[i] = acc;
  }
  const db = (i: number) => 10 * Math.log10(back[i] / back[0]);
  let a = 0, b = 0;
  while (a < n - 1 && db(a) > -5) a++;
  b = a;
  while (b < n - 1 && db(b) > -25) b++;
  return (60 * (b - a)) / sampleRate / 20;
}
