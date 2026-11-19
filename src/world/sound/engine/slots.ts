// One-shots: the register of every prerendered slice that is playing or waiting to (design §4, §6.2, §6.7). A one-shot
// is a buffer source through a static gain; nothing is automated on it (a rejoined long sound gets a 30 ms fade-in,
// written once on its fresh gain before it sounds). The register is what lets a mute or a hide stop everything that
// was started, so nothing stale can play on return. The pooled chains for point sources join this file with the surf.

import { TAU } from "../levels.ts";
import { cutoffCents, panPair } from "../space.ts";
import { gain, lowpass, panner, type Ctx, type Pan } from "./graph.ts";

interface Live {
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** Audio time it ends by. */
  end: number;
}

export interface OneShotOptions {
  /** Audio time to start at. */
  when: number;
  /** Seconds into the buffer to start from (a sound joined in progress); 0 from its top. */
  offset?: number;
  gain: number;
  rate?: number;
  /** Eases in (95 % in 30 ms): for a sound joined in progress. */
  fadeIn?: boolean;
  /** Low classes (laps, flaps, wheel clicks) are dropped unplayed when the cap is reached; nothing sounding is cut. */
  low?: boolean;
  /** A signal in cents that bends the source's pitch while it sounds (a moving slot's Doppler shift). */
  detune?: AudioNode;
}

export interface OneShots {
  /** Starts one. False when it was dropped (the cap). */
  play(buffer: AudioBuffer, dest: AudioNode, o: OneShotOptions): boolean;
  /** Stops every one-shot, started or still waiting, at audio time `at`. */
  stopAll(at: number): void;
  /** Forgets those that have ended by `now`. */
  prune(now: number): void;
  readonly live: number;
  readonly started: number;
  readonly dropped: number;
}

export function createOneShots(ctx: Ctx, cap: number): OneShots {
  const live: Live[] = [];
  let started = 0, dropped = 0;
  return {
    play(buffer, dest, o) {
      if (live.length >= cap && o.low) {
        dropped++;
        return false;
      }
      const rate = o.rate ?? 1;
      const offset = o.offset ?? 0;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const g = ctx.createGain();
      if (o.fadeIn) {
        // On a fresh gain, before it sounds: an eased rise with no corner at its end.
        g.gain.setValueAtTime(0, o.when);
        g.gain.setTargetAtTime(o.gain, o.when, TAU.rejoin);
      } else {
        g.gain.value = o.gain;
      }
      source.connect(g);
      g.connect(dest);
      const bend = o.detune;
      if (bend) bend.connect(source.detune);
      // Ended, both leave the graph: nothing is left for the engine to visit.
      source.onended = () => {
        source.disconnect();
        g.disconnect();
        if (bend) {
          try {
            bend.disconnect(source.detune);
          } catch {
            // already gone
          }
        }
      };
      source.start(o.when, offset);
      live.push({ source, gain: g, end: o.when + (buffer.duration - offset) / rate + 0.05 });
      started++;
      return true;
    },
    stopAll(at) {
      for (const l of live) {
        try {
          l.source.stop(at);
        } catch {
          // already stopped
        }
        l.end = Math.min(l.end, at);
      }
    },
    prune(now) {
      for (let i = live.length - 1; i >= 0; i--) {
        // Forgotten, not disconnected: a timeline scheduled ahead of its render prunes long before the source plays.
        if (live[i].end < now) live.splice(i, 1);
      }
    },
    get live() {
      return live.length;
    },
    get started() {
      return started;
    },
    get dropped() {
      return dropped;
    },
  };
}

/** A pooled chain for one point source: gain → low-pass (air) → pan pair. */
interface Chain {
  gain: GainNode;
  air: BiquadFilterNode;
  pan: Pan;
  /** Audio time it is busy until. */
  until: number;
}

export interface Pool {
  /**
   * A free chain, set for a source at this gain, air (Hz) and pan, and held until audio time `until`; null when every
   * chain is busy. The chain is silent when it is taken, so its values are set outright.
   */
  take(now: number, until: number, level: number, hz: number, pan: number): AudioNode | null;
  readonly size: number;
}

/**
 * The pool of chains point sources play through. For now each is set once for a short one-shot (a lap); following a
 * source as it moves, and stealing, come with the voices that need them.
 */
export function createPool(ctx: Ctx, count: number, out: AudioNode): Pool {
  const chains: Chain[] = [];
  const make = (): Chain => {
    const g = gain(ctx, 0);
    const air = lowpass(ctx, 1000);
    const pan = panner(ctx, 0);
    g.connect(air);
    air.connect(pan.left);
    air.connect(pan.right);
    pan.out.connect(out);
    return { gain: g, air, pan, until: -Infinity };
  };
  return {
    size: count,
    take(now, until, level, hz, pan) {
      let c: Chain | undefined = chains.find((x) => x.until <= now);
      // Chains are made as they are first needed, so a quiet scene builds none.
      if (!c && chains.length < count) {
        c = make();
        chains.push(c);
      }
      if (!c) return null;
      c.until = until;
      const [l, r] = panPair(pan);
      c.gain.gain.setValueAtTime(level, now);
      c.air.detune.setValueAtTime(cutoffCents(hz), now);
      c.pan.left.gain.setValueAtTime(l, now);
      c.pan.right.gain.setValueAtTime(r, now);
      return c.gain;
    },
  };
}
