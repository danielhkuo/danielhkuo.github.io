// The kit's arithmetic buffers, by job: what sound.worker.ts runs off the main thread (and what the tests, and a page
// whose worker failed, run in place). Pure: plain arrays in, plain arrays out.

import { rngFor } from "../../core/rng.ts";
import { warpTile } from "../../live/water.ts";
import { BELL_RATIOS, ring, ringName, strike, strikeName } from "./bells.ts";
import { flap, flapName, FLAPS, GULL_NOTES, GULL_VOICES, gullName, gullNote } from "./gulls.ts";
import { impulseResponse } from "./ir.ts";
import { chime, CHIME_NAMES, chimeName, clack, clackName, CLACKS, ratchet, thud } from "./chimes.ts";
import { chuff, chuffName, click, clickName, horn, HORN_LONG_S, HORN_SHORT_S, pop, splash, swell, thump, whistle, WHISTLE_LONG_S, WHISTLE_SHORT_S } from "./moments.ts";
import { BROOK, bubbleBed, FLOW, lap, PLUNGE, RAIN_PLINKS, velvet } from "./bubbles.ts";
import { DROPS, drops } from "./drops.ts";
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
export const JOBS = ["noise", "controls", "surf", "river", "bells", "gulls", "moments", "probe"] as const;
export type Job = (typeof JOBS)[number];

/** Noise loop lengths, samples: unequal, so no two layers loop together. */
const LEN = { brown0: 262144, pink7: 240007, white7: 220009, pink1: 200003, pink0: 233021, white0: 211007 };

/**
 * The buffers a bed reads as a loop. Each one is made again, from a new draw, before the loop can come round
 * (design §14.8). The whistles, the whoosh, the falls and the moments are not here: they keep one loop.
 */
export const FRESH_NAMES = ["buffet", "rush", "hiss", "breeze", "brown0", "pink0", "white0", "velvet", "drops", "plinks", "brook", "flow"] as const;

const FRESH = new Set<string>(FRESH_NAMES);

/** Generation 0 keeps the kit's own stream tag; a later generation draws the same stream again (`sound/pink7/g3`). */
function stream(base: string, generation: number): string {
  return generation > 0 ? `${base}/g${generation}` : base;
}

function draw(seed: number, base: string, generation: number) {
  return rngFor(seed, stream(base, generation));
}

const BUFFET: FilterSpec[] = [{ type: "highpass", hz: A_HIGHPASS_HZ, q: Q_FLAT_DB }, { type: "peaking", hz: A_PEAK.hz, q: A_PEAK.q, db: A_PEAK.db }];
const RUSH: FilterSpec[] = [{ type: "highshelf", hz: B_SHELF.hz, db: B_SHELF.db }];
const HISS: FilterSpec[] = [{ type: "highpass", hz: C_HIGHPASS_HZ, q: Q_FLAT_DB }];
const BREEZE: FilterSpec[] = [{ type: "bandpass", hz: E_BAND.hz, q: E_BAND.q }, { type: "lowpass", hz: E_LOWPASS_HZ, q: Q_FLAT_DB }];

function shape(channels: Float32Array[], filters: readonly FilterSpec[], sampleRate: number): Float32Array[] {
  return channels.map((c) => filtered(c, filters, sampleRate));
}

/** Brown, the two channels independent: the surf bed's rumble, and the buffet's source. */
function brown(seed: number, generation: number, sampleRate: number): Float32Array[] {
  return stereoNoise("brown", LEN.brown0, sampleRate, 0, draw(seed, "sound/brown0", generation));
}

/** Pink at correlation 0.7. The rush and the breeze are this one draw, filtered two ways. */
function pinkWide(seed: number, generation: number, sampleRate: number): Float32Array[] {
  return stereoNoise("pink", LEN.pink7, sampleRate, 0.7, draw(seed, "sound/pink7", generation));
}

function raw(sampleRate: number, channels: Float32Array[]): Raw {
  return { rate: sampleRate, channels };
}

/**
 * Generation `generation` of buffer `name`: the same generator, length, filters and channel count as `make`, and a new
 * draw when `generation` > 0. One name does not build the others.
 */
function drawFresh(name: string, generation: number, seed: number, sampleRate: number): Raw {
  if (!FRESH.has(name)) throw new Error(`remake: ${name} is not made fresh`);
  switch (name) {
    case "brown0":
      return raw(sampleRate, brown(seed, generation, sampleRate));
    case "buffet":
      return raw(sampleRate, shape(brown(seed, generation, sampleRate), BUFFET, sampleRate));
    case "rush":
      return raw(sampleRate, shape(pinkWide(seed, generation, sampleRate), RUSH, sampleRate));
    case "breeze":
      return raw(sampleRate, shape(pinkWide(seed, generation, sampleRate), BREEZE, sampleRate));
    case "hiss": {
      const white = stereoNoise("white", LEN.white7, sampleRate, 0.7, draw(seed, "sound/white7", generation));
      return raw(sampleRate, shape(white, HISS, sampleRate));
    }
    case "pink0":
      return raw(sampleRate, stereoNoise("pink", LEN.pink0, sampleRate, 0, draw(seed, "sound/pink0", generation)));
    case "white0":
      return raw(sampleRate, stereoNoise("white", LEN.white0, sampleRate, 0, draw(seed, "sound/white0", generation)));
    case "velvet":
      return raw(sampleRate, [0, 1].map((c) => velvet(sampleRate, draw(seed, `sound/velvet/${c}`, generation))));
    case "drops":
      return raw(sampleRate, [drops(DROPS, sampleRate, draw(seed, "sound/drops", generation))]);
    case "plinks":
      return raw(sampleRate, [bubbleBed(RAIN_PLINKS, sampleRate, draw(seed, "sound/plinks", generation))]);
    case "brook":
      return raw(sampleRate, [bubbleBed(BROOK, sampleRate, draw(seed, "sound/brook", generation))]);
    case "flow":
      return raw(sampleRate, [bubbleBed(FLOW, sampleRate, draw(seed, "sound/flow", generation))]);
    default:
      throw new Error(`remake: ${name} is not made fresh`);
  }
}

/**
 * Generation `generation` of buffer `name` (design §14.8): generation 0 is the kit's own; a later one is the same
 * generator run on a new draw, heard as the same sound but never the same stretch of it.
 */
export function remake(name: string, generation: number, seed: number, sampleRate: number): Raw {
  return drawFresh(name, generation, seed, sampleRate);
}

export function make(job: Job, seed: number, sampleRate: number): Record<string, Raw> {
  if (job === "noise") {
    return {
      /** Brown, the two channels independent: the surf bed's rumble. */
      brown0: remake("brown0", 0, seed, sampleRate),
      // The wind's layers, each with its fixed filters already run (synth/filters.ts): what the audio thread is left
      // with is the one filter of each that moves.
      /** A, the ear buffet: brown through its high-pass and its bump. */
      buffet: remake("buffet", 0, seed, sampleRate),
      /** B, the rush: pink at correlation 0.7 (wide, but holding its centre) through its shelf. */
      rush: remake("rush", 0, seed, sampleRate),
      /** C, the hiss: white at correlation 0.7 through its high-pass. */
      hiss: remake("hiss", 0, seed, sampleRate),
      /** E, the ground breeze: the same pink through its band and its low-pass. */
      breeze: remake("breeze", 0, seed, sampleRate),
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
      velvet: remake("velvet", 0, seed, sampleRate),
      plunge: { rate: sampleRate, channels: [bubbleBed(PLUNGE, sampleRate, rngFor(seed, "sound/plunge"))] },
      /** Pink and white with the two channels independent: the surf bed's two halves. */
      pink0: remake("pink0", 0, seed, sampleRate),
      white0: remake("white0", 0, seed, sampleRate),
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
      brook: remake("brook", 0, seed, sampleRate),
      flow: remake("flow", 0, seed, sampleRate),
      /** Rain's drops on land and its plinks on water (made with the river's: the rain bed waits for both). */
      drops: remake("drops", 0, seed, sampleRate),
      plinks: remake("plinks", 0, seed, sampleRate),
    };
  }
  if (job === "gulls") {
    // Six birds, eight notes each, and the three wingbeats.
    const out: Record<string, Raw> = {};
    for (let voice = 0; voice < GULL_VOICES; voice++) for (const note of GULL_NOTES) out[gullName(voice, note)] = { rate: sampleRate, channels: [gullNote(seed, voice, note, sampleRate)] };
    for (let k = 0; k < FLAPS; k++) out[flapName(k)] = { rate: sampleRate, channels: [flap(seed, k, sampleRate)] };
    return out;
  }
  if (job === "moments") {
    // The town clock's bars, clacks, thud and ratchet; the train's and the seaplane's one-shots.
    const out: Record<string, Raw> = {
      thud: { rate: sampleRate, channels: [thud(seed, sampleRate)] },
      ratchet: { rate: sampleRate, channels: [ratchet(seed, sampleRate)] },
      whistleLong: { rate: sampleRate, channels: [whistle(seed, WHISTLE_LONG_S, sampleRate)] },
      whistleShort: { rate: sampleRate, channels: [whistle(seed, WHISTLE_SHORT_S, sampleRate)] },
      swell: { rate: sampleRate, channels: [swell(seed, sampleRate)] },
      splash0: { rate: sampleRate, channels: [splash(seed, 0, sampleRate)] },
      splash1: { rate: sampleRate, channels: [splash(seed, 1, sampleRate)] },
      hornShort: { rate: sampleRate, channels: [horn(seed, HORN_SHORT_S, sampleRate)] },
      hornLong: { rate: sampleRate, channels: [horn(seed, HORN_LONG_S, sampleRate)] },
      thump: { rate: sampleRate, channels: [thump(seed, sampleRate)] },
    };
    for (let i = 0; i < CHIME_NAMES.length; i++) out[chimeName(i)] = { rate: sampleRate, channels: [chime(seed, i, sampleRate)] };
    for (let k = 0; k < CLACKS; k++) out[clackName(k)] = { rate: sampleRate, channels: [clack(seed, k, sampleRate)] };
    for (let k = 0; k < 4; k++) {
      out[chuffName(k)] = { rate: sampleRate, channels: [chuff(seed, k, sampleRate)] };
      out[clickName(k)] = { rate: sampleRate, channels: [click(seed, k, sampleRate)] };
    }
    for (let k = 0; k < 3; k++) out[`pop${k}`] = { rate: sampleRate, channels: [pop(seed, k, sampleRate)] };
    return out;
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
