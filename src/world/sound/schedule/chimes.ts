// The town clock's procession, as cues (design §5.4). Seconds into the procession (`clockWindow`): the whirr winds
// up at 0; the doors open at 0.30; each figure steps out with a clack at `figureOut(i)`, the first on the tune's
// first note; the hour is counted on the low E from 23.2 s; the ratchet runs only where no chime sounds; the doors
// close at 34.6. Every cue plays at full level: the picture's fade (`shown`) is not applied to sound. Pure.

import { hash2 } from "../../core/hash.ts";
import { CLOCK_LASTS, CLOCK_LEAD, figureOut, WORLD_HOUR } from "../../live/moments.ts";
import { hourNumber } from "./bells.ts";
import { tuneNotes } from "./tune.ts";
import type { Cue } from "../types.ts";

/** What a clock cue is (its `variant`). */
export const CHIME = 0, CLACK = 1, THUD = 2, RATCHET = 3, WHIRR = 4;
export const DOORS_OPEN = 0.3, DOORS_CLOSE = 34.6;
export const COUNT_AT = 23.2, COUNT_GAP = 0.9;
export const WHIRR_END = 35, WHIRR_DOWN = 33.5;
/** The low E's bar (index into the chime bars): the hour is counted on it. */
const LOW_E = 0;

const unit = (h: number) => h / 4294967296;
const NOTES = tuneNotes();

/** The procession under way at world time t, or the next to begin: when it starts, and which hour it tells. */
export function procession(t: number, forced: boolean): { start: number; hour: number } {
  if (forced) {
    const m = Math.floor((t + CLOCK_LEAD) / CLOCK_LASTS);
    return { start: m * CLOCK_LASTS - CLOCK_LEAD, hour: m };
  }
  const H = Math.floor(t / WORLD_HOUR);
  return { start: H * WORLD_HOUR, hour: H };
}

/** Every cue of the clock that starts in [t0, t1), in time order. */
export function clockCues(seed: number, forced: boolean, t0: number, t1: number, out: Cue[]): void {
  const first = out.length;
  const every = forced ? CLOCK_LASTS : WORLD_HOUR;
  for (let p = procession(Math.max(0, t0), forced); p.start < t1; p = { start: p.start + every, hour: p.hour + 1 }) {
    const S = p.start;
    if (S + CLOCK_LASTS <= t0) continue;
    const push = (at: number, variant: number, k: number, db: number, lasts: number, tag: string, soft = false) => {
      const t = S + at;
      if (t < t0 || t >= t1 || t < 0) return;
      out.push({ t, kind: "clock", key: `${p.hour}:${tag}`, variant, k, db, lasts, soft });
    };
    push(0, WHIRR, 0, 0, WHIRR_END, "whirr", true);
    // The doors: two clacks 60 ms apart and a thud; the same to close.
    for (const [at, tag] of [[DOORS_OPEN, "open"], [DOORS_CLOSE, "close"]] as const) {
      push(at, CLACK, 5, -2, 0.2, `${tag}:a`);
      push(at + 0.06, CLACK, 5, -4, 0.2, `${tag}:b`);
      push(at + 0.03, THUD, 0, 0, 0.25, `${tag}:thud`);
    }
    push(DOORS_OPEN, RATCHET, 0, 0, figureOut(0) - 0.03 - DOORS_OPEN, "ratchet:a", true);
    for (let i = 0; i < 5; i++) push(figureOut(i), CLACK, i, 0, 0.2, `figure:${i}`);
    // The tune: its first note with the first figure. Each note a touch early or late (±12 ms) and louder or softer (±1.5 dB).
    for (let k = 0; k < NOTES.length; k++) {
      const nt = NOTES[k];
      const h = hash2(p.hour, k, seed ^ 0x7e11);
      const late = (2 * unit(h) - 1) * 0.012, db = (2 * unit(hash2(k, p.hour, seed ^ 0x7e12)) - 1) * 1.5;
      push(figureOut(0) + nt.at + late, CHIME, nt.bar, db + (nt.low ? -4 : 0), 2, `note:${k}`);
    }
    // The hour, counted on the low E.
    const count = hourNumber(p.hour);
    for (let j = 0; j < count; j++) push(COUNT_AT + COUNT_GAP * j, CHIME, LOW_E, 1, 4.5, `count:${j}`);
    const after = COUNT_AT + COUNT_GAP * (count - 1) + 0.6;
    if (after < WHIRR_DOWN - 0.2) push(after, RATCHET, 0, 0, WHIRR_DOWN - after, "ratchet:b", true);
  }
  if (out.length - first > 1) {
    const added = out.splice(first);
    added.sort((a, b) => a.t - b.t);
    for (const c of added) out.push(c);
  }
}
