// Wind and the turn whoosh (design §4.1, §4.2; Recipes §1, §2): five layers of noise, each with its own filter, and
// the hub's control signals moving them, so nothing sits still and nothing is periodic. Every level gain starts at 0
// and is moved only by the mix's targets. Each layer's fixed filters are already in its noise buffer (synth/make.ts);
// what is built here is the part that moves.
//
//   A  ear buffet   buffet (brown, each ear its own; high-passed, with its bump) → low-pass → per ear [flutter] → [level]
//   B  rush         rush (pink ρ0.7, shelved) → band-pass (the gust moves its centre ±15 %) → [gust swell] → [level]
//   C  hiss         hiss (white ρ0.7, high-passed) → low-pass → [level]
//   E  ground breeze breeze (pink ρ0.7 through its band) → [slow drift] → [level]   (each layer's pitch wanders)
//   D  whistles     pink (one source) → three narrow band-passes → [squall] → fixed pans → [level]     (a voice of its
//                   own, built only at speed; not on touch)
//   W  whoosh       pink (mono) → band-pass → [level] → pan                                            (a voice of its
//                   own, built only round a turn)
//
// Built a layer at a time (`steps`), so no frame pays for the whole graph.

import { rngFor } from "../../core/rng.ts";
import {
  A_CUT_HZ, A_FLUTTER, B_GUST, B_HZ, B_Q, B_SWELL, C_LOW, D_GUST, D_HZ, D_PAN, D_Q, E_GUST, LOOP_WANDER_CENTS, W_HZ, W_Q,
} from "../levels.ts";
import { T } from "../mix.ts";
import { CONTROL_PLAYBACK } from "../synth/controls.ts";
import { bandpass, bind, bindHz, bindPan, gain, intoPan, kRate, loop, lowpass, panner, type Binding, type Ctx } from "./graph.ts";
import type { Fresh } from "./fresh.ts";
import type { Hub } from "./hub.ts";
import type { Kit } from "./kit.ts";

export interface Voice {
  /** Build steps still to run, one a frame (all at once offline). */
  steps: (() => void)[];
  bindings: Binding[];
  /** Loops to stop when the voice is let go: a source, or a fresh read (it stops every generation it has going). */
  sources: { stop(when?: number): void }[];
  nodes: AudioNode[];
}

/** What a bed's builder is handed. `fresh` is the engine's one reader: generations are shared by every read of a name. */
export interface BedOpts {
  hub: Hub;
  seed: number;
  at: number;
  fresh: Fresh;
}

/** Cents either side of its centre that a share `x` (0.15 for ±15 %) moves a filter. */
const cents = (x: number) => 1200 * Math.log2(1 + x);

export function buildWind(ctx: Ctx, kit: Kit, out: AudioNode, opts: BedOpts): Voice {
  const v: Voice = { steps: [], bindings: [], sources: [], nodes: [] };
  const rng = rngFor(opts.seed, "sound/wind/offsets");
  const keep = <N extends AudioNode>(n: N): N => {
    v.nodes.push(n);
    return n;
  };
  /**
   * A noise loop read from its own place, moved onto a new generation before it can come round, its fade straight
   * into `into`. One wander gain for the life of the layer: every generation is bent by the same drift, and letting
   * one go only disconnects that source.
   */
  const noise = (name: string, wander: { ch: number; cents: number }, into: AudioNode): void => {
    const buffer = kit.buffer(name);
    const drift = keep(gain(ctx, wander.cents));
    opts.hub.drift.connect(drift, wander.ch);
    const read = opts.fresh.read(name, {
      at: opts.at,
      offset: rng.float() * buffer.duration,
      bed: "wind",
      into: [into],
      wire: (src) => {
        drift.connect(src.detune);
        // Once this generation has faded out and stopped, the drift lets it go (or it would keep every old source).
        return () => drift.disconnect(src.detune);
      },
    });
    v.sources.push(read);
  };
  /** Channel `ch` of a control, scaled by `depth`, added to `param`. */
  const drive = (split: ChannelSplitterNode, ch: number, depth: number, param: AudioParam) => {
    const g = keep(gain(ctx, depth));
    split.connect(g, ch);
    g.connect(param);
  };

  const hub = opts.hub;
  const gust = hub.gust;

  // A: the ear buffet, in two steps. (Its high-pass and its bump are in the buffer.)
  let aSplit: ChannelSplitterNode, aLow: BiquadFilterNode;
  v.steps.push(() => {
    aLow = keep(lowpass(ctx, A_CUT_HZ));
    aSplit = keep(ctx.createChannelSplitter(2));
    noise("buffet", { ch: 1, cents: LOOP_WANDER_CENTS }, aLow);
    aLow.connect(aSplit);
  });
  v.steps.push(() => {
    const flutter = hub.flutter;
    const merge = keep(ctx.createChannelMerger(2));
    const levels: GainNode[] = [];
    for (let ear = 0; ear < 2; ear++) {
      const flap = keep(gain(ctx, A_FLUTTER[0]));
      drive(flutter, ear, A_FLUTTER[1], flap.gain);
      const lev = keep(gain(ctx, 0));
      aSplit.connect(flap, ear);
      flap.connect(lev);
      lev.connect(merge, 0, ear);
      levels.push(lev);
    }
    merge.connect(out);
    v.bindings.push(bind(T.A_L, [levels[0].gain]), bind(T.A_R, [levels[1].gain]), bindHz(T.A_HZ, [aLow], A_CUT_HZ));
  });

  // B: the rush. The filter's own frequency sits at the bottom of the gust's reach; the gust (0 … 1) lifts it. (Its
  // shelf is in the buffer.)
  v.steps.push(() => {
    const base = B_HZ / (1 + B_GUST);
    const band = keep(bandpass(ctx, base, B_Q));
    drive(gust, 0, 2 * cents(B_GUST), band.detune);
    const swell = keep(gain(ctx, B_SWELL[0]));
    drive(gust, 0, B_SWELL[1], swell.gain);
    const lev = keep(gain(ctx, 0));
    noise("rush", { ch: 0, cents: LOOP_WANDER_CENTS }, band);
    band.connect(swell);
    swell.connect(lev);
    lev.connect(out);
    v.bindings.push(bind(T.B_GAIN, [lev.gain]), bind(T.B_HZ, [band.detune], (hz) => 1200 * Math.log2(Math.max(hz, 1) / B_HZ)));
  });

  // C: the hiss. (Its high-pass is in the buffer.)
  v.steps.push(() => {
    const base = C_LOW[0] + C_LOW[1];
    const low = keep(lowpass(ctx, base));
    const lev = keep(gain(ctx, 0));
    noise("hiss", { ch: 0, cents: -LOOP_WANDER_CENTS }, low);
    low.connect(lev);
    lev.connect(out);
    v.bindings.push(bind(T.C_GAIN, [lev.gain]), bindHz(T.C_HZ, [low], base));
  });

  // E: the ground breeze, riding the slower drift (unrelated to the main gust). Its band and low-pass are in the
  // buffer: nothing of it is left to filter.
  v.steps.push(() => {
    // The drift runs −1 … 1: the swell moves between E_GUST[0] and E_GUST[0] + E_GUST[1] about their middle.
    const swell = keep(gain(ctx, E_GUST[0] + E_GUST[1] / 2));
    drive(hub.drift, 1, E_GUST[1] / 2, swell.gain);
    const lev = keep(gain(ctx, 0));
    noise("breeze", { ch: 1, cents: -LOOP_WANDER_CENTS }, swell);
    swell.connect(lev);
    lev.connect(out);
    v.bindings.push(bind(T.E_GAIN, [lev.gain]));
  });

  return v;
}

/**
 * W, the turn whoosh: a voice of its own, built as a turn begins (its level is still under −54 dB then, and rises no
 * faster than the bloom lets it) and let go two seconds after the dragon levels out.
 */
export function buildWhoosh(ctx: Ctx, kit: Kit, out: AudioNode, opts: BedOpts): Voice {
  const v: Voice = { steps: [], bindings: [], sources: [], nodes: [] };
  const rng = rngFor(opts.seed, "sound/whoosh/offsets");
  const keep = <N extends AudioNode>(n: N): N => {
    v.nodes.push(n);
    return n;
  };
  v.steps.push(() => {
    const buffer = kit.buffer("pink1");
    const src = keep(loop(ctx, buffer));
    src.start(opts.at, rng.float() * buffer.duration);
    v.sources.push(src);
    const band = keep(bandpass(ctx, W_HZ[0], W_Q));
    const lev = keep(gain(ctx, 0));
    const pan = panner(ctx, 0);
    keep(pan.left);
    keep(pan.right);
    keep(pan.out);
    src.connect(band);
    band.connect(lev);
    intoPan(lev, pan);
    pan.out.connect(out);
    kRate(band.detune);
    const level = bind(T.W_GAIN, [lev.gain]);
    // Its level follows the mix at the whoosh's own pace from its first value: a voice just built is not eased in again.
    level.prompt = true;
    v.bindings.push(level, bindHz(T.W_HZ, [band], W_HZ[0]), bindPan(T.W_PAN, pan));
  });
  return v;
}

/**
 * D, the whistles: three narrow bands off one source, each opened by its own squall and bent by the gust. A voice of
 * its own: the engine builds it only when the dragon is fast enough for them to be heard (they sit 26 dB under the
 * rush at cruise), and lets it go when it slows. Not on touch.
 */
export function buildWhistles(ctx: Ctx, kit: Kit, out: AudioNode, opts: BedOpts): Voice {
  const v: Voice = { steps: [], bindings: [], sources: [], nodes: [] };
  const rng = rngFor(opts.seed, "sound/whistles/offsets");
  const keep = <N extends AudioNode>(n: N): N => {
    v.nodes.push(n);
    return n;
  };
  let src: AudioBufferSourceNode, merge: ChannelMergerNode, squall: ChannelSplitterNode;
  const bands: BiquadFilterNode[] = [];
  v.steps.push(() => {
    const buffer = kit.buffer("pink1");
    src = keep(loop(ctx, buffer));
    src.start(opts.at, rng.float() * buffer.duration);
    v.sources.push(src);
    merge = keep(ctx.createChannelMerger(2));
    // Their squalls: three channels, played at a tenth of the rate like every control.
    const sq = kit.buffer("squall");
    const control = keep(loop(ctx, sq, CONTROL_PLAYBACK));
    control.start(opts.at, rng.float() * sq.duration);
    v.sources.push(control);
    squall = keep(ctx.createChannelSplitter(3));
    control.connect(squall);
  });
  for (let i = 0; i < 3; i++) {
    v.steps.push(() => {
      const band = keep(bandpass(ctx, D_HZ[i], D_Q[i]));
      const bend = keep(gain(ctx, cents(D_GUST)));
      opts.hub.gust.connect(bend, 0);
      bend.connect(band.detune);
      const open = keep(gain(ctx, 0));
      squall.connect(open.gain, i);
      const pan = panner(ctx, D_PAN[i], merge);
      keep(pan.left);
      keep(pan.right);
      src.connect(band);
      band.connect(open);
      intoPan(open, pan);
      bands.push(band);
      if (i === 2) {
        const lev = keep(gain(ctx, 0));
        merge.connect(lev);
        lev.connect(out);
        v.bindings.push(bind(T.D_GAIN, [lev.gain]), bind(T.D_RATIO, bands.map((b) => b.detune), (ratio) => 1200 * Math.log2(ratio)));
      }
    });
  }
  return v;
}
