// The bench's stand-in one-shots, until surf and bells exist: a short soft "pip" (a sharp one-shot, as a lap or a
// chuff will be) and a three-second ringing "tail" (a long sound that is rejoined in progress, as a bell's ring will
// be). They exercise the scheduler, the ledgers and stop-on-suspend in the toggle, hide-show and stall scenes; the
// game never plays them. Each has its attack and release baked in and 20 ms of digital silence either side (§4).

import type { Rng } from "../../core/rng.ts";
import { gaussianInto } from "./noise.ts";

const PAD = 0.02;

/** 20 ms silence, an 80 ms burst of band noise (4 ms attack, dying away to nothing), 20 ms silence. */
export function pip(sampleRate: number, rng: Rng): Float32Array {
  const pad = Math.round(PAD * sampleRate), body = Math.round(0.08 * sampleRate);
  const x = new Float32Array(pad + body + pad);
  const n = gaussianInto(new Float32Array(body), rng);
  // A two-pole resonator near 1.8 kHz colours the burst.
  const w = (2 * Math.PI * 1800) / sampleRate, r = 0.985;
  const a1 = 2 * r * Math.cos(w), a2 = -r * r;
  let y1 = 0, y2 = 0, peak = 0;
  for (let i = 0; i < body; i++) {
    const t = i / sampleRate;
    const attack = t < 0.004 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.004) : 1;
    // The window reaches exactly zero at the end, so the release needs no fade from outside.
    const u = i / (body - 1);
    const env = attack * Math.exp(-t / 0.018) * (1 - u * u);
    const y = n[i] * (1 - r) + a1 * y1 + a2 * y2;
    y2 = y1;
    y1 = y;
    x[pad + i] = y * env;
    peak = Math.max(peak, Math.abs(x[pad + i]));
  }
  for (let i = 0; i < x.length; i++) x[i] *= 0.5 / peak;
  return x;
}

/** How long the tail lasts, seconds, pads included. */
export const TAIL_S = 3;

/** A soft two-partial ring: 8 ms attack, T60 about 2.5 s, the last half second ramped to zero in the render. */
export function tail(sampleRate: number): Float32Array {
  const n = Math.round(TAIL_S * sampleRate), pad = Math.round(PAD * sampleRate);
  const x = new Float32Array(n);
  const body = n - 2 * pad;
  for (let i = 0; i < body; i++) {
    const t = i / sampleRate;
    const attack = t < 0.008 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.008) : 1;
    const left = (body - i) / sampleRate;
    const out = left < 0.5 ? left / 0.5 : 1;
    const ring = 0.6 * Math.exp(-t / 0.36) * Math.sin(2 * Math.PI * 440 * t) + 0.4 * Math.exp(-t / 0.25) * Math.sin(2 * Math.PI * 663 * t);
    x[pad + i] = 0.5 * ring * attack * out;
  }
  return x;
}
