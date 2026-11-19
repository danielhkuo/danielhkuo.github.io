// Water as bubbles (Recipes §4): each one a damped sinusoid at its Minnaert frequency, rising a little as it rings,
// summed into a loop that wraps on itself so it is seamless. The surf needs the dense, low `plunge` bed (the slosh in
// a rock gully) and the lap one-shots; the brook and the river's purl are made here too when the rivers are built.

import type { Rng } from "../../core/rng.ts";
import { gaussianInto } from "./noise.ts";

export interface BedOptions {
  seconds: number;
  /** Bubbles a second. */
  rate: number;
  /** Radii, metres: drawn from a power law (exponent −1.5), many small and few large. */
  rMin: number;
  rMax: number;
  /** Seconds each bubble takes to come up to its level (half a millisecond when absent). */
  rise?: number;
}

export const PLUNGE: BedOptions = { seconds: 7.9, rate: 1500, rMin: 0.001, rMax: 0.008 };
/** The brook: few bubbles, each heard on its own (discrete, playful). */
export const BROOK: BedOptions = { seconds: 9.7, rate: 60, rMin: 0.0008, rMax: 0.005, rise: 0.006 };
/** The river's purl: many small bubbles, a continuous sound. */
export const FLOW: BedOptions = { seconds: 13.3, rate: 400, rMin: 0.0006, rMax: 0.003, rise: 0.003 };

/** A bubble's own frequency, Hz, for its radius in metres (Minnaert). */
export function bubbleHz(r: number): number {
  return 3.26 / r;
}

/** Adds one bubble of radius r (m) starting at sample `at`, wrapping round `out` when `wrapRound`. */
function bubble(out: Float32Array, sampleRate: number, at: number, r: number, amp: number, wrapRound: boolean, riseS = 0.0005): void {
  const f0 = bubbleHz(r);
  const d = 0.043 * f0 + 0.0014 * Math.pow(f0, 1.5);
  // Rings until 60 dB down.
  const len = Math.min(Math.ceil((6.9 / d) * sampleRate), wrapRound ? out.length : out.length - at);
  const n = out.length;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    // The pitch rises as the bubble nears the surface.
    const f = f0 * (1 + 0.1 * d * t);
    phase += (2 * Math.PI * f) / sampleRate;
    // A short rise keeps the start from being a step. (Heard alone, as a brook's bubbles are, each needs a few
    // milliseconds, eased, or its start is a tick: the plunge and the laps, heard in a crowd, keep the short one.)
    const rise = t >= riseS ? 1 : riseS > 0.001 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / riseS) : t / riseS;
    const v = amp * rise * Math.sin(phase) * Math.exp(-d * t);
    const j = at + i;
    out[wrapRound ? j % n : j] += v;
  }
}

/** A seamless bed of bubbles, levelled to an RMS of 0.1. `each` is told every bubble's radius (m) and amplitude as it is added. */
export function bubbleBed(o: BedOptions, sampleRate: number, rng: Rng, each?: (r: number, amp: number) => void): Float32Array {
  const n = Math.round(o.seconds * sampleRate);
  const out = new Float32Array(n);
  const count = Math.round(o.seconds * o.rate);
  // r from a power law p(r) ∝ r^−1.5 between rMin and rMax, by inverting its distribution.
  const a = Math.pow(o.rMin, -0.5), b = Math.pow(o.rMax, -0.5);
  for (let i = 0; i < count; i++) {
    const r = Math.pow(a + (b - a) * rng.float(), -2);
    const amp = Math.pow(r / o.rMax, 1.5) * (0.5 + rng.float());
    bubble(out, sampleRate, rng.int(n), r, amp, true, o.rise);
    each?.(r, amp);
  }
  let s2 = 0;
  for (let i = 0; i < n; i++) s2 += out[i] * out[i];
  const k = 0.1 / Math.sqrt(s2 / n);
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/** Seconds a lap one-shot lasts, its pads of silence included. */
export const LAP_S = 0.24;
const PAD = 0.02;

/**
 * One lap against stone or bank: a small splash (a 70 ms tick of noise round 1.5 kHz) and one or two bubble tones
 * of 300–900 Hz that rise as they ring. 20 ms of digital silence either side; attack and release baked in.
 */
export function lap(sampleRate: number, rng: Rng): Float32Array {
  const n = Math.round(LAP_S * sampleRate), pad = Math.round(PAD * sampleRate);
  const out = new Float32Array(n);
  const body = n - 2 * pad;
  // The tick: noise through a two-pole resonator (Q about 2), 8 ms in, dying over 70 ms.
  const noise = gaussianInto(new Float32Array(body), rng);
  const w = (2 * Math.PI * (1300 + 500 * rng.float())) / sampleRate, r = 1 - w / 4;
  const a1 = 2 * r * Math.cos(w), a2 = -r * r;
  let y1 = 0, y2 = 0;
  const tick = Math.round(0.07 * sampleRate);
  for (let i = 0; i < tick; i++) {
    const t = i / sampleRate;
    const env = (t < 0.008 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.008) : 1) * Math.exp(-t / 0.016) * (1 - (i / tick) * (i / tick));
    const y = noise[i] * (1 - r) + a1 * y1 + a2 * y2;
    y2 = y1;
    y1 = y;
    out[pad + i] += 0.5 * y * env;
  }
  // One or two "gloops": bubbles of 3.6–11 mm, starting just after the splash.
  const gloops = 1 + rng.int(2);
  for (let g = 0; g < gloops; g++) {
    const f = 300 + 600 * rng.float();
    const at = pad + Math.round((0.01 + 0.05 * rng.float()) * sampleRate);
    const len = Math.min(body - (at - pad), Math.round(0.12 * sampleRate));
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      phase += (2 * Math.PI * f * (1 + 0.15 * Math.min(1, t / 0.04))) / sampleRate;
      const u = i / (len - 1);
      const env = (t < 0.004 ? t / 0.004 : 1) * Math.exp(-t / 0.03) * (1 - u * u);
      out[at + i] += 0.35 * Math.sin(phase) * env;
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.5 / peak;
  return out;
}

/** Seconds the grain loop lasts. */
export const VELVET_S = 4.1;
/** The grain's roughness lives under this, Hz. */
const GRAIN_HZ = 90;

/**
 * Grain: a rough, never-still gain between about 0.36 and 1, moving at up to 90 times a second. It is never heard
 * itself: noise is multiplied by it, so the noise comes in knocks and not as a smooth hiss — stones dragged down a
 * beach. Its shape repeats every 4.1 s; the noise it lets through never does. A seamless loop.
 *
 * (The recipe's "velvet" is single-sample impulses, 1500 a second. Those are clicks by construction: the checker
 * counts them, and so would an ear on a quiet shore. A sum of short bumps was tried too and still read as clicks.
 * This keeps the roughness and has no edge in it.)
 */
export function velvet(sampleRate: number, rng: Rng): Float32Array {
  const n = Math.round(VELVET_S * sampleRate);
  const x = gaussianInto(new Float32Array(n), rng);
  // Two one-pole low-passes, run round the loop twice so it joins itself.
  const k = 1 - Math.exp((-2 * Math.PI * GRAIN_HZ) / sampleRate);
  let a = 0, b = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      a += k * (x[i] - a);
      b += k * (a - b);
      if (pass === 1) x[i] = b;
    }
  }
  let s2 = 0;
  for (let i = 0; i < n; i++) s2 += x[i] * x[i];
  const sd = Math.sqrt(s2 / n);
  // Mostly low, with knocks: the upper tail of the noise is what opens it.
  for (let i = 0; i < n; i++) {
    const z = x[i] / sd;
    const open = 1 / (1 + Math.exp(-1.6 * (z - 0.3)));
    x[i] = 0.36 + 0.64 * open;
  }
  return x;
}
