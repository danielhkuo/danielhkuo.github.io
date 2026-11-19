// The kit's arithmetic buffers, by job: what sound.worker.ts runs off the main thread (and what the tests, and a page
// whose worker failed, run in place). Pure: plain arrays in, plain arrays out.

import { rngFor } from "../../core/rng.ts";
import { warpTile } from "../../live/water.ts";
import { BELL_RATIOS, ring, ringName, strike, strikeName } from "./bells.ts";
import { impulseResponse } from "./ir.ts";
import { BROOK, bubbleBed, FLOW, lap, PLUNGE, velvet } from "./bubbles.ts";
import { CONTROL_RATE, makeControls } from "./controls.ts";
import { A_HIGHPASS_HZ, A_PEAK, B_SHELF, C_HIGHPASS_HZ, E_BAND, E_LOWPASS_HZ, Q_FLAT_DB } from "../levels.ts";
import { envelope, envelopeName } from "./envelopes.ts";
import { filtered, type FilterSpec } from "./filters.ts";
import { gaussianInto, level, noise, SIGN_LOOPS, signLoop, stereoNoise, WAVE_LOOP } from "./noise.ts";
import { pip, tail } from "./probe.ts";

/** One buffer: its own sample rate and its channels. */
export interface Raw {
  rate: number;
  channels: Float32Array[];
  /** Plain bytes that are not sound (water.ts's warp tile): kept as they are, with no channels. */
  bytes?: Uint8Array;
}

/** The jobs, in the order they are wanted: wind needs the noises and the controls, surf its own set, the rivers their bubble beds, the abbey its bells and the reverb; the probe is the bench's. */
export const JOBS = ["noise", "controls", "surf", "river", "bells", "probe"] as const;
export type Job = (typeof JOBS)[number];

/** Noise loop lengths, samples: unequal, so no two layers loop together. */
const LEN = { brown0: 262144, pink7: 240007, white7: 220009, pink1: 200003, pink0: 233021, white0: 211007 };

export function make(job: Job, seed: number, sampleRate: number): Record<string, Raw> {
  if (job === "noise") {
    const brown0 = stereoNoise("brown", LEN.brown0, sampleRate, 0, rngFor(seed, "sound/brown0"));
    const pink7 = stereoNoise("pink", LEN.pink7, sampleRate, 0.7, rngFor(seed, "sound/pink7"));
    const white7 = stereoNoise("white", LEN.white7, sampleRate, 0.7, rngFor(seed, "sound/white7"));
    const through = (x: Float32Array[], filters: FilterSpec[]) => x.map((c) => filtered(c, filters, sampleRate));
    return {
      /** Brown, the two channels independent: the surf bed's rumble. */
      brown0: { rate: sampleRate, channels: brown0 },
      // The wind's layers, each with its fixed filters already run (synth/filters.ts): what the audio thread is left
      // with is the one filter of each that moves.
      /** A, the ear buffet: brown through its high-pass and its bump. */
      buffet: { rate: sampleRate, channels: through(brown0, [{ type: "highpass", hz: A_HIGHPASS_HZ, q: Q_FLAT_DB }, { type: "peaking", hz: A_PEAK.hz, q: A_PEAK.q, db: A_PEAK.db }]) },
      /** B, the rush: pink at correlation 0.7 (wide, but holding its centre) through its shelf. */
      rush: { rate: sampleRate, channels: through(pink7, [{ type: "highshelf", hz: B_SHELF.hz, db: B_SHELF.db }]) },
      /** C, the hiss: white at correlation 0.7 through its high-pass. */
      hiss: { rate: sampleRate, channels: through(white7, [{ type: "highpass", hz: C_HIGHPASS_HZ, q: Q_FLAT_DB }]) },
      /** E, the ground breeze: the same pink through its band and its low-pass. */
      breeze: { rate: sampleRate, channels: through(pink7, [{ type: "bandpass", hz: E_BAND.hz, q: E_BAND.q }, { type: "lowpass", hz: E_LOWPASS_HZ, q: Q_FLAT_DB }]) },
      /** Pink, mono: the whistles' and the whoosh's source. */
      pink1: { rate: sampleRate, channels: [noise("pink", LEN.pink1, sampleRate, rngFor(seed, "sound/pink1"))] },
    };
  }
  if (job === "controls") {
    const c = makeControls(seed);
    return {
      gust: { rate: CONTROL_RATE, channels: c.gust },
      flutter: { rate: CONTROL_RATE, channels: c.flutter },
      // The whistles' squalls alone (the odd channels of the whistle set): every channel played costs the audio thread.
      squall: { rate: CONTROL_RATE, channels: [c.whistle[1], c.whistle[3], c.whistle[5]] },
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
    // A wave's gains, one buffer a kind, at the context's own rate (played off-rate they cost the audio thread dear).
    for (let kind = 1; kind <= 3; kind++) out[envelopeName(kind)] = { rate: sampleRate, channels: envelope(kind, sampleRate) };
    return out;
  }
  if (job === "river") {
    return {
      brook: { rate: sampleRate, channels: [bubbleBed(BROOK, sampleRate, rngFor(seed, "sound/brook"))] },
      flow: { rate: sampleRate, channels: [bubbleBed(FLOW, sampleRate, rngFor(seed, "sound/flow"))] },
    };
  }
  if (job === "bells") {
    // Five bells, two ring takes and a strike each, and the response of the stone and the valley they are heard in.
    const out: Record<string, Raw> = { ir: { rate: sampleRate, channels: impulseResponse(seed, sampleRate) } };
    for (let bell = 0; bell < BELL_RATIOS.length; bell++) {
      for (let take = 0; take < 2; take++) out[ringName(bell, take)] = { rate: sampleRate, channels: [ring(seed, bell, take, sampleRate)] };
      out[strikeName(bell)] = { rate: sampleRate, channels: [strike(seed, bell, sampleRate)] };
    }
    return out;
  }
  return {
    pip: { rate: sampleRate, channels: [pip(sampleRate, rngFor(seed, "sound/pip"))] },
    tail: { rate: sampleRate, channels: [tail(sampleRate)] },
  };
}
