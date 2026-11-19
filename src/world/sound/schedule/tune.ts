// The town clock's tune (design §4.8): original, written by hand for this world. E Dorian, 6/8, thirteen bars; one
// bar is a third of the time between one figure stepping out and the next, so each figure enters on the first beat
// of a phrase and the fifth on the last note. Durations in quavers. Pure.

import { figureOut } from "../../live/moments.ts";
import { CHIME_NAMES, type ChimeName } from "../synth/chimes.ts";

/** Each bar: its melody (bar by bar, six quavers each) and the low chime on its first beat. */
export const TUNE: readonly { melody: readonly (readonly [ChimeName, number])[]; low: readonly ChimeName[] }[] = [
  { melody: [["E6", 2], ["D6", 1], ["B5", 2], ["C#6", 1]], low: ["E4"] },
  { melody: [["D6", 2], ["B5", 1], ["A5", 3]], low: ["E4"] },
  { melody: [["G5", 2], ["A5", 1], ["B5", 3]], low: ["B4"] },
  { melody: [["B5", 2], ["A5", 1], ["G5", 2], ["E5", 1]], low: ["E4"] },
  { melody: [["C#6", 3], ["B5", 2], ["A5", 1]], low: ["E4"] },
  { melody: [["F#5", 2], ["G5", 1], ["A5", 3]], low: ["B4"] },
  { melody: [["E6", 2], ["F#6", 1], ["E6", 2], ["D6", 1]], low: ["E4"] },
  { melody: [["C#6", 2], ["B5", 1], ["A5", 2], ["B5", 1]], low: ["E4"] },
  { melody: [["G5", 2], ["A5", 1], ["F#5", 3]], low: ["B4"] },
  { melody: [["B5", 2], ["C#6", 1], ["D6", 2], ["B5", 1]], low: ["E4"] },
  { melody: [["A5", 2], ["G5", 1], ["F#5", 2], ["G5", 1]], low: ["E4"] },
  { melody: [["F#5", 3], ["G5", 2], ["F#5", 1]], low: ["B4"] },
  { melody: [["E5", 6]], low: ["E4", "B4"] },
];

/** Seconds a bar lasts: three bars from one figure to the next. */
export const BAR_S = (figureOut(1) - figureOut(0)) / 3;
export const QUAVER_S = BAR_S / 6;

export interface TuneNote {
  /** Seconds after the tune's first note. */
  at: number;
  /** Which chime bar (index into CHIME_NAMES). */
  bar: number;
  low: boolean;
  /** Its place in the tune: the bar it is in (0 …) and its number among the melody's notes (−1 for a low chime). */
  measure: number;
  index: number;
}

/** Every note of the tune, in time order (a bar's low chime before its melody note). */
export function tuneNotes(): TuneNote[] {
  const out: TuneNote[] = [];
  let index = 0;
  TUNE.forEach((bar, m) => {
    for (const low of bar.low) out.push({ at: m * BAR_S, bar: CHIME_NAMES.indexOf(low), low: true, measure: m, index: -1 });
    let q = 0;
    for (const [name, quavers] of bar.melody) {
      out.push({ at: m * BAR_S + q * QUAVER_S, bar: CHIME_NAMES.indexOf(name), low: false, measure: m, index: index++ });
      q += quavers;
    }
  });
  return out;
}

/** The melody as semitones above E4, in order. */
export function melodySemitones(): number[] {
  const semis = [0, 7, 12, 14, 15, 17, 19, 21, 22, 24, 26];
  return tuneNotes().filter((n) => !n.low).map((n) => semis[n.bar]);
}

/** The melody's contour (Parsons code): * then U, D or R for each note against the one before. */
export function parsons(semitones: readonly number[]): string {
  let s = "*";
  for (let i = 1; i < semitones.length; i++) s += semitones[i] > semitones[i - 1] ? "U" : semitones[i] < semitones[i - 1] ? "D" : "R";
  return s;
}
