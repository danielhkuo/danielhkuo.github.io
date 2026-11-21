// The bench's stand-in schedule, until surf and bells exist: a pip about every 0.75 s (a sharp one-shot) and a
// three-second tail every 4 s (a long sound that rejoins in progress). Pure, like every schedule: `cues(t0, t1, out)`
// appends every cue with t0 ≤ cue.t < t1 in time order, and `cue.t` is when the sound starts.

import { hash2 } from "../../core/hash.ts";
import { TAIL_S } from "../synth/probe.ts";
import type { Cue } from "../types.ts";

export const PIP_EVERY = 0.75;
export const TAIL_EVERY = 4;
/** The tail of each four seconds starts this far into them. */
export const TAIL_AT = 1;

const unit = (h: number) => h / 4294967296;

export function pipCues(seed: number, t0: number, t1: number, out: Cue[]): void {
  // A pip's time is its slot's start plus up to 0.2 s, so slots k−1 … k cover any window.
  for (let k = Math.floor(t0 / PIP_EVERY) - 1; k * PIP_EVERY < t1; k++) {
    const t = k * PIP_EVERY + 0.2 * unit(hash2(k, 1, seed));
    if (t < t0 || t >= t1) continue;
    out.push({ t, kind: "pip", key: String(k), lasts: 0.12, db: -1.5 + 3 * unit(hash2(k, 2, seed)), rate: 0.97 + 0.06 * unit(hash2(k, 3, seed)) });
  }
}

export function tailCues(t0: number, t1: number, out: Cue[]): void {
  for (let k = Math.floor((t0 - TAIL_AT) / TAIL_EVERY); k * TAIL_EVERY + TAIL_AT < t1; k++) {
    const t = k * TAIL_EVERY + TAIL_AT;
    if (t < t0) continue;
    out.push({ t, kind: "tail", key: String(k), lasts: TAIL_S, soft: true });
  }
}
