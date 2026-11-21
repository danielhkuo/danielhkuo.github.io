// The abbey's bells and the reverb they are heard through (design §4.6, §6.1).
//
//   a stroke   ring buffer → [its level] ─┐                       (bells 0, 2, 4 into slot A; 1, 3 into slot B)
//              strike buffer → [its level] ┴→ slot: [abbey gain] → [wander] → low-pass (air, wandering) → pan pair → bells bus
//                                                                                └→ [send] → send bus
//   reverb     send bus → convolver (the generated response) → world bus
//
// A stroke is two one-shots with fixed gains; nothing on it is automated but the 30 ms rise of a ring joined in
// progress and the fade of a ring that makes way for a newer one. On the page a stroke not due soon is decided here
// and its nodes are made later (flush), at the same audio time. The slots follow the mix. Far off, each slot's
// level and brightness come and go on the two slow drifts, on unrelated beats.

import { BELL_CALM_STRIKE_DB, BELL_CAP_TAU, BELL_WANDER, K_BELL, TAU } from "../levels.ts";
import { T } from "../mix.ts";
import { HAMMER } from "../schedule/bells.ts";
import { dbToGain } from "../space.ts";
import { ringName, strikeName, TENOR } from "../synth/bells.ts";
import type { Cue } from "../types.ts";
import { bind, bindHz, bindPan, gain, lowpass, panner, type Binding, type Ctx, type Master } from "./graph.ts";
import type { Hub } from "./hub.ts";
import type { Kit } from "./kit.ts";
import { DEFER_DUE } from "./slots.ts";

/** A ring or a strike kept so a mute can stop it. `source` is null while its nodes are still waiting. */
interface Held {
  source: AudioBufferSourceNode | null;
  end: number;
}

interface Ring extends Held {
  gain: GainNode | null;
  bell: number;
  /** Audio time it started at (its top, were it played from there). */
  start: number;
  /** The audio time it was joined in progress at; NaN when it was struck. */
  joined: number;
  /** A fade to nothing asked for before the gain existed, applied when the nodes are made. */
  fadeWhen: number | null;
  /** A stop asked for before the source existed. */
  stopAt: number | null;
}

export interface Bells {
  /** Build steps still to run, one a frame (all at once offline). */
  steps: (() => void)[];
  bindings: Binding[];
  nodes: number;
  /**
   * One stroke at audio time `when`, `offset` seconds into its ring (0: from its top, with its strike). Returns 2 when
   * ring and strike were started, 1 for a ring alone (joined in progress), 0 when its ring was already over.
   */
  stroke(cue: Cue, when: number, offset: number, calm: boolean): number;
  /** Stops every ring and strike at audio time `at`. Ones still waiting are dropped and never made. */
  stopAll(at: number): void;
  /** Makes every waiting ring and strike due within DEFER_DUE, then up to `max` more of the soonest. */
  flush(now: number, max: number): void;
  prune(now: number): void;
  readonly live: number;
}

/** The reverb: the send bus through the generated response, back into the world bus. One convolver, never swapped. */
export function buildReverb(ctx: Ctx, kit: Kit, master: Master): AudioNode[] {
  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  convolver.buffer = kit.buffer("ir");
  master.send.connect(convolver);
  convolver.connect(master.world);
  return [convolver];
}

export function buildBells(ctx: Ctx, kit: Kit, master: Master, opts: { hub: Hub; touch: boolean; defer?: boolean }): Bells {
  const cap = opts.touch ? 2 : 3;
  const defer = opts.defer === true;
  const slots: GainNode[] = [];
  const rings: Ring[] = [];
  /** Strikes, and rings fading out to make way: kept only so a mute or a hide can stop them. */
  const others: Held[] = [];
  /** Audio time of the next prune (see prune). */
  let pruneAt = -Infinity;
  /** Rings and strikes accepted but not yet made: soonest first. */
  const pending: { when: number; held: Held; run: () => void }[] = [];

  const make = (buffer: AudioBuffer, dest: AudioNode, when: number, offset: number, level: number): { source: AudioBufferSourceNode; gain: GainNode } => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const g = ctx.createGain();
    if (offset > 0) {
      // Joined in progress, on a fresh gain: an eased rise with no corner at its end.
      g.gain.setValueAtTime(0, when);
      g.gain.setTargetAtTime(level, when, TAU.rejoin);
    } else g.gain.value = level;
    source.connect(g);
    g.connect(dest);
    source.start(when, offset);
    // Ended, both leave the graph.
    source.onended = () => {
      source.disconnect();
      g.disconnect();
    };
    return { source, gain: g };
  };

  /** Makes the nodes, and any fade or stop that was asked for while they waited. */
  const realize = (buffer: AudioBuffer, dest: AudioNode, when: number, offset: number, level: number, ring: Ring | null, held: Held) => {
    const shot = make(buffer, dest, when, offset, level);
    held.source = shot.source;
    if (!ring) return;
    ring.gain = shot.gain;
    if (ring.fadeWhen !== null) ring.gain.gain.setTargetAtTime(0, ring.fadeWhen, BELL_CAP_TAU);
    if (ring.stopAt !== null) shot.source.stop(ring.stopAt);
  };

  const schedule = (held: Held, ring: Ring | null, buffer: AudioBuffer, dest: AudioNode, when: number, offset: number, level: number) => {
    if (defer && when - ctx.currentTime >= DEFER_DUE) {
      const item = { when, held, run: () => realize(buffer, dest, when, offset, level, ring, held) };
      let i = pending.length;
      while (i > 0 && pending[i - 1].when > when) i--;
      pending.splice(i, 0, item);
      return;
    }
    realize(buffer, dest, when, offset, level, ring, held);
  };

  const bells: Bells = {
    steps: [],
    bindings: [],
    nodes: 0,
    get live() {
      return rings.length + others.length;
    },
    stroke(cue, when, offset, calm) {
      const bell = cue.bell === HAMMER ? TENOR : (cue.bell ?? TENOR);
      const dest = slots[bell & 1];
      if (!dest) return 0;
      const buffer = kit.buffer(ringName(bell, cue.take ?? 0));
      if (offset > buffer.duration - 0.1) return 0;
      // At most `cap` rings of one bell: a newer stroke fades the oldest. Decided now, even if its nodes are waiting
      // (the fade is automation on a gain that already exists, or applied when that gain is made).
      let count = 0, oldest = -1;
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        if (r.bell !== bell || r.end <= when) continue;
        count++;
        if (oldest < 0 || r.start < rings[oldest].start) oldest = i;
      }
      if (count >= cap && oldest >= 0) {
        const r = rings[oldest];
        // (Joined in this same moment, after a gap, it is simply not played: its gain has not yet left 0.)
        const unheard = r.joined === when;
        if (!unheard) {
          if (r.gain) r.gain.gain.setTargetAtTime(0, when, BELL_CAP_TAU);
          else r.fadeWhen = when;
        }
        const end = unheard ? when : when + 8 * BELL_CAP_TAU;
        if (end < r.end) {
          if (r.source) r.source.stop(end);
          else r.stopAt = end;
          r.end = end;
        }
        others.push(r);
        rings.splice(oldest, 1);
      }
      const level = dbToGain(cue.ringDb ?? 0);
      const ring: Ring = {
        source: null, gain: null, bell, start: when - offset, end: when + buffer.duration - offset + 0.05,
        joined: offset > 0 ? when : NaN, fadeWhen: null, stopAt: null,
      };
      schedule(ring, ring, buffer, dest, when, offset, K_BELL.ring * level);
      rings.push(ring);
      if (offset > 0) return 1;
      const hit = kit.buffer(strikeName(bell));
      const strike: Held = { source: null, end: when + hit.duration + 0.05 };
      schedule(strike, null, hit, dest, when, 0, K_BELL.strike * level * dbToGain((cue.strikeDb ?? 0) + (calm ? BELL_CALM_STRIKE_DB : 0)));
      others.push(strike);
      return 2;
    },
    stopAll(at) {
      pending.length = 0;
      const stop = (list: readonly Held[]) => {
        for (const r of list) {
          if (r.source) {
            try {
              r.source.stop(at);
            } catch {
              // already stopped
            }
          }
          r.end = Math.min(r.end, at);
        }
      };
      stop(rings);
      stop(others);
    },
    flush(now, max) {
      // Due ones are the soonest, and they do not count towards max.
      let extra = 0;
      while (pending.length > 0) {
        const due = pending[0].when - now < DEFER_DUE;
        if (!due && extra >= max) break;
        const p = pending.shift();
        if (!p) break;
        p.run();
        if (!due) extra++;
      }
    },
    prune(now) {
      // Four times a second is enough: a ring kept a moment past its end changes nothing.
      if (now < pruneAt && now >= pruneAt - 0.25) return;
      pruneAt = now + 0.25;
      // Forgotten, not disconnected (each leaves the graph when it ends): a timeline scheduled ahead of its render
      // prunes long before the source plays. A waiting one is dropped with its record, so it is never made.
      const drop = <T extends Held>(list: T[]) => {
        for (let i = list.length - 1; i >= 0; i--) {
          if (!(list[i].end < now)) continue;
          const held = list[i];
          for (let k = pending.length - 1; k >= 0; k--) if (pending[k].held === held) pending.splice(k, 1);
          list.splice(i, 1);
        }
      };
      drop(rings);
      drop(others);
    },
  };

  bells.steps.push(() => {
    // The far-away wander: one drift moves both slots' level, the other their brightness, each by a depth the mix sets.
    const depthGain = gain(ctx, 0), depthCents = gain(ctx, 0);
    opts.hub.drift.connect(depthGain, 0);
    opts.hub.drift.connect(depthCents, 1);
    const levels: GainNode[] = [], airs: BiquadFilterNode[] = [], sends: GainNode[] = [];
    for (let k = 0; k < 2; k++) {
      const level = gain(ctx, 0);
      const wander = gain(ctx, 1);
      depthGain.connect(wander.gain);
      const air = lowpass(ctx, 1000);
      depthCents.connect(air.detune);
      const pan = panner(ctx, 0);
      const send = gain(ctx, 0);
      level.connect(wander);
      wander.connect(air);
      air.connect(pan.left);
      air.connect(pan.right);
      pan.out.connect(master.bus.bells);
      air.connect(send);
      send.connect(master.send);
      slots.push(level);
      levels.push(level);
      airs.push(air);
      sends.push(send);
      bells.bindings.push(bindPan(k === 0 ? T.BELL_PAN_A : T.BELL_PAN_B, pan));
    }
    bells.bindings.push(
      bind(T.BELL_GAIN, levels.map((l) => l.gain)),
      bindHz(T.BELL_HZ, airs, 1000),
      bind(T.BELL_SEND, sends.map((s) => s.gain)),
      bind(T.BELL_FAR, [depthGain.gain, depthCents.gain], (far, k) => far * (k === 0 ? BELL_WANDER.gain : BELL_WANDER.cents)),
    );
    bells.nodes += 2 + 2 * 7;
  });
  return bells;
}
