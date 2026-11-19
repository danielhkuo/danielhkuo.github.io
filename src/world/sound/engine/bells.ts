// The abbey's bells and the reverb they are heard through (design §4.6, §6.1).
//
//   a stroke   ring buffer → [its level] ─┐                       (bells 0, 2, 4 into slot A; 1, 3 into slot B)
//              strike buffer → [its level] ┴→ slot: [abbey gain] → [wander] → low-pass (air, wandering) → pan pair → bells bus
//                                                                                └→ [send] → send bus
//   reverb     send bus → convolver (the generated response) → world bus
//
// A stroke is two one-shots with fixed gains; nothing on it is automated but the 30 ms rise of a ring joined in
// progress and the fade of a ring that makes way for a newer one. The slots follow the mix. Far off, each slot's
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

interface Ring {
  source: AudioBufferSourceNode;
  gain: GainNode;
  bell: number;
  /** Audio times it started at (its top, were it played from there) and ends by. */
  start: number;
  end: number;
  /** The audio time it was joined in progress at; NaN when it was struck. */
  joined: number;
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
  /** Stops every ring and strike, started or waiting, at audio time `at`. */
  stopAll(at: number): void;
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

export function buildBells(ctx: Ctx, kit: Kit, master: Master, opts: { hub: Hub; touch: boolean }): Bells {
  const cap = opts.touch ? 2 : 3;
  const slots: GainNode[] = [];
  const rings: Ring[] = [];
  /** Strikes, and rings fading out to make way: kept only so a mute or a hide can stop them. */
  const others: { source: AudioBufferSourceNode; end: number }[] = [];
  /** Audio time of the next prune (see prune). */
  let pruneAt = -Infinity;

  const oneShot = (buffer: AudioBuffer, dest: AudioNode, when: number, offset: number, level: number): { source: AudioBufferSourceNode; gain: GainNode } => {
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
      // At most `cap` rings of one bell: a newer stroke fades the oldest.
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
        if (!unheard) r.gain.gain.setTargetAtTime(0, when, BELL_CAP_TAU);
        const end = unheard ? when : when + 8 * BELL_CAP_TAU;
        if (end < r.end) {
          r.source.stop(end);
          r.end = end;
        }
        others.push({ source: r.source, end: r.end });
        rings.splice(oldest, 1);
      }
      const level = dbToGain(cue.ringDb ?? 0);
      const ring = oneShot(buffer, dest, when, offset, K_BELL.ring * level);
      rings.push({ source: ring.source, gain: ring.gain, bell, start: when - offset, end: when + buffer.duration - offset + 0.05, joined: offset > 0 ? when : NaN });
      if (offset > 0) return 1;
      const hit = kit.buffer(strikeName(bell));
      const strike = oneShot(hit, dest, when, 0, K_BELL.strike * level * dbToGain((cue.strikeDb ?? 0) + (calm ? BELL_CALM_STRIKE_DB : 0)));
      others.push({ source: strike.source, end: when + hit.duration + 0.05 });
      return 2;
    },
    stopAll(at) {
      for (const list of [rings, others]) {
        for (const r of list) {
          try {
            r.source.stop(at);
          } catch {
            // already stopped
          }
          r.end = Math.min(r.end, at);
        }
      }
    },
    prune(now) {
      // Four times a second is enough: a ring kept a moment past its end changes nothing.
      if (now < pruneAt && now >= pruneAt - 0.25) return;
      pruneAt = now + 0.25;
      // Forgotten, not disconnected (each leaves the graph when it ends): a timeline scheduled ahead of its render
      // prunes long before the source plays.
      for (let i = rings.length - 1; i >= 0; i--) if (rings[i].end < now) rings.splice(i, 1);
      for (let i = others.length - 1; i >= 0; i--) if (others[i].end < now) others.splice(i, 1);
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
