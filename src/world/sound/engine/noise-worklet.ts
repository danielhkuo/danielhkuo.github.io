// Continuous noise, made as it plays (design §14.8). The wind's four layers and the beds' plain noises come from an
// AudioWorklet that never repeats, so the page does not copy a new loop into an AudioBuffer a few times a second.
// The bubbles and the drops stay loops: they are sparse events, and copying them is cheap.
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

export function noiseOptions(name: string, seed: number, sampleRate: number): NoiseOptions {
  if (!isNoiseName(name)) throw new Error(`noise: ${name} is not made as it plays`);
  const layer = NOISE_LAYERS[name];
  const mix = stereoGains(layer.rho);
  const velvet = layer.colour === "velvet";
  // The coloured noise is brought to NOISE_RMS here, on the main thread, the way level() does it for a buffer.
  // Velvet is a gain, not a noise: the same two one-poles, divided by the deviation their impulse response has.
  const gain = velvet ? 1 / grainDeviation(grainK(sampleRate)) : colourGain(layer.colour, sampleRate);
  return {
    name,
    channels: layer.channels,
    seed,
    colour: layer.colour,
    gain,
    leak: layer.colour === "brown" ? brownLeak(sampleRate) : 0,
    grainK: velvet ? grainK(sampleRate) : 0,
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

  class FreshNoise extends AudioWorkletProcessor {
    /** Context time from which the output is silence and process returns false, so the node can be collected. */
    endAt = Infinity;
    channels = 1;
    /** 0 white, 1 pink, 2 brown, 3 velvet. */
    kind = 0;
    nf = 0;
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

    constructor(options: AudioWorkletNodeOptions) {
      super(options);
      const raw = options.processorOptions;
      if (typeof raw !== "object" || raw === null) throw new Error("fresh-noise: no options");
      const colour = (raw as Record<string, unknown>).colour;
      this.channels = num(raw, "channels") === 1 ? 1 : 2;
      this.kind = colour === "pink" ? 1 : colour === "brown" ? 2 : colour === "velvet" ? 3 : 0;
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
      this.u = u;
      this.poles = nums(raw, "pinkPoles");
      this.weights = nums(raw, "pinkWeights");
      this.coef = biquadsOf(raw);
      this.nf = this.coef.length / 5;
      const ch = this.channels;
      // xorshift32, one word per channel, from the same mix as the old four-word seed:
      // mix32(seed ^ (c + 1) * 0x9e3779b1). A zero word would stick, so that one mix is replaced.
      // Warmed so the first sample is not the raw seed. The period is 2^32 − 1 draws, two samples each.
      this.rng = new Uint32Array(ch);
      const seed = num(raw, "seed") >>> 0;
      for (let c = 0; c < ch; c++) {
        let s = mix32((seed ^ Math.imul(c + 1, 0x9e3779b1)) >>> 0);
        if (s === 0) s = (0x6d2b79f5 ^ (c + 1)) >>> 0;
        for (let k = 0; k < 12; k++) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
        }
        this.rng[c] = s >>> 0;
      }
      this.pinkS = new Float64Array(ch * 7);
      this.brown = new Float64Array(ch);
      this.grain = new Float64Array(ch * 2);
      this.mem = new Float64Array(ch * this.nf * 4);
      this.pre0 = new Float32Array(BLOCK);
      this.pre1 = new Float32Array(BLOCK);
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

    /** Two one-poles, then gain, then the logistic grain. The exp is the grain's knee, not a noise sample. */
    fillVelvet(n: number): void {
      const g = GAUSS;
      const u = this.u;
      const k = u[U_GRAIN];
      const gain = u[U_GAIN];
      const floor = u[U_FLOOR];
      const span = u[U_SPAN];
      const slope = u[U_SLOPE];
      const knee = u[U_KNEE];
      const st = this.grain;
      const rng = this.rng;
      const n2 = n - (n & 1);
      const ch = this.channels;
      for (let c = 0; c < ch; c++) {
        const o = c === 0 ? this.pre0 : this.pre1;
        let s = rng[c];
        const base = c * 2;
        let a = st[base];
        let b = st[base + 1];
        for (let i = 0; i < n2; i += 2) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
          let w = g[s & GAUSS_MASK];
          a += k * (w - a);
          b += k * (a - b);
          o[i] = floor + span / (1 + Math.exp(-slope * (b * gain - knee)));
          w = g[(s >>> GAUSS_SHIFT) & GAUSS_MASK];
          a += k * (w - a);
          b += k * (a - b);
          o[i + 1] = floor + span / (1 + Math.exp(-slope * (b * gain - knee)));
        }
        if (n !== n2) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
          const w = g[s & GAUSS_MASK];
          a += k * (w - a);
          b += k * (a - b);
          o[n2] = floor + span / (1 + Math.exp(-slope * (b * gain - knee)));
        }
        rng[c] = s >>> 0;
        st[base] = a;
        st[base + 1] = b;
      }
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
     * Stereo mix, then the fixed biquads. L = a·n0 + b·n1 and R = b·n0 + a·n1; an unmixed pair (a = 1, b = 0) is copied.
     * A mono noise is the one channel, unmixed. Filters run per channel on the mixed block.
     */
    shapeBlock(out: Float32Array[], at: number, n: number): void {
      const ch = this.channels;
      const pre0 = this.pre0;
      const pre1 = this.pre1;
      const u = this.u;
      const a = u[U_A];
      const b = u[U_B];
      if (ch === 2 && (a !== 1 || b !== 0)) {
        for (let i = 0; i < n; i++) {
          const x = pre0[i];
          const y = pre1[i];
          pre0[i] = a * x + b * y;
          pre1[i] = b * x + a * y;
        }
      }
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

    quiet(out: Float32Array[], from: number, to: number): void {
      const ch = this.channels;
      for (let c = 0; c < ch; c++) {
        const o = out[c];
        for (let i = from; i < to; i++) o[i] = 0;
      }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      const n = out[0].length;
      const start = currentTime;
      // From the posted context time on, the block is silence and the processor stops, so nothing keeps the node.
      if (!(start < this.endAt)) {
        this.quiet(out, 0, n);
        return false;
      }
      const rate = sampleRate;
      let live = n;
      if (start + n / rate > this.endAt) {
        live = Math.ceil((this.endAt - start) * rate);
        if (live < 0) live = 0;
        else if (live > n) live = n;
      }
      const kind = this.kind;
      const cap = this.pre0.length;
      let at = 0;
      while (at < live) {
        let len = live - at;
        if (len > cap) len = cap;
        if (kind === 1) this.fillPink(len);
        else if (kind === 2) this.fillBrown(len);
        else if (kind === 3) this.fillVelvet(len);
        else this.fillWhite(len);
        this.shapeBlock(out, at, len);
        at += len;
      }
      if (live < n) this.quiet(out, live, n);
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

/** A noise that plays until endNoise. The module must already be loaded on `ctx`. */
export function noiseNode(ctx: BaseAudioContext, name: string, seed: number): AudioWorkletNode {
  const options = noiseOptions(name, seed, ctx.sampleRate);
  return new AudioWorkletNode(ctx, "fresh-noise", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [options.channels],
    processorOptions: options,
  });
}

/** Silence from context time `when`, and let the audio thread drop the processor. */
export function endNoise(node: AudioWorkletNode, when: number): void {
  node.port.postMessage({ end: when });
}
