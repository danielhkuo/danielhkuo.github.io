// Phone budgets (spec 8): how many bake workers, and a pacer that holds the frame rate at 60 and steps down to 30
// when frames run long or the browser itself only calls back at about 30 a second (iOS Low Power Mode). No web API
// reports heat on a phone, so frame time is the only signal. Pure: timestamps and work times in, decisions out.

/** Bake workers on a phone: two, or one where Chrome says the phone has 2 GB or less. */
export function phoneWorkers(deviceMemory: number | undefined): number {
  return deviceMemory !== undefined && deviceMemory <= 2 ? 1 : 2;
}

/** The 90th-percentile frame work above which the pacer steps down, ms. */
export const SLOW_WORK = 12;
/** The 90th-percentile frame work under which, for UP_AFTER, the pacer steps back up, ms. */
export const FAST_WORK = 8;
/** Seconds of easy frames before stepping back up. */
export const UP_AFTER = 10;
/** A median callback interval this long means the browser is pacing at about 30 Hz itself, ms. */
const SLOW_CALLBACKS = 26;
/** Frames judged at a time: about two seconds at 60. */
const WINDOW = 120;
/**
 * A frame is drawn when this little short of its interval has passed, ms. Frames stay evenly paced: at the 60 cap a
 * 120 Hz panel draws every other callback (60) and a 90 Hz one every other too (45); at 30, every 2nd, 3rd or 4th.
 */
const EARLY = 4;

function quantile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export interface Pacer {
  /** Called on every animation frame with its timestamp: whether to draw this one. */
  want(t: number): boolean;
  /** The main-thread work the drawn frame took, ms. */
  worked(ms: number): void;
  /** The cap in force. */
  rate(): 60 | 30;
}

export function createPacer(): Pacer {
  let cap: 60 | 30 = 60;
  let lastCall = 0;
  let lastDrawn = 0;
  let easy = 0;
  const calls: number[] = [];
  const work: number[] = [];
  const push = (xs: number[], v: number) => {
    xs.push(v);
    if (xs.length > WINDOW) xs.shift();
  };
  return {
    want(t) {
      if (lastCall) push(calls, t - lastCall);
      lastCall = t;
      const interval = 1000 / cap;
      if (lastDrawn && t - lastDrawn < interval - EARLY) return false;
      const since = lastDrawn ? (t - lastDrawn) / 1000 : 0;
      lastDrawn = t;
      if (work.length < WINDOW / 2) return true;
      const heavy = quantile(work, 0.9);
      if (cap === 60) {
        if (heavy > SLOW_WORK || quantile(calls, 0.5) > SLOW_CALLBACKS) {
          cap = 30;
          easy = 0;
          work.length = 0;
        }
      } else {
        easy = heavy < FAST_WORK && quantile(calls, 0.5) < SLOW_CALLBACKS ? easy + since : 0;
        if (easy >= UP_AFTER) {
          cap = 60;
          easy = 0;
          work.length = 0;
        }
      }
      return true;
    },
    worked(ms) {
      push(work, ms);
    },
    rate() {
      return cap;
    },
  };
}
