// Waves and laps on the picture's clock (design §5.1). This restates live/water.ts's phase arithmetic
// (`ph = wave + bend`, `ph2 = ph + 128`, set index `(ph2 >> 8) + 4`) in continuous time: with β = bend / 256, train j
// and whole number k, the wave's picture event (foam on the sand, the burst on the rock) falls at
//
//   anchor = (k − β − j/2 + ua) · 5.2 + 0.010        ua = 0.5 beach, 0.4 rock and shingle
//
// and its sound starts `lead` earlier, where its envelope begins. `cue.t` is that start, so a wave is always found
// before its envelope must begin. Pure; no state.

import { hash2 } from "../../core/hash.ts";
import { SET, SETS, WAVE_PERIOD } from "../../live/water.ts";
import type { Cue } from "../types.ts";

/** Shore kinds, as ShorePoint.kind. */
export const CALM = 0, BEACH = 1, SHINGLE = 2, ROCK = 3;

/** water.ts steps its clock 256 times a period (20 ms); this centres the sound on a step. */
const STEP_CENTRE = 0.01;

/** Where in the wave (0 … 1) the picture's event falls, by kind. */
export function anchorU(kind: number): number {
  return kind === BEACH ? 0.5 : 0.4;
}

/** Seconds from a wave's first sound to its picture event, and how long its envelope runs, by kind. */
export function leadOf(kind: number): number {
  return kind === BEACH ? 1.56 : 0.52;
}

export function lastsOf(kind: number): number {
  return kind === BEACH ? 4.0 : 3.64;
}

export interface WavePoint {
  cell: number;
  kind: number;
  /** 0 … 255: the byte water.ts reads there. */
  bend: number;
}

/** Every wave of both trains at `point` whose sound starts in [t0, t1), in time order. */
export function waveCues(point: WavePoint, t0: number, t1: number, out: Cue[]): void {
  const beta = point.bend / 256;
  const ua = anchorU(point.kind), lead = leadOf(point.kind), lasts = lastsOf(point.kind);
  const first = out.length;
  for (let j = 0; j < 2; j++) {
    const shift = -beta - j / 2 + ua;
    const k0 = Math.ceil((t0 + lead - STEP_CENTRE) / WAVE_PERIOD - shift - 1e-9) - 1;
    for (let k = k0; ; k++) {
      const anchor = (k + shift) * WAVE_PERIOD + STEP_CENTRE;
      const t = anchor - lead;
      if (t >= t1) break;
      if (t < t0) continue;
      // The picture does not draw waves before the page's clock starts.
      if (k < 0) continue;
      out.push({ t, anchor, kind: "wave", key: `${point.cell}:${k}:${j}`, lasts, cell: point.cell, train: j, k, strength: SET[(k + 4 * j) % SETS], variant: point.kind });
    }
  }
  if (out.length - first > 1) {
    const added = out.splice(first);
    added.sort((a, b) => a.t - b.t);
    for (const c of added) out.push(c);
  }
}

const unit = (h: number) => h / 4294967296;
/** Laps come in half-second slots. */
export const LAP_SLOT = 0.5;
export const LAP_VARIANTS = 4;

/**
 * Laps at a calm shore cell: each half-second slot holds one with probability 0.5 (0.85 within a quarter second of
 * the wave clock's u = 0, where the glint is drawn), at a hashed moment, with a hashed variant and rate (±20 %).
 */
export function lapCues(seed: number, cell: number, bend: number, t0: number, t1: number, out: Cue[]): void {
  const beta = bend / 256;
  for (let s = Math.max(0, Math.floor(t0 / LAP_SLOT) - 1); s * LAP_SLOT < t1; s++) {
    const h = hash2(s, cell, seed ^ 0x1a95);
    const t = (s + unit(hash2(s, cell, seed ^ 0x77c1))) * LAP_SLOT;
    if (t < t0 || t >= t1) continue;
    const p = t / WAVE_PERIOD + beta;
    const u = p - Math.floor(p);
    const nearZero = Math.min(u, 1 - u) * WAVE_PERIOD <= 0.25;
    if (unit(h) >= (nearZero ? 0.85 : 0.5)) continue;
    out.push({
      t, kind: "lap", key: `${cell}:${s}`, lasts: 0.3, cell,
      variant: hash2(s, cell, seed ^ 0x3c11) % LAP_VARIANTS,
      rate: 0.8 + 0.4 * unit(hash2(s, cell, seed ^ 0x5e2b)),
      db: -1.5 + 3 * unit(hash2(s, cell, seed ^ 0x09d3)),
    });
  }
}
