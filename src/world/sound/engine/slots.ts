// One-shots: the register of every prerendered slice that is playing or waiting to (design §4, §6.2, §6.7). A one-shot
// is a buffer source through a static gain; nothing is automated on it (a rejoined long sound gets a 30 ms fade-in,
// written once on its fresh gain before it sounds). The register is what lets a mute or a hide stop everything that
// was started, so nothing stale can play on return. The pooled chains for point sources join this file with the surf.

import { TAU } from "../levels.ts";
import type { Ctx } from "./graph.ts";

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
        if (live[i].end < now) {
          live[i].gain.disconnect();
          live.splice(i, 1);
        }
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
