// The first-flight lesson: steering, then speed, then how to leave, each shown by the dragon until it is learned or
// has shown long enough, then faded. Pure: the page steps it each frame and stores it once it is done.

import type { Held } from "./bindings.ts";

export type Stage = "wait" | "steer" | "speed" | "leave" | "done";

export interface Lesson {
  stage: Stage;
  /** Seconds the stage has shown. */
  t: number;
  /** Seconds since the stage was learned, as it fades; null while it is still being taught. */
  out: number | null;
  /** Seconds each was held while the stage showed. */
  left: number;
  right: number;
  boost: number;
  slow: number;
}

/** The lesson waits this long after the first full view. */
export const WAIT = 1;
/** Steering is learned once each way has been held this long, seconds. */
export const STEER_HOLD = 0.35;
/** Speed is learned once boost and slow have each been held this long. */
export const SPEED_HOLD = 0.6;
/** How long "leave" shows. */
export const LEAVE_SHOW = 4;
/** A stage that has shown this long goes, learned or not: nobody is nagged. */
export const TIMEOUT = 20;
/** Seconds a stage takes to fade in and to fade out. */
export const FADE_IN = 0.4;
export const FADE_OUT = 0.5;

export const LESSON_KEY = "world:lesson";

const NEXT: Record<Stage, Stage> = { wait: "steer", steer: "speed", speed: "leave", leave: "done", done: "done" };

function fresh(stage: Stage): Lesson {
  return { stage, t: 0, out: null, left: 0, right: 0, boost: 0, slow: 0 };
}

/** A lesson from the start, or one already done. */
export function newLesson(learned: boolean): Lesson {
  return fresh(learned ? "done" : "wait");
}

function learned(l: Lesson): boolean {
  if (l.stage === "wait") return l.t >= WAIT;
  if (l.t >= TIMEOUT) return true;
  if (l.stage === "steer") return l.left >= STEER_HOLD && l.right >= STEER_HOLD;
  if (l.stage === "speed") return l.boost >= SPEED_HOLD && l.slow >= SPEED_HOLD;
  if (l.stage === "leave") return l.t >= LEAVE_SHOW;
  return false;
}

/**
 * Moves the lesson on by dt seconds with `held` down. It stands still while it is not `shown` (a prompt has the place
 * by the dragon, or the device cannot be taught). A learned stage fades out over FADE_OUT (at once under `reduced`
 * motion), then the next begins.
 */
export function stepLesson(l: Lesson, dt: number, held: Held, shown: boolean, reduced = false): Lesson {
  if (l.stage === "done" || !shown || dt <= 0) return l;
  if (l.out !== null) {
    const out = l.out + dt;
    return out >= (reduced ? 0 : FADE_OUT) ? fresh(NEXT[l.stage]) : { ...l, out };
  }
  const next: Lesson = {
    ...l,
    t: l.t + dt,
    left: l.left + (held.left ? dt : 0),
    right: l.right + (held.right ? dt : 0),
    boost: l.boost + (held.boost ? dt : 0),
    slow: l.slow + (held.slow ? dt : 0),
  };
  if (!learned(next)) return next;
  // Waiting has nothing to fade.
  if (next.stage === "wait" || reduced) return fresh(NEXT[next.stage]);
  return { ...next, out: 0 };
}

/** How strongly the stage shows: fading in, full, then fading out; on or off under `reduced` motion. */
export function lessonAlpha(l: Lesson, reduced = false): number {
  if (l.stage === "wait" || l.stage === "done") return 0;
  if (reduced) return l.out === null ? 1 : 0;
  if (l.out !== null) return Math.max(0, 1 - l.out / FADE_OUT);
  return Math.min(1, l.t / FADE_IN);
}
