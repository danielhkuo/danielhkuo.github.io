// The wonders' moments, as cues (design §5.5): the sounds that fall at moments, timed from the position functions
// live/moments.ts exports (the picture draws from the same ones), never from a restatement. The continuous parts
// (an engine's note, a wash) are not cues: each voice shapes those from `at` and `lasts`. Pure.

import { ringDelta } from "../../live/art.ts";
import { momentSpan, momentWindow, PLANE_DOWN, PLANE_MOORED } from "../../live/moments.ts";
import type { Cue } from "../types.ts";

/** The appearance of `kind` under way at world time t: when it began and how long it lasts; null between appearances. */
export function appearance(seed: number, kind: string, t: number, forced: boolean): { start: number; lasts: number } | null {
  const at = momentWindow(seed, kind, t, forced);
  if (at < 0) return null;
  return { start: t - at, lasts: momentSpan(seed, kind).lasts };
}

/** Every appearance of `kind` that overlaps [t0, t1): its start. */
function eachAppearance(seed: number, kind: string, forced: boolean, t0: number, t1: number, each: (start: number, lasts: number) => void): void {
  const lasts = momentSpan(seed, kind).lasts;
  let last = NaN;
  // An appearance is at least 20 s long: asked every 10 s (and at both ends), none is missed.
  for (let t = Math.max(0, t0); ; t += 10) {
    const at = Math.min(t, t1 - 1e-6);
    const a = appearance(seed, kind, at, forced);
    if (a && (last !== last || Math.abs(a.start - last) > 1e-6)) {
      last = a.start;
      each(a.start, lasts);
    }
    if (t >= t1) break;
  }
}

// ── The train ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a train cue is (its `variant`). */
export const CHUFF = 0, CLICK = 1, WHISTLE_LONG = 2, WHISTLE_SHORT = 3, SWELL = 4;
/** A wheel turn is 12 cells, and gives four chuffs: one every 3 cells run. */
export const CHUFF_CELLS = 3;
/** A rail is 14 cells long; a bogie's two axles are 1.6 cells apart; the carriage's bogie rides 8 cells behind the engine's. */
export const RAIL_CELLS = 14, AXLE_CELLS = 1.6;
/** The four beats of a wheel turn: their levels, dB; the third is 4 % of a beat late. */
export const BEAT_DB: readonly number[] = [0, -2.5, -1, -3.5];

/** How far the train runs on each leg (cells) and its speed (cells a second): shore to halt in half its appearance. */
export function trainRun(shore: readonly [number, number], halt: readonly [number, number], n: number, lasts: number): { cells: number; v: number } {
  const dx = ringDelta(shore[0], halt[0], n), dy = ringDelta(shore[1], halt[1], n);
  const cells = Math.sqrt(dx * dx + dy * dy);
  return { cells, v: cells / (lasts / 2) };
}

/**
 * Every cue of the train that starts in [t0, t1): its chuffs (one for every 3 cells it has run on a leg), its wheel
 * clicks (a pair for each rail, engine and carriage), its whistles and the steam swell at the turn.
 */
export function trainCues(seed: number, shore: readonly [number, number], halt: readonly [number, number], n: number, forced: boolean, t0: number, t1: number, out: Cue[]): void {
  const first = out.length;
  eachAppearance(seed, "train", forced, t0, t1, (S, lasts) => {
    const { cells, v } = trainRun(shore, halt, n, lasts);
    if (!(v > 0.5)) return;
    const half = lasts / 2;
    const push = (at: number, variant: number, k: number, db: number, cueLasts: number, tag: string, train = 0) => {
      const t = S + at;
      if (t < t0 || t >= t1) return;
      out.push({ t, kind: "train", key: `${Math.round(S * 10)}:${tag}`, variant, k, db, lasts: cueLasts, train, anchor: S });
    };
    const beat = CHUFF_CELLS / v;
    for (let leg = 0; leg < 2; leg++) {
      const legAt = leg * half;
      for (let k = 1; k * CHUFF_CELLS < cells; k++) {
        const b = k & 3;
        const at = legAt + (k * CHUFF_CELLS) / v + (b === 2 ? 0.04 * beat : 0);
        // Hard as it pulls away (the first four of each leg); easing off over the last two seconds into the halt.
        let db = BEAT_DB[b] + (k <= 4 ? 4 : 0);
        if (leg === 0 && at > half - 2) db -= 8 * ((at - (half - 2)) / 2);
        push(at, CHUFF, b, db, 0.25, `chuff:${leg}:${k}`);
      }
      // Wheels on the rail joints: each vehicle's bogie, two clicks a joint.
      for (let car = 0; car < 2; car++) {
        for (let j = 1; ; j++) {
          const run = j * RAIL_CELLS + car * 8;
          if (run + AXLE_CELLS >= cells) break;
          push(legAt + run / v, CLICK, j & 3, car ? -3 : 0, 0.08, `click:${leg}:${car}:${j}:a`, car);
          push(legAt + (run + AXLE_CELLS) / v, CLICK, (j + 1) & 3, car ? -4 : -1, 0.08, `click:${leg}:${car}:${j}:b`, car);
        }
      }
    }
    push(1.0, WHISTLE_LONG, 0, 0, 1.3, "whistle:0");
    push(half - 2.2, WHISTLE_SHORT, 0, -1, 0.4, "whistle:1");
    push(half - 1.7, WHISTLE_SHORT, 0, 0, 0.4, "whistle:2");
    push(half + 0.8, WHISTLE_LONG, 0, 0, 1.3, "whistle:3");
    push(half - 0.3, SWELL, 0, 0, 0.7, "swell");
  });
  if (out.length - first > 1) {
    const added = out.splice(first);
    added.sort((a, b) => a.t - b.t);
    for (const c of added) out.push(c);
  }
}

// ── The seaplane ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const SPLASH = 0, POP = 1;
/** After it moors, the engine runs down over this long, and its last pops come this long after that. */
export const PLANE_RUNDOWN = 2.5;
export const PLANE_POPS: readonly number[] = [0.35, 0.8, 1.5];

/** Every cue of the seaplane that starts in [t0, t1): two splashes as its floats touch and skip, three last pops of its engine. */
export function planeCues(seed: number, forced: boolean, t0: number, t1: number, out: Cue[]): void {
  eachAppearance(seed, "plane", forced, t0, t1, (S, lasts) => {
    const push = (at: number, variant: number, k: number, db: number, cueLasts: number, tag: string) => {
      const t = S + at;
      if (t < t0 || t >= t1) return;
      out.push({ t, kind: "plane", key: `${Math.round(S * 10)}:${tag}`, variant, k, db, lasts: cueLasts, anchor: S });
    };
    push(PLANE_DOWN * lasts, SPLASH, 0, 0, 2, "splash:0");
    push(PLANE_DOWN * lasts + 0.5, SPLASH, 1, -3, 2, "splash:1");
    PLANE_POPS.forEach((dt, i) => push(PLANE_MOORED * lasts + PLANE_RUNDOWN + dt, POP, i, -2 * i, 0.2, `pop:${i}`));
  });
}

/** The seaplane's engine speed (rpm) `at` seconds into an appearance of `lasts`; 0 once it has stopped. */
export function planeRpm(at: number, lasts: number): number {
  const p = at / lasts;
  if (p < PLANE_DOWN) {
    const u = p / PLANE_DOWN;
    return 1900 + (1400 - 1900) * u * u * (3 - 2 * u);
  }
  const down = PLANE_MOORED * lasts;
  if (at < down) {
    // Throttled back as the floats take the water (over 0.6 s), then a taxi at 850.
    const u = Math.min(1, (at - PLANE_DOWN * lasts) / 0.6);
    return 1400 + (850 - 1400) * u;
  }
  if (at < down + PLANE_RUNDOWN) return 850 + (300 - 850) * ((at - down) / PLANE_RUNDOWN);
  return 0;
}
