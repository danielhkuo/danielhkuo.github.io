// The abbey's bells on the world's clock (design §5.2). Every 240 s is an hour: a peal of five bells, each entering
// in turn and keeping its own pace so they drift against each other, then a pause, then the hour struck on the
// tenor. Pure; no state: any window of time gives the same strokes, so a ledger can tell which it has started.

import { hash2 } from "../../core/hash.ts";
import { RING_S, TENOR } from "../synth/bells.ts";
import type { Cue } from "../types.ts";

/** Seconds in one of the world's hours. */
export const HOUR_S = 240;
/** Seconds between strokes of each bell in the peal, treble (0) to tenor (4); each × (1 ± 3 %) by seed. */
export const PEAL_PERIODS: readonly number[] = [1.05, 1.22, 1.41, 1.62, 1.9];
/** The peal: the treble enters this long after the top of the hour, each bell 1.5 s after the last, each rings 22 s. */
export const PEAL_AT = 8;
export const PEAL_STAGGER = 1.5;
export const PEAL_RINGS_S = 22;
/** The hour: its first stroke after the top, and the gap between strokes. */
export const HOUR_AT = 40;
export const HOUR_GAP = 2.4;
/** Strokes land within this of their beat, seconds. */
export const JITTER = 0.025;
/** The bell index of the tenor under the hour's hammer (its ring is the tenor's, its strike 5 dB harder). */
export const HAMMER = 5;
/** The longest ring, seconds: how far back to look for rings still sounding. */
export const LONGEST_RING = 10;

const unit = (h: number) => h / 4294967296;

/** What the abbey strikes in hour `H`: the page opens at twelve (the sky is midday). */
export function hourNumber(H: number): number {
  return ((((H + 11) % 12) + 12) % 12) + 1;
}

/** Bell i's own pace for this world, seconds. */
export function pealPeriod(seed: number, i: number): number {
  return PEAL_PERIODS[i] * (1 + 0.03 * (2 * unit(hash2(i, 0x9ea1, seed ^ 0xbe11)) - 1));
}

/** How many strokes bell i makes in a peal. */
export function pealStrokes(seed: number, i: number): number {
  return Math.floor((PEAL_RINGS_S - 2 * JITTER) / pealPeriod(seed, i)) + 1;
}

/** When stroke k of bell i falls in hour H, seconds of world time. */
export function pealTime(seed: number, H: number, i: number, k: number): number {
  const jitter = (2 * unit(hash2(H * 8 + i, k, seed ^ 0x57a0)) - 1) * JITTER;
  return H * HOUR_S + PEAL_AT + PEAL_STAGGER * i + JITTER + k * pealPeriod(seed, i) + jitter;
}

/** The index of the first cue of `list` (in time order) at or after `t`. */
export function firstAtOrAfter(list: readonly Cue[], t: number): number {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** An hour's strokes, made once and kept for that hour and the next few (frames ask for thin windows of them). */
const made = new Map<string, Cue[]>();

/** Every stroke of hour H, in time order: the peal's, and the hour's on the tenor. Pure. */
function hourStrokes(seed: number, H: number): Cue[] {
  const id = `${seed}:${H}`;
  const kept = made.get(id);
  if (kept) return kept;
  const list: Cue[] = [];
  const top = H * HOUR_S;
  for (let i = 0; i < 5; i++) {
    const n = pealStrokes(seed, i);
    for (let k = 0; k < n; k++) {
      // In and out gently: the first two strokes and the last two are down.
      const edge = Math.min(k, n - 1 - k);
      const ringDb = edge === 0 ? -6 : edge === 1 ? -3 : 0;
      list.push({ t: pealTime(seed, H, i, k), kind: "bell", key: `${H}:${i}:${k}`, lasts: RING_S[i], soft: true, H, bell: i, k, take: k & 1, ringDb, strikeDb: k & 1 ? -2 : 2 });
    }
  }
  const count = hourNumber(H);
  for (let j = 0; j < count; j++) {
    list.push({ t: top + HOUR_AT + HOUR_GAP * j, kind: "bell", key: `${H}:${HAMMER}:${j}`, lasts: RING_S[TENOR], soft: true, H, bell: HAMMER, k: j, take: j & 1, ringDb: 0, strikeDb: 5 });
  }
  // A stable sort: strokes at the same moment keep the order they were made in, as a window's own sort would.
  list.sort((a, b) => a.t - b.t);
  if (made.size >= 4) made.delete(made.keys().next().value as string);
  made.set(id, list);
  return list;
}

/** Every stroke that starts in [t0, t1), in time order: the peal's, and the hour's on the tenor. */
export function bellCues(seed: number, t0: number, t1: number, out: Cue[]): void {
  const first = out.length;
  for (let H = Math.max(0, Math.floor(t0 / HOUR_S)); H * HOUR_S < t1; H++) {
    const list = hourStrokes(seed, H);
    for (let i = firstAtOrAfter(list, t0); i < list.length && list[i].t < t1; i++) out.push(list[i]);
  }
  if (out.length - first > 1) {
    const added = out.splice(first);
    added.sort((a, b) => a.t - b.t);
    for (const c of added) out.push(c);
  }
}

/** 1 while the abbey is ringing (from 150 ms before the peal's first stroke to 2.5 s after the hour's last), else 0. */
export function bellDuck(t: number): number {
  if (!(t >= 0)) return 0;
  const H = Math.floor(t / HOUR_S), top = H * HOUR_S;
  return t >= top + PEAL_AT - 0.15 && t < top + HOUR_AT + HOUR_GAP * (hourNumber(H) - 1) + 2.5 ? 1 : 0;
}
