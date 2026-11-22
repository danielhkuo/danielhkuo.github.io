// Rain on land (design §14.2): drops at random times over a quiet hiss of the same colour, summed into a loop that
// wraps on itself so it is seamless. Each drop is a short tick of noise rung through a resonance, coming up over a few
// milliseconds and dying within a few tens; bigger drops ring lower, longer and a little louder.
//
// What keeps a drop a drop and not a click is how it comes up and what it comes up out of. Out of silence, in 2 ms,
// it is an edge to the ear and to the checker (as the shingle's bumps were): the checker flags a sample that stands
// more than about 16 dB over what is around it, and the first loop of drops gave 172 in 30 s. Coming up over 8 ms,
// out of a hiss in their own band at 0.15 of their level, none are flagged at a light or a full shower, and they stand
// far enough out to carry over the wind and the surf (blind critics asked for the drops up and the bed under them
// down, then for fewer and louder drops). Their sizes are kept to a narrow range, and no drop's peak stands more than
// `capDb` over the middle drop's, so the loudest few do not set the rain's true peak.

import type { Rng } from "../../core/rng.ts";
import { gaussianInto } from "./noise.ts";

export interface DropOptions {
  seconds: number;
  /** Drops a second. */
  rate: number;
  /** The resonance, Hz: the smallest drop rings at `hiHz`, the biggest at `loHz` (log-uniform between). */
  loHz: number;
  hiHz: number;
  /** Seconds a drop takes to come up (a raised cosine). */
  rise: number;
  /** Its decay's time constant, seconds: `tauLo` for the smallest, `tauHi` for the biggest. */
  tauLo: number;
  tauHi: number;
  /** The spread of the drops' levels: log-normal with this deviation, dB, cut at `clamp` deviations. */
  spreadDb: number;
  clamp: number;
  /** How much louder the biggest drop is than the smallest, as ± a share about 1. */
  sizeSpread: number;
  /** The most a drop's peak may stand over the middle (median) drop's, dB. */
  capDb: number;
  /** The hiss under the drops, as a share of their rms, and the resonances it rings, Hz. */
  floor: number;
  floorHz: readonly number[];
}

export const DROPS: DropOptions = {
  seconds: 7.3, rate: 7, loHz: 1100, hiHz: 4200, rise: 0.008, tauLo: 0.005, tauHi: 0.014,
  spreadDb: 3, clamp: 1.5, sizeSpread: 0.3, capDb: 6, floor: 0.15, floorHz: [1300, 2000, 3000, 4000],
};

/** A two-pole resonator's coefficients at `hz`, its pole radius 1 − w/`k` (k 6: Q about 3; k 3: about 1.5). */
function resonator(hz: number, sampleRate: number, k: number): { r: number; a1: number; a2: number } {
  const w = (2 * Math.PI * hz) / sampleRate, r = 1 - w / k;
  return { r, a1: 2 * r * Math.cos(w), a2: -r * r };
}

export function drops(o: DropOptions, sampleRate: number, rng: Rng): Float32Array {
  const n = Math.round(o.seconds * sampleRate);
  const out = new Float32Array(n);
  const count = Math.round(o.seconds * o.rate);
  const riseN = Math.max(1, Math.round(o.rise * sampleRate));
  const g = new Float32Array(2);
  // Each drop is made on its own first, so the loudest can be held to the cap.
  const made: { at: number; y: Float32Array; peak: number }[] = [];
  for (let k = 0; k < count; k++) {
    const at = rng.int(n);
    const size = rng.float();
    const hz = o.hiHz * Math.pow(o.loHz / o.hiHz, size);
    const tau = (o.tauLo + (o.tauHi - o.tauLo) * size) * sampleRate;
    gaussianInto(g, rng);
    const z = Math.max(-o.clamp, Math.min(o.clamp, g[0]));
    const amp = Math.pow(10, (o.spreadDb * z) / 20) * (1 - o.sizeSpread + 2 * o.sizeSpread * size);
    // To 60 dB down.
    const len = Math.min(n, riseN + Math.ceil(6.9 * tau));
    const { r, a1, a2 } = resonator(hz, sampleRate, 6);
    let y1 = 0, y2 = 0;
    const y = gaussianInto(new Float32Array(len), rng);
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const env = (i < riseN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / riseN) : 1) * Math.exp(-Math.max(0, i - riseN) / tau);
      const v = y[i] * env * (1 - r) + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = v;
      y[i] = amp * v;
      peak = Math.max(peak, Math.abs(y[i]));
    }
    made.push({ at, y, peak });
  }
  const peaks = made.map((d) => d.peak).sort((a, b) => a - b);
  const cap = (peaks[peaks.length >> 1] ?? 0) * Math.pow(10, o.capDb / 20);
  for (const d of made) {
    const k = d.peak > cap ? cap / d.peak : 1;
    for (let i = 0; i < d.y.length; i++) {
      const j = d.at + i;
      out[j < n ? j : j - n] += k * d.y[i];
    }
  }
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += out[i] * out[i];
  // The hiss: steady noise rung through broad resonances across the drops' band, each run round the loop twice so it
  // joins itself.
  const floor = new Float32Array(n);
  for (const hz of o.floorHz) {
    const { r, a1, a2 } = resonator(hz, sampleRate, 3);
    const noise = gaussianInto(new Float32Array(n), rng);
    let y1 = 0, y2 = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const y = noise[i] * (1 - r) + a1 * y1 + a2 * y2;
        y2 = y1;
        y1 = y;
        if (pass === 1) floor[i] += y;
      }
    }
  }
  let f2 = 0;
  for (let i = 0; i < n; i++) f2 += floor[i] * floor[i];
  const kf = f2 > 0 ? o.floor * Math.sqrt(d2 / f2) : 0;
  for (let i = 0; i < n; i++) out[i] += kf * floor[i];
  // The level of the bubble beds: rms 0.1, about its mean.
  let sum = 0;
  for (let i = 0; i < n; i++) sum += out[i];
  const mean = sum / n;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    out[i] -= mean;
    s2 += out[i] * out[i];
  }
  const k = 0.1 / Math.sqrt(s2 / n || 1);
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}
