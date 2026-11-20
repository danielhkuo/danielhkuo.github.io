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
 */
function installFreshNoise(): void {
  "use strict";

  /** lowbias32, so a channel's four seeds do not sit next to each other. */
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

  class FreshNoise extends AudioWorkletProcessor {
    /** Context time from which the output is silence and process returns false, so the node can be collected. */
    endAt = Infinity;
    channels = 1;
    /** 0 white, 1 pink, 2 brown, 3 velvet. */
    kind = 0;
    gain = 1;
    leak = 0;
    grainK = 0;
    floor = 0;
    span = 0;
    slope = 0;
    knee = 0;
    a = 1;
    b = 0;
    feed = 0;
    delay = 0;
    nf = 0;
    rng!: Float64Array;
    spare!: Float64Array;
    have!: Float64Array;
    pinkS!: Float64Array;
    poles!: Float64Array;
    weights!: Float64Array;
    brown!: Float64Array;
    grain!: Float64Array;
    coef!: Float64Array;
    mem!: Float64Array;
    pre!: Float64Array;

    constructor(options: AudioWorkletNodeOptions) {
      super(options);
      const raw = options.processorOptions;
      if (typeof raw !== "object" || raw === null) throw new Error("fresh-noise: no options");
      const colour = (raw as Record<string, unknown>).colour;
      this.channels = num(raw, "channels") === 1 ? 1 : 2;
      this.kind = colour === "pink" ? 1 : colour === "brown" ? 2 : colour === "velvet" ? 3 : 0;
      this.gain = num(raw, "gain");
      this.leak = num(raw, "leak");
      this.grainK = num(raw, "grainK");
      this.floor = num(raw, "floor");
      this.span = num(raw, "span");
      this.slope = num(raw, "slope");
      this.knee = num(raw, "knee");
      this.a = num(raw, "a");
      this.b = num(raw, "b");
      this.feed = num(raw, "pinkFeed");
      this.delay = num(raw, "pinkDelay");
      this.poles = nums(raw, "pinkPoles");
      this.weights = nums(raw, "pinkWeights");
      this.coef = biquadsOf(raw);
      this.nf = this.coef.length / 5;
      const ch = this.channels;
      // One sfc32 per channel, warmed the way the world's rng is, so the first samples are not the raw seed.
      this.rng = new Float64Array(ch * 4);
      const seed = num(raw, "seed") >>> 0;
      for (let c = 0; c < ch; c++) {
        const s = mix32((seed ^ Math.imul(c + 1, 0x9e3779b1)) >>> 0);
        const i = c * 4;
        this.rng[i] = s;
        this.rng[i + 1] = mix32((s ^ 0x85ebca6b) >>> 0);
        this.rng[i + 2] = mix32((s ^ 0xc2b2ae35) >>> 0);
        this.rng[i + 3] = 1;
      }
      this.spare = new Float64Array(ch);
      this.have = new Float64Array(ch);
      this.pinkS = new Float64Array(ch * 7);
      this.brown = new Float64Array(ch);
      this.grain = new Float64Array(ch * 2);
      this.mem = new Float64Array(ch * this.nf * 4);
      this.pre = new Float64Array(ch);
      for (let c = 0; c < ch; c++) for (let k = 0; k < 12; k++) this.rand(c);
      // The end is a context time, posted from the main thread. Before it arrives the noise runs on.
      this.port.onmessage = (e: MessageEvent) => {
        const data = e.data;
        if (typeof data === "object" && data !== null && typeof (data as { end?: unknown }).end === "number") this.endAt = (data as { end: number }).end;
      };
    }

    /** sfc32, one state per channel. Returns a float in [0, 1). */
    rand(c: number): number {
      const r = this.rng;
      const i = c * 4;
      const b = r[i + 1];
      const c0 = r[i + 2];
      const d0 = r[i + 3];
      const t = (((r[i] + b) | 0) + d0) | 0;
      r[i] = b ^ (b >>> 9);
      r[i + 1] = (c0 + (c0 << 3)) | 0;
      r[i + 2] = (((c0 << 21) | (c0 >>> 11)) + t) | 0;
      r[i + 3] = (d0 + 1) | 0;
      return (t >>> 0) / 4294967296;
    }

    /** Standard normal. The second Box–Muller value is kept for the next call, so no uniform is thrown away. */
    gauss(c: number): number {
      if (this.have[c] !== 0) {
        this.have[c] = 0;
        return this.spare[c];
      }
      let u = this.rand(c);
      if (u < 1e-12) u = 1e-12;
      const v = this.rand(c);
      const rad = Math.sqrt(-2 * Math.log(u));
      const ang = 2 * Math.PI * v;
      this.spare[c] = rad * Math.sin(ang);
      this.have[c] = 1;
      return rad * Math.cos(ang);
    }

    /** Paul Kellet's filter, the same recurrence as pinkStep: six poles, then the delay from the previous sample. */
    pink(c: number, w: number): number {
      const s = this.pinkS;
      const base = c * 7;
      const poles = this.poles;
      const weights = this.weights;
      let y = w * this.feed + s[base + 6];
      for (let k = 0; k < 6; k++) {
        const v = poles[k] * s[base + k] + w * weights[k];
        s[base + k] = v;
        y += v;
      }
      s[base + 6] = w * this.delay;
      return y;
    }

    /** One channel, coloured and levelled. Velvet is the logistic grain instead of a levelled noise. */
    sample(c: number): number {
      const w = this.gauss(c);
      if (this.kind === 3) {
        const g = this.grain;
        const i = c * 2;
        const k = this.grainK;
        g[i] += k * (w - g[i]);
        g[i + 1] += k * (g[i] - g[i + 1]);
        const z = g[i + 1] * this.gain;
        const open = 1 / (1 + Math.exp(-this.slope * (z - this.knee)));
        return this.floor + this.span * open;
      }
      let y = w;
      if (this.kind === 1) y = this.pink(c, w);
      else if (this.kind === 2) {
        y = this.leak * this.brown[c] + w;
        this.brown[c] = y;
      }
      return y * this.gain;
    }

    /** Direct form I, the same sum filters.ts runs. No filters (the plain noises, the grain) returns the sample. */
    shape(c: number, input: number): number {
      const nf = this.nf;
      if (nf === 0) return input;
      const coef = this.coef;
      const st = this.mem;
      let v = input;
      for (let f = 0; f < nf; f++) {
        const cs = f * 5;
        const ss = (c * nf + f) * 4;
        const x1 = st[ss];
        const x2 = st[ss + 1];
        const y1 = st[ss + 2];
        const y2 = st[ss + 3];
        const y = coef[cs] * v + coef[cs + 1] * x1 + coef[cs + 2] * x2 - coef[cs + 3] * y1 - coef[cs + 4] * y2;
        st[ss] = v;
        st[ss + 1] = x1;
        st[ss + 2] = y;
        st[ss + 3] = y1;
        v = y;
      }
      return v;
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
      const ch = this.channels;
      const a = this.a;
      const b = this.b;
      const pre = this.pre;
      for (let i = 0; i < live; i++) {
        for (let c = 0; c < ch; c++) pre[c] = this.sample(c);
        if (ch === 1) out[0][i] = this.shape(0, pre[0]);
        else {
          const n0 = pre[0];
          const n1 = pre[1];
          out[0][i] = this.shape(0, a * n0 + b * n1);
          out[1][i] = this.shape(1, b * n0 + a * n1);
        }
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
