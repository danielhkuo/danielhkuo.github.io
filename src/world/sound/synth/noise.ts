// Noise, as plain arrays (design §4.1, §4.3; Recipes "Shared building blocks"). Every buffer is a seamless loop: the
// colouring filters are run over the buffer twice and the second pass kept, so the filter's state at the loop point is
// the state it would have had coming round.

import type { Rng } from "../../core/rng.ts";

/** RMS every noise buffer is brought to: −14 dBFS, so a 4σ peak sits near full scale. */
export const NOISE_RMS = 0.2;

/** Standard normal samples (Box–Muller) into `out`. */
export function gaussianInto(out: Float32Array, rng: Rng): Float32Array {
  for (let i = 0; i < out.length; i += 2) {
    const u = Math.max(rng.float(), 1e-12);
    const v = rng.float();
    const r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < out.length) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

/** Brings `x` to zero mean and the given RMS, in place. */
export function level(x: Float32Array, rms = NOISE_RMS): Float32Array {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i];
  const mean = sum / x.length;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    x[i] -= mean;
    s2 += x[i] * x[i];
  }
  const k = s2 > 0 ? rms / Math.sqrt(s2 / x.length) : 0;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

/**
 * Paul Kellet's pink filter: six one-poles and a one-sample delay. The worklet runs the same numbers (they arrive in
 * its options); pinkInto and the gain below share them so the two cannot drift.
 */
export const PINK_POLES = [0.99886, 0.99332, 0.969, 0.8665, 0.55, -0.7616] as const;
export const PINK_WEIGHTS = [0.0555179, 0.0750759, 0.153852, 0.3104856, 0.5329522, -0.016898] as const;
export const PINK_FEED = 0.5362;
/** Added one sample late: the filter's b6, which is the previous white sample times this. */
export const PINK_DELAY = 0.115926;

/** One sample of the pink filter. `s` is the six poles and then the delay. */
export function pinkStep(s: number[], w: number): number {
  s[0] = PINK_POLES[0] * s[0] + w * PINK_WEIGHTS[0];
  s[1] = PINK_POLES[1] * s[1] + w * PINK_WEIGHTS[1];
  s[2] = PINK_POLES[2] * s[2] + w * PINK_WEIGHTS[2];
  s[3] = PINK_POLES[3] * s[3] + w * PINK_WEIGHTS[3];
  s[4] = PINK_POLES[4] * s[4] + w * PINK_WEIGHTS[4];
  s[5] = PINK_POLES[5] * s[5] + w * PINK_WEIGHTS[5];
  const y = s[0] + s[1] + s[2] + s[3] + s[4] + s[5] + s[6] + w * PINK_FEED;
  s[6] = w * PINK_DELAY;
  return y;
}

/** Pink (−3 dB an octave): Paul Kellet's filter, in place, as a seamless loop. */
export function pinkInto(x: Float32Array): Float32Array {
  const s = [0, 0, 0, 0, 0, 0, 0];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < x.length; i++) {
      const y = pinkStep(s, x[i]);
      if (pass === 1) x[i] = y;
    }
  }
  return x;
}

/** Brown rolls off above this, Hz. */
export const BROWN_HZ = 23;

/** The leaky integrator's pole at `sampleRate`. */
export function brownLeak(sampleRate: number): number {
  return Math.exp((-2 * Math.PI * BROWN_HZ) / sampleRate);
}

/**
 * Energy of the brown filter's impulse response, sum of leak^(2n). Unit Gaussian noise comes out at this RMS, which
 * is the level a noise made as it plays scales from: it cannot measure a whole buffer the way level() does.
 */
export function brownEnergy(sampleRate: number): number {
  const leak = brownLeak(sampleRate);
  return 1 / (1 - leak * leak);
}

let pinkE = 0;

/**
 * Energy of the pink filter's impulse response. The poles do not depend on the sample rate, so one sum is every
 * context's. The slowest pole is gone after a few thousand samples; this runs well past that tail.
 */
export function pinkEnergy(): number {
  if (pinkE !== 0) return pinkE;
  const s = [0, 0, 0, 0, 0, 0, 0];
  let e = 0;
  for (let i = 0; i < 65536; i++) {
    const y = pinkStep(s, i === 0 ? 1 : 0);
    e += y * y;
  }
  pinkE = e;
  return e;
}

/** The gain that brings unit Gaussian noise, once coloured, to NOISE_RMS. White is already there. */
export function colourGain(colour: Colour, sampleRate: number): number {
  if (colour === "white") return NOISE_RMS;
  const energy = colour === "pink" ? pinkEnergy() : brownEnergy(sampleRate);
  return NOISE_RMS / Math.sqrt(energy);
}

/** Brown (−6 dB an octave above about 23 Hz): a leaky integrator, in place, as a seamless loop. */
export function brownInto(x: Float32Array, sampleRate: number): Float32Array {
  const leak = brownLeak(sampleRate);
  let y = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < x.length; i++) {
      y = leak * y + x[i];
      if (pass === 1) x[i] = y;
    }
  }
  return x;
}

export type Colour = "white" | "pink" | "brown";

/** One levelled channel of coloured noise. */
export function noise(colour: Colour, length: number, sampleRate: number, rng: Rng): Float32Array {
  const x = gaussianInto(new Float32Array(length), rng);
  if (colour === "pink") pinkInto(x);
  else if (colour === "brown") brownInto(x, sampleRate);
  return level(x);
}

/**
 * Mix of two unit noises that correlate at `rho`: a² + b² = 1 and 2ab = rho, so each output stays at the inputs'
 * level. Zero is left unmixed (a = 1, b = 0). The worklet uses the same pair.
 */
export function stereoGains(rho: number): { a: number; b: number } {
  if (rho === 0) return { a: 1, b: 0 };
  const a = Math.sqrt((1 + Math.sqrt(1 - rho * rho)) / 2);
  return { a, b: rho / (2 * a) };
}

/**
 * Two channels with correlation `rho` between them: 0 for a buffet that is separate in each ear, 0.7 for a rush that
 * is wide but holds its centre (0.922·n1 + 0.380·n2 and the mirror).
 */
export function stereoNoise(colour: Colour, length: number, sampleRate: number, rho: number, rng: Rng): [Float32Array, Float32Array] {
  const n1 = noise(colour, length, sampleRate, rng);
  const n2 = noise(colour, length, sampleRate, rng);
  const { a, b } = stereoGains(rho);
  if (b === 0) return [n1, n2];
  const l = new Float32Array(length), r = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    l[i] = a * n1[i] + b * n2[i];
    r[i] = b * n1[i] + a * n2[i];
  }
  return [l, r];
}

// ── The waves' fresh noise (§4.3) ────────────────────────────────────────────────────────────────────────────────────

/** The Gaussian loop's length, and the four sign loops': pairwise coprime, so no pairing lines up again for 18 days. */
export const WAVE_LOOP = 262144;
export const SIGN_LOOPS: readonly number[] = [355343, 418027, 291869, 331999];

/** A loop of ±1. A Gaussian sample times a random sign is still Gaussian white noise. */
export function signLoop(length: number, rng: Rng): Float32Array {
  const x = new Float32Array(length);
  for (let i = 0; i < length; i += 32) {
    let bits = rng.next();
    for (let j = i; j < i + 32 && j < length; j++) {
      x[j] = bits & 1 ? 1 : -1;
      bits >>>= 1;
    }
  }
  return x;
}

export function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
