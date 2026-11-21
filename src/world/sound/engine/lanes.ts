// Lanes: where the next waves are played, and when (design §4.3). The pure part of the surf: no Web Audio here.
//
// A lane is one of the heaviest sectors of shore round the dragon (four on desktop, two on touch). Lanes decide only
// which waves are started; each wave then belongs to an emitter fixed at the place it broke, for the whole of its
// envelope. Changing lanes cuts nothing.
//
// A wave cue is played when its (cell, k, train) is not in the ledger, its lane has not started a wave of that train
// in the last 2.6 s, its lane has fewer than two waves sounding, and an emitter is free. After a gap (a mute, a hide,
// a stall) the waves whose envelopes should still be sounding are found again and joined in progress.

import { hash2 } from "../../core/hash.ts";
import { CALM, lapCues, lastsOf, waveCues } from "../schedule/waves.ts";
import type { Cue, Hearing, ShorePoint } from "../types.ts";

/** A lane starts no two waves of one train closer than this, seconds: half a period, so a lane keeps the picture's pace. */
export const TRAIN_GAP = 2.6;
/** A sector takes a lane when its weight has beaten the weakest lane's by this factor (3 dB) for this long, seconds. */
const BEAT = 2;
const BEAT_FOR = 0.5;
/** A lane whose sector has had no shore for this long, seconds, is let go. */
const IDLE_FOR = 1;
/** A wave is joined in progress only when at least this much of it is left, seconds. */
const WORTH = 0.4;
/** The longest envelope, seconds: how far back to look after a gap. */
const LONGEST = 4;
const STALL = 0.25;

export interface WaveStart {
  cue: Cue;
  /** 1 beach, 2 shingle, 3 rock. */
  kind: number;
  strength: number;
  /** Where it breaks: fixed for the wave's life. */
  x: number;
  y: number;
  emitter: number;
  lane: number;
  /** Seconds into its envelope to start at: 0 from the top, more when joined in progress. */
  offset: number;
  /** This wave's own level, dB (±1.5 by hash of cell, k and train). */
  db: number;
}

export interface LapStart {
  cue: Cue;
  x: number;
  y: number;
  /** Level, dB: a lull's lap is 20 dB down. */
  db: number;
}

export interface EmitterState {
  /** World time its wave's envelope ends; −∞ when free. */
  until: number;
  x: number;
  y: number;
  kind: number;
  lane: number;
  /** Its wave's level, dB. */
  db: number;
}

export interface Lanes {
  /**
   * One frame at world time t: appends the waves and laps to start. `lookahead` is how far ahead cues are found.
   * Call every frame while sound is running.
   */
  step(hearing: Hearing, t: number, dt: number, lookahead: number, waves: WaveStart[], laps: LapStart[]): void;
  /** The sectors that hold a lane, as bits: handed to the ear, which leaves their near surf to the emitters. */
  mask(): number;
  /** Everything started has been stopped (a mute, a hide): forget it, and rejoin on the next step. */
  clear(): void;
  readonly emitters: readonly EmitterState[];
  /** Waves started so far, by lane. */
  readonly started: readonly number[];
}

const unit = (h: number) => h / 4294967296;

export function createLanes(opts: { lanes: number; emitters: number; seed: number }): Lanes {
  const sector = new Int8Array(opts.lanes).fill(-1);
  /** World time each lane last started a wave of each train. */
  const lastStart = new Float64Array(opts.lanes * 2).fill(-Infinity);
  const idleSince = new Float64Array(opts.lanes).fill(NaN);
  const started = new Array<number>(opts.lanes).fill(0);
  const emitters: EmitterState[] = Array.from({ length: opts.emitters }, () => ({ until: -Infinity, x: 0, y: 0, kind: 0, lane: -1, db: 0 }));
  const weight = new Float64Array(8);
  /** Since when each sector has been beating the weakest lane; NaN when it is not. */
  const beating = new Float64Array(8).fill(NaN);
  const ledger = new Map<string, number>();
  const scratch: Cue[] = [];
  let until = NaN;
  let gap = true;

  const laneOf = (s: number): number => {
    for (let l = 0; l < sector.length; l++) if (sector[l] === s) return l;
    return -1;
  };

  const choose = (hearing: Hearing, t: number): void => {
    weight.fill(0);
    for (const p of hearing.shores) weight[p.sector] += p.w;
    // Let go of lanes whose shore has gone.
    for (let l = 0; l < sector.length; l++) {
      if (sector[l] < 0) continue;
      if (weight[sector[l]] > 0) idleSince[l] = NaN;
      else if (idleSince[l] !== idleSince[l]) idleSince[l] = t;
      else if (t - idleSince[l] >= IDLE_FOR) sector[l] = -1;
    }
    // The weakest lane (a free one is weaker than any).
    let weakest = 0, weakestW = Infinity;
    for (let l = 0; l < sector.length; l++) {
      const w = sector[l] < 0 ? -1 : weight[sector[l]];
      if (w < weakestW) {
        weakestW = w;
        weakest = l;
      }
    }
    // The heaviest sector without a lane challenges it.
    let best = -1;
    for (let s = 0; s < 8; s++) {
      if (weight[s] <= 0 || laneOf(s) >= 0) {
        beating[s] = NaN;
        continue;
      }
      const beats = weakestW < 0 || weight[s] > BEAT * weakestW;
      if (!beats) beating[s] = NaN;
      else if (beating[s] !== beating[s]) beating[s] = t;
      if (beats && (best < 0 || weight[s] > weight[best])) best = s;
    }
    if (best >= 0 && (weakestW < 0 ? true : t - beating[best] >= BEAT_FOR)) {
      // A free lane is taken at once; a held one after the challenger has led for half a second.
      sector[weakest] = best;
      idleSince[weakest] = NaN;
      beating[best] = NaN;
    }
  };

  const sounding = (lane: number, at: number): number => {
    let n = 0;
    for (const e of emitters) if (e.lane === lane && e.until > at) n++;
    return n;
  };

  /** Emitters are taken in turn, so every one's own stream of noise is used. */
  let turn = 0;
  const freeEmitter = (at: number): number => {
    for (let k = 0; k < emitters.length; k++) {
      const i = (turn + k) % emitters.length;
      if (emitters[i].until <= at) {
        turn = i + 1;
        return i;
      }
    }
    return -1;
  };

  const take = (p: ShorePoint, lane: number, cue: Cue, t: number, rejoin: boolean, waves: WaveStart[], laps: LapStart[]): void => {
    const key = cue.key;
    if (ledger.has(key)) return;
    const lasts = cue.lasts ?? LONGEST;
    // Whatever becomes of it, it is not looked at again.
    ledger.set(key, cue.t + lasts + 1);
    const strength = cue.strength ?? 0;
    const h = hash2(cue.k ?? 0, (cue.cell ?? 0) ^ ((cue.train ?? 0) * 0x9e37), opts.seed ^ 0x51f7);
    if (strength === 0) {
      // The lull: the water only laps, 20 dB down, as the picture's foam would have touched the sand.
      if (!rejoin) laps.push({ cue: { ...cue, t: cue.anchor ?? cue.t, kind: "lap", variant: h & 3, rate: 0.9 + 0.2 * unit(h), lasts: 0.3 }, x: p.x, y: p.y, db: -20 });
      return;
    }
    const offset = rejoin ? t - cue.t : 0;
    if (offset > lasts - WORTH) return;
    const train = cue.train ?? 0;
    if (cue.t - lastStart[lane * 2 + train] < TRAIN_GAP - 1e-6) return;
    if (sounding(lane, cue.t) >= 2) return;
    // Free now, not merely by the time the wave starts: an emitter's chain is set outright when it is taken.
    const e = freeEmitter(t);
    if (e < 0) return;
    const state = emitters[e];
    state.until = cue.t + lasts;
    state.x = p.x;
    state.y = p.y;
    state.kind = p.kind;
    state.lane = lane;
    state.db = -1.5 + 3 * unit(h);
    lastStart[lane * 2 + train] = cue.t;
    started[lane]++;
    waves.push({ cue, kind: p.kind, strength, x: p.x, y: p.y, emitter: e, lane, offset, db: state.db });
  };

  return {
    emitters,
    started,
    step(hearing, t, dt, lookahead, waves, laps) {
      choose(hearing, t);
      const rejoin = gap || dt > STALL || until !== until;
      if (rejoin) until = t;
      gap = false;
      const t1 = t + lookahead;
      // Laps come from the heaviest calm cell of each of the two heaviest calm lanes: a quay laps a couple of times a
      // second, however much of it is in earshot.
      let calmA = -1, calmB = -1;
      for (let i = 0; i < hearing.shores.length; i++) {
        const p = hearing.shores[i];
        if (p.kind !== CALM || laneOf(p.sector) < 0) continue;
        if (calmA >= 0 && hearing.shores[calmA].sector === p.sector) continue;
        if (calmB >= 0 && hearing.shores[calmB].sector === p.sector) continue;
        if (calmA < 0 || p.w > hearing.shores[calmA].w) {
          calmB = calmA;
          calmA = i;
        } else if (calmB < 0 || p.w > hearing.shores[calmB].w) calmB = i;
      }
      for (let i = 0; i < hearing.shores.length; i++) {
        const p = hearing.shores[i];
        const lane = laneOf(p.sector);
        if (lane < 0) continue;
        if (p.kind === CALM) {
          if (i !== calmA && i !== calmB) continue;
          if (t1 > until) {
            scratch.length = 0;
            lapCues(opts.seed, p.cell, p.bend, until, t1, scratch);
            for (const cue of scratch) {
              if (ledger.has(cue.key)) continue;
              ledger.set(cue.key, cue.t + 2);
              laps.push({ cue, x: p.x, y: p.y, db: cue.db ?? 0 });
            }
          }
          continue;
        }
        if (rejoin) {
          scratch.length = 0;
          waveCues(p, t - lastsOf(p.kind), t, scratch);
          for (let i = 0; i < scratch.length; i++) take(p, lane, scratch[i], t, true, waves, laps);
        }
        if (t1 > until) {
          scratch.length = 0;
          waveCues(p, until, t1, scratch);
          for (let i = 0; i < scratch.length; i++) take(p, lane, scratch[i], t, false, waves, laps);
        }
      }
      if (t1 > until) until = t1;
      if (ledger.size > 64) for (const [key, end] of ledger) if (end < t) ledger.delete(key);
    },
    mask() {
      let m = 0;
      for (let l = 0; l < sector.length; l++) if (sector[l] >= 0) m |= 1 << sector[l];
      return m;
    },
    clear() {
      ledger.clear();
      for (const e of emitters) {
        e.until = -Infinity;
        e.lane = -1;
      }
      lastStart.fill(-Infinity);
      gap = true;
    },
  };
}
