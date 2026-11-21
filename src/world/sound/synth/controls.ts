// The wind's control signals, prerendered (design §4.1): band-limited random signals written into buffers at 3000 Hz
// (the lowest rate every engine accepts) and played at a tenth of the speed, so each sample lasts 1/300 s. Each is a
// sum of random-phase partials at whole multiples of its loop's frequency, so it loops seamlessly and holds nothing
// outside its band. The loop lengths (61, 13, 47 and 97 s as played) share no factor: together they never repeat
// within a visit. No sine LFOs, no sub-hertz biquads; the same in every browser.

import { rngFor, type Rng } from "../../core/rng.ts";

/** The buffers' sample rate, and the rate they are played at. */
export const CONTROL_RATE = 3000;
export const CONTROL_PLAYBACK = 0.1;
/** Control samples per second as played. */
export const CONTROL_HZ = CONTROL_RATE * CONTROL_PLAYBACK;

/** Seconds each loop lasts as played. */
export const GUST_S = 61;
export const FLUTTER_S = 13;
export const WHISTLE_S = 47;
export const DRIFT_S = 97;
/** Each whistle hears the gust front this much later, seconds. */
export const WHISTLE_DELAYS: readonly [number, number, number] = [0.3, 0.9, 1.7];
/** A squall is the part of its whistle's wind above this (of 0 … 1). */
export const SQUALL_FROM = 0.7;

/**
 * A unit-variance random signal of `seconds` (as played) holding only frequencies in [lo, hi] Hz, weighted by
 * `shape(f)` (amplitude). Seamless as a loop.
 */
export function bandNoise(seconds: number, lo: number, hi: number, rng: Rng, shape: (f: number) => number = () => 1): Float32Array {
  const n = Math.round(seconds * CONTROL_HZ);
  const x = new Float64Array(n);
  const k0 = Math.max(1, Math.ceil(lo * seconds)), k1 = Math.floor(hi * seconds);
  for (let k = k0; k <= k1; k++) {
    // A Rayleigh amplitude and a uniform phase: each partial is a Gaussian pair, so the sum is Gaussian noise.
    const amp = Math.sqrt(-2 * Math.log(Math.max(rng.float(), 1e-12))) * shape(k / seconds);
    const phase = 2 * Math.PI * rng.float();
    const w = (2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) x[i] += amp * Math.cos(w * i + phase);
  }
  let s2 = 0;
  for (let i = 0; i < n; i++) s2 += x[i] * x[i];
  const g = s2 > 0 ? 1 / Math.sqrt(s2 / n) : 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] * g;
  return out;
}

/** A unit-variance signal squashed smoothly into 0 … 1, centred on 0.5. */
function unit(z: Float32Array, drive: number): Float32Array {
  const out = new Float32Array(z.length);
  for (let i = 0; i < z.length; i++) out[i] = 0.5 + 0.5 * Math.tanh(drive * z[i]);
  return out;
}

/** `x` read `seconds` earlier, round the loop. */
function delayed(x: Float32Array, seconds: number): Float32Array {
  const n = x.length, d = Math.round(seconds * CONTROL_HZ);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = x[(((i - d) % n) + n) % n];
  return out;
}

export interface Controls {
  /** One channel, 0 … 1: the slow gust (about 0.3 Hz of bandwidth). */
  gust: Float32Array[];
  /** Two channels, 0 … 1: each ear's own buffet flutter, 8–14 Hz. */
  flutter: Float32Array[];
  /** Six channels: for each whistle its gust (0 … 1) and its squall (0 except in gusts), already delayed. */
  whistle: Float32Array[];
  /** Two channels, −1 … 1: slow wander at up to 0.07 and 0.11 Hz. */
  drift: Float32Array[];
}

export function makeControls(seed: number): Controls {
  // A soft roll-off above the corner, as two one-pole low-passes would give.
  const soft = (fc: number) => (f: number) => 1 / (1 + (f / fc) * (f / fc));
  const gustZ = bandNoise(GUST_S, 0, 0.9, rngFor(seed, "sound/gust"), soft(0.3));
  const gust = unit(gustZ, 0.9);

  const flutter = [0, 1].map((ear) => {
    // The buffet's flutter rides on a slower swell of its own, so its depth comes and goes.
    const fast = bandNoise(FLUTTER_S, 8, 14, rngFor(seed, `sound/flutter/${ear}`));
    const slow = bandNoise(FLUTTER_S, 0, 2.5, rngFor(seed, `sound/flutter/slow/${ear}`), soft(1));
    const z = new Float32Array(fast.length);
    for (let i = 0; i < z.length; i++) z[i] = 0.8 * fast[i] + 0.6 * slow[i];
    return unit(z, 0.8);
  });

  // The whistles share one wind (its own loop, unrelated to the main gust), each hearing it later than the last, and
  // each with a faster texture of its own; a squall is what stands above SQUALL_FROM.
  const windZ = bandNoise(WHISTLE_S, 0, 0.9, rngFor(seed, "sound/whistle/wind"), soft(0.3));
  const whistle: Float32Array[] = [];
  for (let i = 0; i < 3; i++) {
    const z = delayed(windZ, WHISTLE_DELAYS[i]);
    const g = unit(z, 0.9);
    const fast = bandNoise(WHISTLE_S, 0, 5, rngFor(seed, `sound/whistle/squall/${i}`), soft(3));
    const q = new Float32Array(z.length);
    for (let j = 0; j < q.length; j++) {
      const u = 0.5 + 0.5 * Math.tanh(0.9 * z[j] + 0.35 * fast[j]);
      const a = Math.max(0, (u - SQUALL_FROM) / (1 - SQUALL_FROM));
      // Eased at both ends, so a squall swells in and out with no corner.
      q[j] = a * a * (3 - 2 * a);
    }
    whistle.push(g, q);
  }

  const drift = [0.07, 0.11].map((hz, i) => {
    const z = bandNoise(DRIFT_S, 0, hz, rngFor(seed, `sound/drift/${i}`));
    const out = new Float32Array(z.length);
    for (let j = 0; j < z.length; j++) out[j] = Math.tanh(0.8 * z[j]);
    return out;
  });

  return { gust: [gust], flutter, whistle, drift };
}
