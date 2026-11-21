// Continuous noise, made as it plays (design §14.8). A bed's noises are one AudioWorkletNode, one output each, so the
// audio thread is entered once for the bed rather than once a noise. A layer may skip its own draw and filter an
// earlier layer's coloured, mixed noise (the breeze and the rush are one pink). The grain, a slow gain, is stepped
// every few samples and filled in between. The bubbles and the drops stay loops: they are sparse events, and copying
// them is cheap.
//
// The processor is a function turned into source. The audio thread cannot see this module, so the function names
// nothing from it: the sample rate and the clock are the worklet's own globals, and every coefficient arrives in
// processorOptions, computed here.

import { grainDeviation, grainK, GRAIN_FLOOR, GRAIN_KNEE, GRAIN_SLOPE, GRAIN_SPAN } from "../synth/bubbles.ts";
import { coefficients, type Coefficients } from "../synth/filters.ts";
import { NOISE_LAYERS, type NoiseLayer } from "../synth/make.ts";
import { brownLeak, colourGain, PINK_DELAY, PINK_FEED, PINK_POLES, PINK_WEIGHTS, stereoGains } from "../synth/noise.ts";

/** Worklet globals. They exist on the audio thread; naming them here is only so the processor typechecks. */
declare const sampleRate: number;
declare const currentTime: number;

declare abstract class AudioWorkletProcessor {
  protected constructor(options?: AudioWorkletNodeOptions);
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

/** The continuous noises. Drops, plinks, brook and flow are not here: they stay fresh loops. */
export const NOISE_NAMES = ["buffet", "rush", "hiss", "breeze", "brown0", "pink0", "white0", "velvet"] as const;

export type NoiseName = (typeof NOISE_NAMES)[number];

const NOISE_NAME = new Set<string>(NOISE_NAMES);

export function isNoiseName(name: string): name is NoiseName {
  return NOISE_NAME.has(name);
}

/**
 * Everything the processor needs, and nothing that is not plain data: the audio thread receives it by structured
 * clone, and builds no coefficient of its own.
 */
export interface NoiseOptions {
  name: string;
  channels: 1 | 2;
  seed: number;
  /** white, pink, brown, or velvet (the grain, which is not a levelled noise). */
  colour: NoiseLayer["colour"];
  /**
   * After the colour filter, before the fixed filters. For velvet it is 1/sd of the two one-poles, and the logistic
   * follows. It is the impulse response's energy, not a measurement of one buffer.
   */
  gain: number;
  /** Brown's leak. Unused for the other colours. */
  leak: number;
  /** Velvet's one-pole coefficient. Unused otherwise. */
  grainK: number;
  /**
   * Velvet is computed every this many samples (its roughness lives under 90 Hz) and linearly filled between.
   * The one-poles then use grainK8 = 1 − (1 − grainK)^grainStep, and one Gaussian draw scaled by grainScale so the
   * stepped filter keeps the full-rate variance. Unused for the other colours, and still sent so the thread builds
   * nothing of its own.
   */
  grainStep: number;
  grainK8: number;
  grainScale: number;
  floor: number;
  span: number;
  slope: number;
  knee: number;
  /** L = a·n0 + b·n1, R = b·n0 + a·n1. Unmixed channels are a = 1, b = 0. */
  a: number;
  b: number;
  pinkPoles: number[];
  pinkWeights: number[];
  pinkFeed: number;
  pinkDelay: number;
  biquads: Coefficients[];
}

/**
 * The grain is stepped this many samples at a time. Eight keeps the velvet within the buffer's level and bands; the
 * one-poles use the coefficient of an 8-sample hold, and the draw is scaled so their variance does not change.
 */
const VELVET_STEP = 8;

export function noiseOptions(name: string, seed: number, sampleRate: number): NoiseOptions {
  if (!isNoiseName(name)) throw new Error(`noise: ${name} is not made as it plays`);
  const layer = NOISE_LAYERS[name];
  const mix = stereoGains(layer.rho);
  const velvet = layer.colour === "velvet";
  // The coloured noise is brought to NOISE_RMS here, on the main thread, the way level() does it for a buffer.
  // Velvet is a gain, not a noise: the same two one-poles, divided by the deviation their impulse response has.
  const gk = velvet ? grainK(sampleRate) : 0;
  const gain = velvet ? 1 / grainDeviation(gk) : colourGain(layer.colour, sampleRate);
  // k8 = 1 − (1 − k)^step, the one-pole after `step` held samples. The draw is scaled so two such poles still have
  // the full-rate deviation (the logistic's knee is in those units).
  const grainK8 = velvet ? 1 - Math.pow(1 - gk, VELVET_STEP) : 0;
  const grainScale = velvet ? grainDeviation(gk) / grainDeviation(grainK8) : 1;
  return {
    name,
    channels: layer.channels,
    seed,
    colour: layer.colour,
    gain,
    leak: layer.colour === "brown" ? brownLeak(sampleRate) : 0,
    grainK: gk,
    grainStep: VELVET_STEP,
    grainK8,
    grainScale,
    floor: GRAIN_FLOOR,
    span: GRAIN_SPAN,
    slope: GRAIN_SLOPE,
    knee: GRAIN_KNEE,
    a: mix.a,
    b: mix.b,
    pinkPoles: [...PINK_POLES],
    pinkWeights: [...PINK_WEIGHTS],
    pinkFeed: PINK_FEED,
    pinkDelay: PINK_DELAY,
    biquads: layer.filters.map((f) => coefficients(f, sampleRate)),
  };
}

/** One layer of a group: the noise's options, and which earlier layer's mixed noise it filters instead of drawing. */
export interface GroupedNoise extends NoiseOptions {
  /** -1 draws its own coloured noise. Otherwise an earlier layer of the same colour, width and channel count. */
  share: number;
}

/**
 * What a grouped node is given. `share` is -1 when the layer draws its own noise. A shared layer takes that earlier
 * layer's coloured samples after the stereo mix and before the fixed filters (the rush and the breeze are one levelled
 * pink, filtered two ways), and runs only its own biquads. The gain is the source's; a layer whose gain differs scales
 * the block. The shared layer has to come earlier, and it has to be the same colour, correlation and channel count.
 */
export function noiseGroupOptions(layers: { name: string; seed: number; share?: number }[], sampleRate: number): { layers: GroupedNoise[] } {
  const built = layers.map((l) => ({ ...noiseOptions(l.name, l.seed, sampleRate), share: l.share === undefined ? -1 : l.share }));
  for (let i = 0; i < built.length; i++) {
    const k = built[i].share;
    if (k === -1) continue;
    if (!Number.isInteger(k) || k < 0 || k >= i) throw new Error(`noise: share ${k} does not come earlier`);
    const here = NOISE_LAYERS[layers[i].name as NoiseName];
    const there = NOISE_LAYERS[layers[k].name as NoiseName];
    if (here.colour !== there.colour || here.rho !== there.rho || here.channels !== there.channels) {
      throw new Error("noise: shared layers differ in colour, width or channels");
    }
  }
  return { layers: built };
}

/**
 * The processor, as source. A function so it cannot mention anything this module imported: the only names it
 * closes over are the worklet globals, which the audio thread provides and the tests stand in for.
 * The gaussian table is built once, here, so the audio thread has it without importing this module.
 */
function installFreshNoise(): void {
  "use strict";

  /** lowbias32, so a channel's seeds do not sit next to each other. */
  function mix32(x: number): number {
    x = (x ^ (x >>> 16)) >>> 0;
    x = Math.imul(x, 0x7feb352d);
    x = (x ^ (x >>> 15)) >>> 0;
    x = Math.imul(x, 0x846ca68b);
    x = (x ^ (x >>> 16)) >>> 0;
    return x >>> 0;
  }

  function num(o: object, key: string): number {
    const v = (o as Record<string, unknown>)[key];
    if (typeof v !== "number") throw new Error("fresh-noise: " + key);
    return v;
  }

  function nums(o: object, key: string): Float64Array {
    const v = (o as Record<string, unknown>)[key];
    if (!Array.isArray(v)) throw new Error("fresh-noise: " + key);
    const out = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) {
      if (typeof v[i] !== "number") throw new Error("fresh-noise: " + key);
      out[i] = v[i];
    }
    return out;
  }

  function biquadsOf(o: object): Float64Array {
    const v = (o as Record<string, unknown>).biquads;
    if (!Array.isArray(v)) throw new Error("fresh-noise: biquads");
    const coef = new Float64Array(v.length * 5);
    for (let i = 0; i < v.length; i++) {
      const f = v[i];
      if (typeof f !== "object" || f === null) throw new Error("fresh-noise: biquads");
      const at = i * 5;
      coef[at] = num(f, "b0");
      coef[at + 1] = num(f, "b1");
      coef[at + 2] = num(f, "b2");
      coef[at + 3] = num(f, "a1");
      coef[at + 4] = num(f, "a2");
    }
    return coef;
  }

  // Standard normal inverse CDF (Acklam's rational approximation). Built once, below, into the table.
  const NORM_A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const NORM_B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const NORM_C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const NORM_D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

  function invNorm(p: number): number {
    const plow = 0.02425;
    if (p < plow) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((NORM_C[0] * q + NORM_C[1]) * q + NORM_C[2]) * q + NORM_C[3]) * q + NORM_C[4]) * q + NORM_C[5]) / ((((NORM_D[0] * q + NORM_D[1]) * q + NORM_D[2]) * q + NORM_D[3]) * q + 1);
    }
    if (p > 1 - plow) {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((NORM_C[0] * q + NORM_C[1]) * q + NORM_C[2]) * q + NORM_C[3]) * q + NORM_C[4]) * q + NORM_C[5]) / ((((NORM_D[0] * q + NORM_D[1]) * q + NORM_D[2]) * q + NORM_D[3]) * q + 1);
    }
    const q = p - 0.5;
    const r = q * q;
    return (((((NORM_A[0] * r + NORM_A[1]) * r + NORM_A[2]) * r + NORM_A[3]) * r + NORM_A[4]) * r + NORM_A[5]) * q / (((((NORM_B[0] * r + NORM_B[1]) * r + NORM_B[2]) * r + NORM_B[3]) * r + NORM_B[4]) * r + 1);
  }

  // Midpoint quantiles (k + 0.5) / 4096 of the standard normal. One 32-bit draw indexes it twice (the low 12 bits,
  // then the next 12), so the tails past the end entries are cut, near ±3.7σ. That is fine: those tails are a few
  // thousandths of the energy, and every noise here is filtered or mixed before it is heard.
  const GAUSS_SHIFT = 12;
  const GAUSS_N = 1 << GAUSS_SHIFT;
  const GAUSS_MASK = GAUSS_N - 1;
  const GAUSS = new Float32Array(GAUSS_N);
  for (let k = 0; k < GAUSS_N; k++) GAUSS[k] = invNorm((k + 0.5) / GAUSS_N);

  // Gain, leak, mix and the rest. Held as doubles so a whole number and a fraction are the same kind of value in the sample loop.
  const U_GAIN = 0;
  const U_LEAK = 1;
  const U_GRAIN = 2;
  const U_FLOOR = 3;
  const U_SPAN = 4;
  const U_SLOPE = 5;
  const U_KNEE = 6;
  const U_A = 7;
  const U_B = 8;
  const U_FEED = 9;
  const U_DELAY = 10;

  /** The render quantum. A longer block is coloured in chunks of this, still with no allocation. */
  const BLOCK = 128;

  /** One output of the node. The processor holds these and points its fields at the one it is rendering. */
  interface Layer {
    channels: number;
    /** 0 white, 1 pink, 2 brown, 3 velvet. */
    kind: number;
    nf: number;
    /** -1 draws its own coloured noise. Otherwise an earlier layer's mixed block, before that layer's biquads. */
    share: number;
    u: Float64Array;
    rng: Uint32Array;
    pinkS: Float64Array;
    poles: Float64Array;
    weights: Float64Array;
    brown: Float64Array;
    grain: Float64Array;
    coef: Float64Array;
    mem: Float64Array;
    pre0: Float32Array;
    pre1: Float32Array;
    step: number;
    k8: number;
    scale: number;
    phase: number;
    y0: Float64Array;
    y1: Float64Array;
  }

  class FreshNoise extends AudioWorkletProcessor {
    /** Context time from which the output is silence and process returns false, so the node can be collected. */
    endAt = Infinity;
    channels = 1;
    /** 0 white, 1 pink, 2 brown, 3 velvet. */
    kind = 0;
    nf = 0;
    /** The outputs. A single noise is a group of one, so there is one render path. */
    layers: Layer[] = [];
    /** The layer `use` last pointed the fields at. Velvet writes its phase back here. */
    layer!: Layer;
    share = -1;
    step = 8;
    k8 = 0;
    scale = 1;
    phase = 0;
    y0!: Float64Array;
    y1!: Float64Array;
    /** gain, leak, grainK, floor, span, slope, knee, a, b, feed, delay. */
    u!: Float64Array;
    /** xorshift32 state, one word per channel. */
    rng!: Uint32Array;
    /** Six pink poles and the one-sample delay, per channel. */
    pinkS!: Float64Array;
    poles!: Float64Array;
    weights!: Float64Array;
    brown!: Float64Array;
    /** Velvet's two one-poles, per channel. */
    grain!: Float64Array;
    coef!: Float64Array;
    /** Biquad direct-form state, four words per filter per channel: x1, x2, y1, y2. */
    mem!: Float64Array;
    /** Coloured samples for the chunk, before the stereo mix and the fixed filters. */
    pre0!: Float32Array;
    pre1!: Float32Array;

    /** One layer, seeded as a node of its own would be. A bare options object (no `layers`) is a group of one. */
    makeLayer(raw: object): Layer {
      const bag = raw as Record<string, unknown>;
      const colour = bag.colour;
      const channels = num(raw, "channels") === 1 ? 1 : 2;
      const kind = colour === "pink" ? 1 : colour === "brown" ? 2 : colour === "velvet" ? 3 : 0;
      const u = new Float64Array(11);
      u[U_GAIN] = num(raw, "gain");
      u[U_LEAK] = num(raw, "leak");
      u[U_GRAIN] = num(raw, "grainK");
      u[U_FLOOR] = num(raw, "floor");
      u[U_SPAN] = num(raw, "span");
      u[U_SLOPE] = num(raw, "slope");
      u[U_KNEE] = num(raw, "knee");
      u[U_A] = num(raw, "a");
      u[U_B] = num(raw, "b");
      u[U_FEED] = num(raw, "pinkFeed");
      u[U_DELAY] = num(raw, "pinkDelay");
      const coef = biquadsOf(raw);
      const nf = coef.length / 5;
      // xorshift32, one word per channel, from the same mix as the old four-word seed:
      // mix32(seed ^ (c + 1) * 0x9e3779b1). A zero word would stick, so that one mix is replaced.
      // Warmed so the first sample is not the raw seed. The period is 2^32 − 1 draws, two samples each.
      const rng = new Uint32Array(channels);
      const seed = num(raw, "seed") >>> 0;
      for (let c = 0; c < channels; c++) {
        let s = mix32((seed ^ Math.imul(c + 1, 0x9e3779b1)) >>> 0);
        if (s === 0) s = (0x6d2b79f5 ^ (c + 1)) >>> 0;
        for (let k = 0; k < 12; k++) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
        }
        rng[c] = s >>> 0;
      }
      const share = typeof bag.share === "number" ? bag.share : -1;
      let step = num(raw, "grainStep");
      if (!(step >= 1)) step = 1;
      // The grain starts at rest (both poles zero). The first knot ramps away from that gain.
      const rest = u[U_FLOOR] + u[U_SPAN] / (1 + Math.exp(u[U_SLOPE] * u[U_KNEE]));
      const y0 = new Float64Array(channels);
      const y1 = new Float64Array(channels);
      for (let c = 0; c < channels; c++) {
        y0[c] = rest;
        y1[c] = rest;
      }
      return {
        channels, kind, nf, share, u, rng,
        pinkS: new Float64Array(channels * 7),
        poles: nums(raw, "pinkPoles"),
        weights: nums(raw, "pinkWeights"),
        brown: new Float64Array(channels),
        grain: new Float64Array(channels * 2),
        coef, mem: new Float64Array(channels * nf * 4),
        pre0: new Float32Array(BLOCK),
        pre1: new Float32Array(BLOCK),
        step, k8: num(raw, "grainK8"), scale: num(raw, "grainScale"),
        phase: 0, y0, y1,
      };
    }

    /** Point the sample loops at `L`. They write through these references, so the layer keeps the state. */
    use(L: Layer): void {
      this.layer = L;
      this.channels = L.channels;
      this.kind = L.kind;
      this.nf = L.nf;
      this.share = L.share;
      this.u = L.u;
      this.rng = L.rng;
      this.pinkS = L.pinkS;
      this.poles = L.poles;
      this.weights = L.weights;
      this.brown = L.brown;
      this.grain = L.grain;
      this.coef = L.coef;
      this.mem = L.mem;
      this.pre0 = L.pre0;
      this.pre1 = L.pre1;
      this.step = L.step;
      this.k8 = L.k8;
      this.scale = L.scale;
      this.phase = L.phase;
      this.y0 = L.y0;
      this.y1 = L.y1;
    }

    constructor(options: AudioWorkletNodeOptions) {
      super(options);
      const raw = options.processorOptions;
      if (typeof raw !== "object" || raw === null) throw new Error("fresh-noise: no options");
      const bag = raw as Record<string, unknown>;
      // A group is `{ layers }`. One noise, passed as its options alone, is a group of one: the same render path.
      const specs = Array.isArray(bag.layers) ? bag.layers : [raw];
      if (specs.length === 0) throw new Error("fresh-noise: no layers");
      const layers: Layer[] = [];
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        if (typeof spec !== "object" || spec === null) throw new Error("fresh-noise: layers");
        layers.push(this.makeLayer(spec));
      }
      this.layers = layers;
      // The end is a context time, posted from the main thread. Before it arrives the noise runs on.
      this.port.onmessage = (e: MessageEvent) => {
        const data = e.data;
        if (typeof data === "object" && data !== null && typeof (data as { end?: unknown }).end === "number") this.endAt = (data as { end: number }).end;
      };
    }

    /** White, levelled. Two table lookups from each xorshift32 draw. */
    fillWhite(n: number): void {
      const g = GAUSS;
      const gain = this.u[U_GAIN];
      const rng = this.rng;
      const n2 = n - (n & 1);
      const ch = this.channels;
      for (let c = 0; c < ch; c++) {
        const o = c === 0 ? this.pre0 : this.pre1;
        let s = rng[c];
        for (let i = 0; i < n2; i += 2) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
          o[i] = g[s & GAUSS_MASK] * gain;
          o[i + 1] = g[(s >>> GAUSS_SHIFT) & GAUSS_MASK] * gain;
        }
        if (n !== n2) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
          o[n2] = g[s & GAUSS_MASK] * gain;
        }
        rng[c] = s >>> 0;
      }
    }

    /** Paul Kellet's filter, the same recurrence as pinkStep: six poles, then the delay from the previous sample. */
    fillPink(n: number): void {
      const g = GAUSS;
      const u = this.u;
      const gain = u[U_GAIN];
      const feed = u[U_FEED];
      const delay = u[U_DELAY];
      const poles = this.poles;
      const weights = this.weights;
      const p0 = poles[0], p1 = poles[1], p2 = poles[2], p3 = poles[3], p4 = poles[4], p5 = poles[5];
      const w0 = weights[0], w1 = weights[1], w2 = weights[2], w3 = weights[3], w4 = weights[4], w5 = weights[5];
      const st = this.pinkS;
      const rng = this.rng;
      const n2 = n - (n & 1);
      const ch = this.channels;
      for (let c = 0; c < ch; c++) {
        const o = c === 0 ? this.pre0 : this.pre1;
        let s = rng[c];
        const base = c * 7;
        let a0 = st[base], a1 = st[base + 1], a2 = st[base + 2], a3 = st[base + 3], a4 = st[base + 4], a5 = st[base + 5], a6 = st[base + 6];
        for (let i = 0; i < n2; i += 2) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
          let w = g[s & GAUSS_MASK];
          a0 = p0 * a0 + w * w0; a1 = p1 * a1 + w * w1; a2 = p2 * a2 + w * w2;
          a3 = p3 * a3 + w * w3; a4 = p4 * a4 + w * w4; a5 = p5 * a5 + w * w5;
          o[i] = (a0 + a1 + a2 + a3 + a4 + a5 + a6 + w * feed) * gain;
          a6 = w * delay;
          w = g[(s >>> GAUSS_SHIFT) & GAUSS_MASK];
          a0 = p0 * a0 + w * w0; a1 = p1 * a1 + w * w1; a2 = p2 * a2 + w * w2;
          a3 = p3 * a3 + w * w3; a4 = p4 * a4 + w * w4; a5 = p5 * a5 + w * w5;
          o[i + 1] = (a0 + a1 + a2 + a3 + a4 + a5 + a6 + w * feed) * gain;
          a6 = w * delay;
        }
        if (n !== n2) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
          const w = g[s & GAUSS_MASK];
          a0 = p0 * a0 + w * w0; a1 = p1 * a1 + w * w1; a2 = p2 * a2 + w * w2;
          a3 = p3 * a3 + w * w3; a4 = p4 * a4 + w * w4; a5 = p5 * a5 + w * w5;
          o[n2] = (a0 + a1 + a2 + a3 + a4 + a5 + a6 + w * feed) * gain;
          a6 = w * delay;
        }
        rng[c] = s >>> 0;
        st[base] = a0; st[base + 1] = a1; st[base + 2] = a2; st[base + 3] = a3; st[base + 4] = a4; st[base + 5] = a5; st[base + 6] = a6;
      }
    }

    /** Leaky integrator, the same recurrence as brownInto. The gain is applied after, and is not part of the state. */
    fillBrown(n: number): void {
      const g = GAUSS;
      const u = this.u;
      const gain = u[U_GAIN];
      const leak = u[U_LEAK];
      const st = this.brown;
      const rng = this.rng;
      const n2 = n - (n & 1);
      const ch = this.channels;
      for (let c = 0; c < ch; c++) {
        const o = c === 0 ? this.pre0 : this.pre1;
        let s = rng[c];
        let y = st[c];
        for (let i = 0; i < n2; i += 2) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
          y = leak * y + g[s & GAUSS_MASK];
          o[i] = y * gain;
          y = leak * y + g[(s >>> GAUSS_SHIFT) & GAUSS_MASK];
          o[i + 1] = y * gain;
        }
        if (n !== n2) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
          y = leak * y + g[s & GAUSS_MASK];
          o[n2] = y * gain;
        }
        rng[c] = s >>> 0;
        st[c] = y;
      }
    }

    /**
     * The grain, stepped. Every `step` samples one scaled Gaussian drives both one-poles with k8 (the coefficient of
     * that many held samples), the logistic is taken once, and the samples between the knots are a straight line.
     * The phase is the layer's, so a block that ends mid-step continues in the next one.
     */
    fillVelvet(n: number): void {
      const g = GAUSS;
      const u = this.u;
      const k8 = this.k8;
      const scale = this.scale;
      const gain = u[U_GAIN];
      const floor = u[U_FLOOR];
      const span = u[U_SPAN];
      const slope = u[U_SLOPE];
      const knee = u[U_KNEE];
      const st = this.grain;
      const rng = this.rng;
      const step = this.step;
      const inv = 1 / step;
      const y0s = this.y0;
      const y1s = this.y1;
      const phase0 = this.phase;
      const ch = this.channels;
      let end = phase0;
      for (let c = 0; c < ch; c++) {
        const o = c === 0 ? this.pre0 : this.pre1;
        let s = rng[c];
        const base = c * 2;
        let a = st[base];
        let b = st[base + 1];
        let y0 = y0s[c];
        let y1 = y1s[c];
        let phase = phase0;
        for (let i = 0; i < n; i++) {
          if (phase === 0) {
            s ^= s << 13;
            s ^= s >>> 17;
            s ^= s << 5;
            const w = g[s & GAUSS_MASK] * scale;
            a += k8 * (w - a);
            b += k8 * (a - b);
            y1 = floor + span / (1 + Math.exp(-slope * (b * gain - knee)));
          }
          o[i] = y0 + (y1 - y0) * ((phase + 1) * inv);
          phase += 1;
          if (phase === step) {
            y0 = y1;
            phase = 0;
          }
        }
        rng[c] = s >>> 0;
        st[base] = a;
        st[base + 1] = b;
        y0s[c] = y0;
        y1s[c] = y1;
        end = phase;
      }
      this.phase = end;
      this.layer.phase = end;
    }

    /** Direct form I over one chunk, the same sum filters.ts runs. State is local for the chunk and written back at the end. */
    biquadInto(src: Float32Array, n: number, cs: number, ss: number): void {
      const coef = this.coef;
      const mem = this.mem;
      const b0 = coef[cs], b1 = coef[cs + 1], b2 = coef[cs + 2], a1 = coef[cs + 3], a2 = coef[cs + 4];
      let x1 = mem[ss], x2 = mem[ss + 1], y1 = mem[ss + 2], y2 = mem[ss + 3];
      for (let i = 0; i < n; i++) {
        const v = src[i];
        const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = v;
        y2 = y1;
        y1 = y;
        src[i] = y;
      }
      mem[ss] = x1;
      mem[ss + 1] = x2;
      mem[ss + 2] = y1;
      mem[ss + 3] = y2;
    }

    /**
     * Stereo mix into the pre-filter block. L = a·n0 + b·n1 and R = b·n0 + a·n1; an unmixed pair (a = 1, b = 0) is
     * left as filled. A shared layer copies this block and does not mix again.
     */
    mixBlock(n: number): void {
      const ch = this.channels;
      if (ch !== 2) return;
      const u = this.u;
      const a = u[U_A];
      const b = u[U_B];
      if (a === 1 && b === 0) return;
      const pre0 = this.pre0;
      const pre1 = this.pre1;
      for (let i = 0; i < n; i++) {
        const x = pre0[i];
        const y = pre1[i];
        pre0[i] = a * x + b * y;
        pre1[i] = b * x + a * y;
      }
    }

    /**
     * Take `src`'s mixed, pre-filter block. The gain is already in those samples; a layer whose gain differs scales.
     * Called before either layer's biquads, so the source's block is still the coloured noise.
     */
    copyShared(src: Layer, n: number): void {
      const g = this.u[U_GAIN];
      const gs = src.u[U_GAIN];
      const s = g === gs ? 1 : g / gs;
      const a0 = this.pre0;
      const b0 = src.pre0;
      if (s === 1) for (let i = 0; i < n; i++) a0[i] = b0[i];
      else for (let i = 0; i < n; i++) a0[i] = b0[i] * s;
      if (this.channels === 2) {
        const a1 = this.pre1;
        const b1 = src.pre1;
        if (s === 1) for (let i = 0; i < n; i++) a1[i] = b1[i];
        else for (let i = 0; i < n; i++) a1[i] = b1[i] * s;
      }
    }

    /** The fixed biquads, then the output. Filters run per channel on the mixed block. */
    finishBlock(out: Float32Array[], at: number, n: number): void {
      const ch = this.channels;
      const pre0 = this.pre0;
      const pre1 = this.pre1;
      const nf = this.nf;
      if (nf !== 0) {
        for (let c = 0; c < ch; c++) {
          const src = c === 0 ? pre0 : pre1;
          for (let f = 0; f < nf; f++) this.biquadInto(src, n, f * 5, (c * nf + f) * 4);
        }
      }
      const o0 = out[0];
      for (let i = 0; i < n; i++) o0[at + i] = pre0[i];
      if (ch === 2) {
        const o1 = out[1];
        for (let i = 0; i < n; i++) o1[at + i] = pre1[i];
      }
    }

    quietAll(outputs: Float32Array[][], from: number, to: number): void {
      for (let k = 0; k < outputs.length; k++) {
        const out = outputs[k];
        for (let c = 0; c < out.length; c++) {
          const o = out[c];
          for (let i = from; i < to; i++) o[i] = 0;
        }
      }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      const n = outputs[0][0].length;
      const start = currentTime;
      // From the posted context time on, every output is silence and the processor stops, so nothing keeps the node.
      if (!(start < this.endAt)) {
        this.quietAll(outputs, 0, n);
        return false;
      }
      const rate = sampleRate;
      let live = n;
      if (start + n / rate > this.endAt) {
        live = Math.ceil((this.endAt - start) * rate);
        if (live < 0) live = 0;
        else if (live > n) live = n;
      }
      const ls = this.layers;
      const cap = BLOCK;
      let at = 0;
      while (at < live) {
        let len = live - at;
        if (len > cap) len = cap;
        // Draw and mix first, so a shared layer can copy the block before anyone's biquads rewrite it.
        for (let i = 0; i < ls.length; i++) {
          const L = ls[i];
          if (L.share >= 0) continue;
          this.use(L);
          if (L.kind === 1) this.fillPink(len);
          else if (L.kind === 2) this.fillBrown(len);
          else if (L.kind === 3) this.fillVelvet(len);
          else this.fillWhite(len);
          this.mixBlock(len);
        }
        for (let i = 0; i < ls.length; i++) {
          const L = ls[i];
          if (L.share < 0) continue;
          this.use(L);
          this.copyShared(ls[L.share], len);
        }
        for (let i = 0; i < ls.length; i++) {
          this.use(ls[i]);
          this.finishBlock(outputs[i], at, len);
        }
        at += len;
      }
      if (live < n) this.quietAll(outputs, live, n);
      return live === n;
    }
  }

  registerProcessor("fresh-noise", FreshNoise);
}

export const NOISE_SOURCE = `(${installFreshNoise.toString()})()`;

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

async function addNoiseModule(ctx: BaseAudioContext): Promise<boolean> {
  const worklet = ctx.audioWorklet;
  if (!worklet) return false;
  try {
    const url = URL.createObjectURL(new Blob([NOISE_SOURCE], { type: "application/javascript" }));
    try {
      await worklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    return true;
  } catch {
    return false;
  }
}

/** Adds the processor once per context. False where there is no worklet, or the browser refuses the module. */
export function loadNoise(ctx: BaseAudioContext): Promise<boolean> {
  const have = loaded.get(ctx);
  if (have) return have;
  const pending = addNoiseModule(ctx);
  loaded.set(ctx, pending);
  return pending;
}

/** A group of noises that play until endNoise, one output each. One noise is a group of one. The module must already be loaded on `ctx`. */
export function noiseNode(ctx: BaseAudioContext, layers: { name: string; seed: number; share?: number }[]): AudioWorkletNode {
  const options = noiseGroupOptions(layers, ctx.sampleRate);
  return new AudioWorkletNode(ctx, "fresh-noise", {
    numberOfInputs: 0,
    numberOfOutputs: layers.length,
    outputChannelCount: options.layers.map((l) => l.channels),
    processorOptions: options,
  });
}

/** Silence from context time `when`, and let the audio thread drop the processor. */
export function endNoise(node: AudioWorkletNode, when: number): void {
  node.port.postMessage({ end: when });
}
