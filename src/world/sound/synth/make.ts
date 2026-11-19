// The kit's arithmetic buffers, by job: what sound.worker.ts runs off the main thread (and what the tests, and a page
// whose worker failed, run in place). Pure: plain arrays in, plain arrays out.

import { rngFor } from "../../core/rng.ts";
import { warpTile } from "../../live/water.ts";
import { bubbleBed, lap, PLUNGE, velvet } from "./bubbles.ts";
import { CONTROL_RATE, makeControls } from "./controls.ts";
import { envelope, envelopeName } from "./envelopes.ts";
import { gaussianInto, level, noise, SIGN_LOOPS, signLoop, stereoNoise, WAVE_LOOP } from "./noise.ts";
import { pip, tail } from "./probe.ts";

/** One buffer: its own sample rate and its channels. */
export interface Raw {
  rate: number;
  channels: Float32Array[];
  /** Plain bytes that are not sound (water.ts's warp tile): kept as they are, with no channels. */
  bytes?: Uint8Array;
}

/** The jobs, in the order they are wanted: wind needs the noises and the controls, surf its own set; the probe is the bench's. */
export const JOBS = ["noise", "controls", "surf", "probe"] as const;
export type Job = (typeof JOBS)[number];

/** Noise loop lengths, samples: unequal, so no two layers loop together. */
const LEN = { brown0: 262144, pink7: 240007, white7: 220009, pink1: 200003, pink0: 233021, white0: 211007 };

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
  if (job === "surf") {
    const out: Record<string, Raw> = {
      /** water.ts's own bend of the wave fronts: the ear reads a shore point's bend from it, as the picture does. */
      warp: { rate: 0, channels: [], bytes: warpTile(seed) },
      /** The waves' fresh noise: one Gaussian loop (two channels) and four sign loops of lengths that share no factor. */
      waveA: { rate: sampleRate, channels: [0, 1].map((c) => level(gaussianInto(new Float32Array(WAVE_LOOP), rngFor(seed, `sound/waveA/${c}`)))) },
      velvet: { rate: sampleRate, channels: [0, 1].map((c) => velvet(sampleRate, rngFor(seed, `sound/velvet/${c}`))) },
      plunge: { rate: sampleRate, channels: [bubbleBed(PLUNGE, sampleRate, rngFor(seed, "sound/plunge"))] },
      /** Pink and white with the two channels independent: the surf bed's two halves. */
      pink0: { rate: sampleRate, channels: stereoNoise("pink", LEN.pink0, sampleRate, 0, rngFor(seed, "sound/pink0")) },
      white0: { rate: sampleRate, channels: stereoNoise("white", LEN.white0, sampleRate, 0, rngFor(seed, "sound/white0")) },
    };
    SIGN_LOOPS.forEach((len, i) => {
      out[`sign${i}`] = { rate: sampleRate, channels: [signLoop(len, rngFor(seed, `sound/sign/${i}`))] };
    });
    for (let v = 0; v < 4; v++) out[`lap${v}`] = { rate: sampleRate, channels: [lap(sampleRate, rngFor(seed, `sound/lap/${v}`))] };
    for (let kind = 1; kind <= 3; kind++) for (let strength = 1; strength <= 3; strength++) {
      out[envelopeName(kind, strength)] = { rate: CONTROL_RATE, channels: envelope(kind, strength) };
    }
    return out;
  }
  return {
    pip: { rate: sampleRate, channels: [pip(sampleRate, rngFor(seed, "sound/pip"))] },
    tail: { rate: sampleRate, channels: [tail(sampleRate)] },
  };
}
