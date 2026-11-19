// The kit's arithmetic buffers, by job: what sound.worker.ts runs off the main thread (and what the tests, and a page
// whose worker failed, run in place). Pure: plain arrays in, plain arrays out.

import { rngFor } from "../../core/rng.ts";
import { CONTROL_RATE, makeControls } from "./controls.ts";
import { noise, stereoNoise } from "./noise.ts";
import { pip, tail } from "./probe.ts";

/** One buffer: its own sample rate and its channels. */
export interface Raw {
  rate: number;
  channels: Float32Array[];
}

/** The jobs, in the order they are wanted: wind needs the noises and the controls; the probe is the bench's. */
export const JOBS = ["noise", "controls", "probe"] as const;
export type Job = (typeof JOBS)[number];

/** Noise loop lengths, samples: unequal, so no two layers loop together. */
const LEN = { brown0: 262144, pink7: 240007, white7: 220009, pink1: 200003 };

export function make(job: Job, seed: number, sampleRate: number): Record<string, Raw> {
  if (job === "noise") {
    return {
      /** Brown, the two channels independent: the ear buffet. */
      brown0: { rate: sampleRate, channels: stereoNoise("brown", LEN.brown0, sampleRate, 0, rngFor(seed, "sound/brown0")) },
      /** Pink and white at correlation 0.7: wide, but holding their centre. */
      pink7: { rate: sampleRate, channels: stereoNoise("pink", LEN.pink7, sampleRate, 0.7, rngFor(seed, "sound/pink7")) },
      white7: { rate: sampleRate, channels: stereoNoise("white", LEN.white7, sampleRate, 0.7, rngFor(seed, "sound/white7")) },
      /** Pink, mono: the whistles' and the whoosh's source. */
      pink1: { rate: sampleRate, channels: [noise("pink", LEN.pink1, sampleRate, rngFor(seed, "sound/pink1"))] },
    };
  }
  if (job === "controls") {
    const c = makeControls(seed);
    return {
      gust: { rate: CONTROL_RATE, channels: c.gust },
      flutter: { rate: CONTROL_RATE, channels: c.flutter },
      whistle: { rate: CONTROL_RATE, channels: c.whistle },
      drift: { rate: CONTROL_RATE, channels: c.drift },
    };
  }
  return {
    pip: { rate: sampleRate, channels: [pip(sampleRate, rngFor(seed, "sound/pip"))] },
    tail: { rate: sampleRate, channels: [tail(sampleRate)] },
  };
}
