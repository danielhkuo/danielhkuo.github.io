// Graph helpers and the master chain (design §6.1). The only places a filter or a pan is made: every low-pass and
// high-pass gets Q_FLAT_DB here, and every pan is a gain pair into a merger (one code path in every browser; a
// StereoPannerNode stays the documented fallback behind `panner`).

import { CLIP_KNEE, LIMITER, LIMITER_TRIM_DB, MASTER_HIGHPASS_HZ, Q_FLAT_DB, WIND_HIGHPASS_HZ, WORLD_LOWPASS_HZ } from "../levels.ts";
import { dbToGain, panPair } from "../space.ts";

export type Ctx = BaseAudioContext;

/** Asks for one value a render quantum on a parameter that only moves slowly (Firefox ignores it and runs a-rate). */
export function kRate(param: AudioParam): void {
  try {
    param.automationRate = "k-rate";
  } catch {
    // not settable here: a-rate is only a cost
  }
}

export function gain(ctx: Ctx, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function biquad(ctx: Ctx, type: BiquadFilterType, hz: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = Math.min(hz, ctx.sampleRate * 0.49);
  kRate(f.detune);
  kRate(f.frequency);
  return f;
}

/** A low-pass at `hz`. Q is in dB for this type: −3.01 is Butterworth. */
export function lowpass(ctx: Ctx, hz: number): BiquadFilterNode {
  const f = biquad(ctx, "lowpass", hz);
  f.Q.value = Q_FLAT_DB;
  return f;
}

/** A high-pass at `hz`. Q is in dB for this type: −3.01 is Butterworth. */
export function highpass(ctx: Ctx, hz: number): BiquadFilterNode {
  const f = biquad(ctx, "highpass", hz);
  f.Q.value = Q_FLAT_DB;
  return f;
}

/** A band-pass at `hz`; `q` is linear. */
export function bandpass(ctx: Ctx, hz: number, q: number): BiquadFilterNode {
  const f = biquad(ctx, "bandpass", hz);
  f.Q.value = q;
  return f;
}

/** A peaking bump of `db` at `hz`; `q` is linear. */
export function peaking(ctx: Ctx, hz: number, db: number, q: number): BiquadFilterNode {
  const f = biquad(ctx, "peaking", hz);
  f.Q.value = q;
  f.gain.value = db;
  return f;
}

export function highshelf(ctx: Ctx, hz: number, db: number): BiquadFilterNode {
  const f = biquad(ctx, "highshelf", hz);
  f.gain.value = db;
  return f;
}

/** A looping source on `buffer`, not yet started. */
export function loop(ctx: Ctx, buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.playbackRate.value = rate;
  return s;
}

/** A pan: mono in, stereo out. Two gains (the cos and sin of the pan angle) into a merger. */
export interface Pan {
  left: GainNode;
  right: GainNode;
  out: ChannelMergerNode;
}

/** Makes a pan at `value` (−1 … 1). Connect the source to both `left` and `right` (see `intoPan`). */
export function panner(ctx: Ctx, value: number, out?: ChannelMergerNode): Pan {
  const merger = out ?? ctx.createChannelMerger(2);
  const [l, r] = panPair(value);
  const left = gain(ctx, l), right = gain(ctx, r);
  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);
  return { left, right, out: merger };
}

export function intoPan(node: AudioNode, pan: Pan): void {
  node.connect(pan.left);
  node.connect(pan.right);
}

/** The soft clip: linear to the knee, then bending toward 1. */
export function clipCurve(n = 4097): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * i) / (n - 1) - 1;
    const a = Math.abs(x);
    c[i] = a <= CLIP_KNEE ? x : Math.sign(x) * (CLIP_KNEE + (1 - CLIP_KNEE) * Math.tanh((a - CLIP_KNEE) / (1 - CLIP_KNEE)));
  }
  return c;
}

export const BUSES = ["wind", "water", "life", "moments", "bells"] as const;
export type Bus = (typeof BUSES)[number];

export interface Master {
  /** Where each family of voices connects. Wind goes round the world bus: it is at the listener. */
  bus: Record<Bus, GainNode>;
  /** Where the wind's layers connect: a high-pass that leads into the wind bus. */
  windIn: AudioNode;
  /** The reverb's send bus (the convolver joins it with the bells). */
  send: GainNode;
  world: GainNode;
  /** Everything, before the master chain: the calibration tone goes in here. */
  sum: GainNode;
  volume: GainNode;
  limiter: DynamicsCompressorNode;
  /** 0 when off, hidden or not yet enabled; every fade of §6.7 that is not a voice's own is made here. */
  mute: GainNode;
  nodes: AudioNode[];
}

/**
 * wind ──────────────────────────────────────────────┐
 * water, life, moments, bells → world → world low-pass ┴→ sum → high-pass 25 Hz → volume → limiter → trim → soft clip
 *                                                        → mute → destination
 */
export function buildMaster(ctx: Ctx): Master {
  const bus = {} as Record<Bus, GainNode>;
  for (const name of BUSES) bus[name] = gain(ctx, 1);
  const windIn = highpass(ctx, WIND_HIGHPASS_HZ);
  windIn.connect(bus.wind);
  const world = gain(ctx, 1);
  const worldLow = lowpass(ctx, WORLD_LOWPASS_HZ);
  const send = gain(ctx, 1);
  const sum = gain(ctx, 1);
  const rumble = highpass(ctx, MASTER_HIGHPASS_HZ);
  const volume = gain(ctx, 0);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.thresholdDb;
  limiter.knee.value = LIMITER.kneeDb;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attackS;
  limiter.release.value = LIMITER.releaseS;
  const trim = gain(ctx, dbToGain(LIMITER_TRIM_DB));
  const clip = ctx.createWaveShaper();
  clip.curve = clipCurve();
  clip.oversample = "none";
  const mute = gain(ctx, 0);

  for (const name of BUSES) bus[name].connect(name === "wind" ? sum : world);
  world.connect(worldLow);
  worldLow.connect(sum);
  sum.connect(rumble);
  rumble.connect(volume);
  volume.connect(limiter);
  limiter.connect(trim);
  trim.connect(clip);
  clip.connect(mute);
  mute.connect(ctx.destination);
  return { bus, windIn, send, world, sum, volume, limiter, mute, nodes: [...BUSES.map((b) => bus[b]), windIn, world, worldLow, send, sum, rumble, volume, limiter, trim, clip, mute] };
}

/** One target of the mix bound to the parameters that carry it. */
export interface Binding {
  /** Index into the mix's targets. */
  i: number;
  params: AudioParam[];
  /** The value parameter k takes for target value v. */
  map(v: number, k: number): number;
  /** The target last sent; NaN before the first. */
  sent: number;
}

export function bind(i: number, params: AudioParam[], map: (v: number, k: number) => number = (v) => v): Binding {
  return { i, params, map, sent: NaN };
}

/** A frequency target carried as the detune (cents) of filters whose own frequency is `base` Hz: cutoffs move in log frequency. */
export function bindHz(i: number, filters: BiquadFilterNode[], base: number): Binding {
  return bind(i, filters.map((f) => f.detune), (v) => 1200 * Math.log2(Math.max(v, 1) / base));
}

/** A pan target carried by a gain pair. */
export function bindPan(i: number, pan: Pan): Binding {
  return bind(i, [pan.left.gain, pan.right.gain], (v, k) => panPair(v)[k]);
}
