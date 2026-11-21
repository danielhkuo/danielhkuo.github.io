// Gulls (design §4.7, §4.11): calls from the wheelers, and the keks and wingbeats of birds the flier puts up.
//
//   a call      its notes, one-shots → caller slot: [gain] → low-pass (air) → pan pair → life bus
//                                                              └→ [send] → reverb
//   a startle   keks and flaps, one-shots → a pooled chain where the bird took off → life bus
//
// A caller's slot follows its bird round its wheel, thirty times a second (a bird the flier puts up is up to 25 cells
// off that round for four seconds: the slot does not follow that). Two
// callers at most (one on touch): a call that finds no slot free is not played.

import { ALOFT, wheeled, wheelerAt } from "../../live/life.ts";
import { K_GULL } from "../levels.ts";
import { callNotes, startleNotes, type CallNote, type StartleNote } from "../schedule/gulls.ts";
import { airCutoff, cutoffCents, dbToGain, distanceGain, offsetTo, panOf, panPair, reverbSend, SMALL, southCutoff, southGain, southOf } from "../space.ts";
import { flapName, gullName } from "../synth/gulls.ts";
import type { Cue, Pose, Startle, Wheeler } from "../types.ts";
import { gain, lowpass, panner, type Ctx, type Master, type Pan } from "./graph.ts";
import type { Kit } from "./kit.ts";
import type { Pool } from "./slots.ts";

interface Caller {
  in: GainNode;
  air: BiquadFilterNode;
  pan: Pan;
  send: GainNode;
  /** Audio time its call ends by. */
  until: number;
  bird: Wheeler | null;
  /** A scripted call's own place. */
  x: number;
  y: number;
  sentGain: number;
  sentHz: number;
  sentPan: number;
}

/** Starts a one-shot; true when it was started (the engine's register of them, so a mute stops it). */
export type Play = (buffer: AudioBuffer, dest: AudioNode, when: number, level: number, rate: number) => boolean;

export interface Gulls {
  /** A call from `cue` at audio time `when`: true when a caller's slot took it. */
  call(cue: Cue, when: number, now: number, pose: Pose, calm: boolean): boolean;
  /** Birds just put up: each new one gets its keks and its wingbeats, timed from world time by `at` (world → audio). */
  startle(list: readonly Startle[], pose: Pose, now: number, at: (t: number) => number, calm: boolean): number;
  /** Thirty times a second: each calling bird's slot follows it. Returns the sends made. */
  update(pose: Pose, now: number, calm: boolean): number;
  /** Everything was stopped. */
  clear(): void;
  nodes: number;
  /** Calls taken and calls dropped for want of a slot; startles voiced. */
  readonly calls: number;
  readonly dropped: number;
  readonly startles: number;
  /** Every kek of a startled bird that was played: its audio time, how far off the bird was (cells), and its run (0 the first). */
  readonly keks: { when: number; d: number; run: number }[];
}

const notes: CallNote[] = [], wing: StartleNote[] = [];
const spot = { gain: 0, hz: 0, pan: 0, send: 0 };

export function buildGulls(ctx: Ctx, kit: Kit, master: Master, opts: { touch: boolean; seed: number; n: number; wheelers: readonly Wheeler[]; play: Play; pool: Pool }): Gulls {
  const callers: Caller[] = [];
  const most = opts.touch ? 1 : 2;
  /** Startled birds voiced lately: key → world time it may be voiced again. */
  const ledger = new Map<number, number>();
  let calls = 0, dropped = 0, startles = 0;
  const keks: Gulls["keks"] = [];

  const make = (): Caller => {
    const g = gain(ctx, 0);
    const air = lowpass(ctx, 1000);
    const pan = panner(ctx, 0);
    const send = gain(ctx, 0);
    g.connect(air);
    air.connect(pan.left);
    air.connect(pan.right);
    pan.out.connect(master.bus.life);
    air.connect(send);
    send.connect(master.send);
    gulls.nodes += 7;
    return { in: g, air, pan, send, until: -Infinity, bird: null, x: 0, y: 0, sentGain: NaN, sentHz: 1000, sentPan: 0 };
  };

  /** Where a caller's bird is at world time t, on its round. */
  const place = (c: Caller, pose: Pose, calm: boolean) => {
    let x = c.x, y = c.y, alt = pose.alt;
    if (c.bird) {
      wheelerAt(c.bird, pose.t);
      x = wheeled.x;
      y = wheeled.y;
      alt = wheeled.alt;
    }
    const o = offsetTo(pose.x, pose.y, pose.alt, x, y, alt, opts.n);
    const b = southOf(o.dx, o.dy);
    spot.gain = K_GULL.call * distanceGain(SMALL, o.d) * southGain(b);
    spot.hz = airCutoff(o.d) * southCutoff(b);
    spot.pan = panOf(o.dx, o.dy, calm);
    spot.send = reverbSend(K_GULL.send, SMALL, o.d);
  };

  const gulls: Gulls = {
    nodes: 0,
    get calls() {
      return calls;
    },
    get dropped() {
      return dropped;
    },
    get startles() {
      return startles;
    },
    keks,
    call(cue, when, now, pose, calm) {
      let c: Caller | undefined = callers.find((x) => x.until <= when);
      if (!c && callers.length < most) {
        c = make();
        callers.push(c);
      }
      if (!c) {
        dropped++;
        return false;
      }
      let bird: Wheeler | null = null;
      if (cue.x === undefined) {
        // The cue's bird: the k-th wheeler of its colony.
        let k = cue.bird ?? 0;
        for (const w of opts.wheelers) {
          if (w.site !== cue.colony) continue;
          if (k-- === 0) {
            bird = w;
            break;
          }
        }
        if (!bird) return false;
      }
      c.bird = bird;
      c.x = cue.x ?? 0;
      c.y = cue.y ?? 0;
      place(c, pose, calm);
      // Out of earshot: not started (and the slot stays free).
      if (spot.gain < 1e-4) return false;
      // The slot is silent once its last call has ended: from then it is set outright for this bird.
      const at = Math.min(when, Math.max(now, c.until));
      const [l, r] = panPair(spot.pan);
      for (const p of [c.in.gain, c.air.detune, c.pan.left.gain, c.pan.right.gain, c.send.gain]) p.cancelScheduledValues(at);
      c.in.gain.setValueAtTime(spot.gain, at);
      c.air.detune.setValueAtTime(cutoffCents(spot.hz), at);
      c.pan.left.gain.setValueAtTime(l, at);
      c.pan.right.gain.setValueAtTime(r, at);
      c.send.gain.setValueAtTime(spot.send, at);
      c.sentGain = spot.gain;
      c.sentHz = spot.hz;
      c.sentPan = spot.pan;
      const voice = cue.variant ?? 0;
      // Each bird sings a shade off the library's pitch: its own.
      const own = bird ? 0.94 + 0.12 * (((bird.h >>> 8) & 255) / 255) : 1;
      callNotes(opts.seed, voice, cue.k ?? 0, cue.call ?? 0, notes);
      let end = when;
      for (const nt of notes) {
        const buffer = kit.buffer(gullName(voice, nt.note));
        const rate = nt.rate * own;
        opts.play(buffer, c.in, when + nt.dt, dbToGain(nt.db), rate);
        end = when + nt.dt + buffer.duration / rate;
      }
      c.until = end + 0.05;
      calls++;
      return true;
    },
    startle(list, pose, now, at, calm) {
      let made = 0;
      for (const [key, until] of ledger) if (until < pose.t) ledger.delete(key);
      for (const s of list) {
        // Three birds at most are voiced at once (two on touch); one already voiced is left alone until it has settled.
        if (ledger.has(s.key) || ledger.size >= most + 1) continue;
        const o = offsetTo(pose.x, pose.y, pose.alt, s.x, s.y, pose.alt - 20, opts.n);
        const b = southOf(o.dx, o.dy);
        // A bird put up is heard for what it is from anywhere along the pass: its level falls as the square root of the
        // distance (the small class's reach, a gentler law), or the further half of them would be lost under the wind.
        // Several up at once share a little of the level (each n^−¼ of a lone bird's): a flock is not three times as
        // loud as a gull. The nearest are held to `near`, the level of a bird about 51 cells off (true peak).
        const level = Math.min(K_GULL.near, (Math.sqrt(distanceGain(SMALL, o.d)) * southGain(b)) / Math.pow(ledger.size + 1, 0.25));
        if (level < 1e-3) continue;
        const end = at(s.t0 + ALOFT) + 0.3;
        const chain = opts.pool.take(now, end, level, airCutoff(o.d) * southCutoff(b), panOf(o.dx, o.dy, calm));
        if (!chain) continue;
        ledger.set(s.key, s.t0 + ALOFT + 0.6);
        startleNotes(opts.seed, s.g, s.t0, ALOFT, wing);
        const voice = (s.g >>> 5) % 6;
        for (const w of wing) {
          const when = at(w.t);
          // What has already gone by (the bird was found a moment after it rose) is not played late.
          if (when < now + 0.004) continue;
          if (w.flap) opts.play(kit.buffer(flapName(w.take)), chain, when, K_GULL.flap * dbToGain(w.db), 1);
          else if (opts.play(kit.buffer(gullName(voice, w.note)), chain, when, K_GULL.kek * dbToGain(w.db + (calm ? -6 : 0)), w.rate) && keks.length < 2000) keks.push({ when, d: o.d, run: w.run });
        }
        startles++;
        made++;
      }
      return made;
    },
    update(pose, now, calm) {
      let sends = 0;
      for (const c of callers) {
        if (c.until <= now || c.sentGain !== c.sentGain) continue;
        place(c, pose, calm);
        const ga = Math.max(c.sentGain, 1e-4), gb = Math.max(spot.gain, 1e-4);
        if (gb >= ga * 1.06 || ga >= gb * 1.06) {
          c.in.gain.setTargetAtTime(spot.gain, now, 0.06);
          c.send.gain.setTargetAtTime(spot.send, now, 0.06);
          c.sentGain = spot.gain;
          sends += 2;
        }
        if (spot.hz >= c.sentHz * 1.029 || c.sentHz >= spot.hz * 1.029) {
          c.air.detune.setTargetAtTime(cutoffCents(spot.hz), now, 0.1);
          c.sentHz = spot.hz;
          sends++;
        }
        if (Math.abs(spot.pan - c.sentPan) >= 0.02) {
          const [l, r] = panPair(spot.pan);
          const tau = calm ? 0.12 : 0.06;
          c.pan.left.gain.setTargetAtTime(l, now, tau);
          c.pan.right.gain.setTargetAtTime(r, now, tau);
          c.sentPan = spot.pan;
          sends += 2;
        }
      }
      return sends;
    },
    clear() {
      for (const c of callers) c.until = -Infinity;
      ledger.clear();
    },
  };
  return gulls;
}
