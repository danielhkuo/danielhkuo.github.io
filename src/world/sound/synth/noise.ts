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

/** Pink (−3 dB an octave): Paul Kellet's filter, in place, as a seamless loop. */
export function pinkInto(x: Float32Array): Float32Array {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < x.length; i++) {
      const w = x[i];
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      if (pass === 1) x[i] = y;
    }
  }
  return x;
}

/** Brown (−6 dB an octave above about 23 Hz): a leaky integrator, in place, as a seamless loop. */
export function brownInto(x: Float32Array, sampleRate: number): Float32Array {
  const leak = Math.exp((-2 * Math.PI * 23) / sampleRate);
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
 * Two channels with correlation `rho` between them: 0 for a buffet that is separate in each ear, 0.7 for a rush that
 * is wide but holds its centre (0.922·n1 + 0.380·n2 and the mirror).
 */
export function stereoNoise(colour: Colour, length: number, sampleRate: number, rho: number, rng: Rng): [Float32Array, Float32Array] {
  const n1 = noise(colour, length, sampleRate, rng);
  const n2 = noise(colour, length, sampleRate, rng);
  if (rho === 0) return [n1, n2];
  // a² + b² = 1 and 2ab = rho.
  const a = Math.sqrt((1 + Math.sqrt(1 - rho * rho)) / 2), b = rho / (2 * a);
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
