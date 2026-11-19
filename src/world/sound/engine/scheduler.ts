// The scheduler (design §6.4): each frame it asks every live schedule for the cues that start in [until, t +
// lookahead) and hands the engine those it has not started. Cues are start-timed, so no sound needs more lead than
// the lookahead. A ledger of what has been started, keyed by kind and cue key, is what makes a stall, an unlock or a
// return from hidden safe: nothing in the ledger is started twice, and after the ledger is cleared every long sound
// that should still be sounding is found again, once, and joined in progress.
//
// No Web Audio here: the engine turns a Due into sources.

import type { Cue } from "../types.ts";

/** A frame longer than this, seconds, is a stall: cues whose start has passed are dropped, long sounds rejoin. */
export const STALL = 0.25;
/** A long sound is rejoined only when at least this much of it is left, seconds. */
const WORTH = 0.08;

export interface CueSource {
  kind: string;
  cues(t0: number, t1: number, out: Cue[]): void;
  /** How far back to look, after a gap, for sounds of this kind still going (its longest `lasts`); 0 for short sounds. */
  lookBack: number;
}

export interface Due {
  cue: Cue;
  /** True when the cue is a long sound found after a gap: it is joined in progress, not started from its top. */
  rejoin: boolean;
}

export interface Ledger {
  has(key: string): boolean;
  /** Notes `key` as started; it is forgotten once world time passes `until`. */
  add(key: string, until: number): void;
  prune(t: number): void;
  clear(): void;
  readonly size: number;
}

/** World seconds between ledger prunes. Keys are unique to their event, so one kept a little past its time is harmless. */
const PRUNE_EVERY = 0.5;

export function createLedger(): Ledger {
  const m = new Map<string, number>();
  let pruneAt = -Infinity;
  return {
    has: (key) => m.has(key),
    add(key, until) {
      m.set(key, until);
    },
    prune(t) {
      if (t < pruneAt && t >= pruneAt - PRUNE_EVERY) return;
      pruneAt = t + PRUNE_EVERY;
      for (const [key, until] of m) if (until < t) m.delete(key);
    },
    clear() {
      m.clear();
      pruneAt = -Infinity;
    },
    get size() {
      return m.size;
    },
  };
}

export interface Scheduler {
  /**
   * One pass at world time `t`, `dt` after the last frame: appends to `due` every cue to start now. Call every frame
   * while sound is running.
   */
  pass(t: number, dt: number, lookahead: number, due: Due[]): void;
  /** Everything that was started has been stopped (a mute, a hide): forget it, and rejoin on the next pass. */
  clear(): void;
  readonly ledger: Ledger;
}

export function createScheduler(sources: readonly CueSource[]): Scheduler {
  const ledger = createLedger();
  const scratch: Cue[] = [];
  /** Sources that have had a pass. One that joins later (its buffers arrived) is treated as after a gap, for itself alone. */
  const known = new Set<CueSource>();
  let until = NaN;
  let gap = true;

  const take = (kind: string, cue: Cue, rejoin: boolean, due: Due[]) => {
    const key = `${kind}:${cue.key}`;
    if (ledger.has(key)) return;
    // Remembered a little past its end, so a window that is asked twice cannot start it twice.
    ledger.add(key, cue.t + (cue.lasts ?? 0) + 1);
    due.push({ cue, rejoin });
  };

  return {
    ledger,
    pass(t, dt, lookahead, due) {
      const stalled = dt > STALL;
      const rejoin = gap || stalled || until !== until;
      if (rejoin) until = t;
      gap = false;
      const t1 = t + lookahead;
      for (const src of sources) {
        const fresh = !known.has(src);
        if (fresh) known.add(src);
        if ((rejoin || fresh) && src.lookBack > 0) {
          scratch.length = 0;
          src.cues(t - src.lookBack, t, scratch);
          for (const cue of scratch) if (cue.t + (cue.lasts ?? 0) > t + WORTH) take(src.kind, cue, true, due);
        }
        const from = fresh ? t : until;
        if (t1 > from) {
          scratch.length = 0;
          src.cues(from, t1, scratch);
          for (const cue of scratch) take(src.kind, cue, false, due);
        }
      }
      if (t1 > until) until = t1;
      ledger.prune(t);
    },
    clear() {
      ledger.clear();
      gap = true;
    },
  };
}
