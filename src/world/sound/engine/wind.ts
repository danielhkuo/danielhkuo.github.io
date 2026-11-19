// Wind and the turn whoosh (design §4.1, §4.2; Recipes §1, §2): five layers of noise, each with its own filter, and
// three prerendered control signals moving them, so nothing sits still and nothing is periodic. Persistent; every
// layer's level gain starts at 0 and is moved only by the mix's targets.
//
//   A  ear buffet   brown (each ear its own) → high-pass 45 Hz → low-pass → peaking 250 Hz → per ear [flutter] → [level]
//   B  rush         pink ρ0.7 → band-pass (the gust moves its centre ±15 %) → high shelf → [gust swell] → [level]
//   C  hiss         white ρ0.7 → high-pass 2.5 kHz → low-pass → [level]
//   D  whistles     pink (one source) → three narrow band-passes → [squall] → fixed pans → [level]     (not on touch)
//   E  ground breeze pink ρ0.7 → band-pass 400 Hz → low-pass 1.5 kHz → [gust] → [level]
//   W  whoosh       pink (mono) → band-pass → [level] → pan
//
// Built a layer at a time (`steps`), so no frame pays for the whole graph.

import { rngFor } from "../../core/rng.ts";
import {
  A_CUT_HZ, A_FLUTTER, A_HIGHPASS_HZ, A_PEAK, B_GUST, B_HZ, B_Q, B_SHELF, B_SWELL, C_HIGHPASS_HZ, C_LOW, D_GUST, D_HZ, D_PAN, D_Q, E_BAND, E_GUST, E_LOWPASS_HZ, W_HZ, W_Q,
} from "../levels.ts";
import { T } from "../mix.ts";
import { CONTROL_PLAYBACK } from "../synth/controls.ts";
import { bandpass, bind, bindHz, bindPan, gain, highpass, highshelf, intoPan, kRate, loop, lowpass, panner, peaking, type Binding, type Ctx } from "./graph.ts";
import type { Kit } from "./kit.ts";

export interface Voice {
  /** Build steps still to run, one a frame (all at once offline). */
  steps: (() => void)[];
  bindings: Binding[];
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

/** Cents either side of its centre that a share `x` (0.15 for ±15 %) moves a filter. */
const cents = (x: number) => 1200 * Math.log2(1 + x);

export function buildWind(ctx: Ctx, kit: Kit, out: AudioNode, opts: { touch: boolean; seed: number; at: number }): Voice {
  const v: Voice = { steps: [], bindings: [], sources: [], nodes: [] };
  const rng = rngFor(opts.seed, "sound/wind/offsets");
  const keep = <N extends AudioNode>(n: N): N => {
    v.nodes.push(n);
    return n;
  };
  /** A noise loop read from its own place, a shade off speed, so no two layers loop together. */
  const noise = (name: string): AudioBufferSourceNode => {
    const buffer = kit.buffer(name);
    const s = keep(loop(ctx, buffer, 0.97 + 0.06 * rng.float()));
    s.start(opts.at, rng.float() * buffer.duration);
    v.sources.push(s);
    return s;
  };
  /** A control loop, played at a tenth of its rate, split into its channels. */
  const control = (name: string): ChannelSplitterNode => {
    const buffer = kit.buffer(name);
    const s = keep(loop(ctx, buffer, CONTROL_PLAYBACK));
    s.start(opts.at, rng.float() * buffer.duration);
    v.sources.push(s);
    const split = keep(ctx.createChannelSplitter(Math.max(2, buffer.numberOfChannels)));
    s.connect(split);
    return split;
  };
  /** Channel `ch` of a control, scaled by `depth`, added to `param`. */
  const drive = (split: ChannelSplitterNode, ch: number, depth: number, param: AudioParam) => {
    const g = keep(gain(ctx, depth));
    split.connect(g, ch);
    g.connect(param);
  };

  let gust: ChannelSplitterNode, whistle: ChannelSplitterNode;

  v.steps.push(() => {
    gust = control("gust");
    whistle = control("whistle");
  });

  // A: the ear buffet, in two steps.
  let aSplit: ChannelSplitterNode, aLow: BiquadFilterNode;
  v.steps.push(() => {
    const src = noise("brown0");
    const high = keep(highpass(ctx, A_HIGHPASS_HZ));
    aLow = keep(lowpass(ctx, A_CUT_HZ));
    const peak = keep(peaking(ctx, A_PEAK.hz, A_PEAK.db, A_PEAK.q));
    aSplit = keep(ctx.createChannelSplitter(2));
    src.connect(high);
    high.connect(aLow);
    aLow.connect(peak);
    peak.connect(aSplit);
  });
  v.steps.push(() => {
    const flutter = control("flutter");
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

  // B: the rush. The filter's own frequency sits at the bottom of the gust's reach; the gust (0 … 1) lifts it.
  v.steps.push(() => {
    const src = noise("pink7");
    const base = B_HZ / (1 + B_GUST);
    const band = keep(bandpass(ctx, base, B_Q));
    drive(gust, 0, 2 * cents(B_GUST), band.detune);
    const shelf = keep(highshelf(ctx, B_SHELF.hz, B_SHELF.db));
    const swell = keep(gain(ctx, B_SWELL[0]));
    drive(gust, 0, B_SWELL[1], swell.gain);
    const lev = keep(gain(ctx, 0));
    src.connect(band);
    band.connect(shelf);
    shelf.connect(swell);
    swell.connect(lev);
    lev.connect(out);
    v.bindings.push(bind(T.B_GAIN, [lev.gain]), bind(T.B_HZ, [band.detune], (hz) => 1200 * Math.log2(Math.max(hz, 1) / B_HZ)));
  });

  // C: the hiss.
  v.steps.push(() => {
    const src = noise("white7");
    const high = keep(highpass(ctx, C_HIGHPASS_HZ));
    const base = C_LOW[0] + C_LOW[1];
    const low = keep(lowpass(ctx, base));
    const lev = keep(gain(ctx, 0));
    src.connect(high);
    high.connect(low);
    low.connect(lev);
    lev.connect(out);
    v.bindings.push(bind(T.C_GAIN, [lev.gain]), bindHz(T.C_HZ, [low], base));
  });

  // D: three whistles off one source, each opened by its own squall and bent by its own gust.
  if (!opts.touch) {
    let dSrc: AudioBufferSourceNode, dMerge: ChannelMergerNode;
    const bands: BiquadFilterNode[] = [];
    v.steps.push(() => {
      dSrc = noise("pink1");
      dMerge = keep(ctx.createChannelMerger(2));
    });
    for (let i = 0; i < 3; i++) {
      v.steps.push(() => {
        const band = keep(bandpass(ctx, D_HZ[i], D_Q[i]));
        drive(whistle, 2 * i, cents(D_GUST), band.detune);
        const open = keep(gain(ctx, 0));
        whistle.connect(open.gain, 2 * i + 1);
        const pan = panner(ctx, D_PAN[i], dMerge);
        keep(pan.left);
        keep(pan.right);
        dSrc.connect(band);
        band.connect(open);
        intoPan(open, pan);
        bands.push(band);
        if (i === 2) {
          const lev = keep(gain(ctx, 0));
          dMerge.connect(lev);
          lev.connect(out);
          v.bindings.push(bind(T.D_GAIN, [lev.gain]), bind(T.D_RATIO, bands.map((b) => b.detune), (ratio) => 1200 * Math.log2(ratio)));
        }
      });
    }
  }

  // E: the ground breeze, riding the wind the third whistle hears (unrelated to the main gust).
  v.steps.push(() => {
    const src = noise("pink7");
    const band = keep(bandpass(ctx, E_BAND.hz, E_BAND.q));
    const low = keep(lowpass(ctx, E_LOWPASS_HZ));
    const swell = keep(gain(ctx, E_GUST[0]));
    drive(whistle, 4, E_GUST[1], swell.gain);
    const lev = keep(gain(ctx, 0));
    src.connect(band);
    band.connect(low);
    low.connect(swell);
    swell.connect(lev);
    lev.connect(out);
    v.bindings.push(bind(T.E_GAIN, [lev.gain]));
  });

  // W: the turn whoosh.
  v.steps.push(() => {
    const src = noise("pink1");
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
    v.bindings.push(bind(T.W_GAIN, [lev.gain]), bindHz(T.W_HZ, [band], W_HZ[0]), bindPan(T.W_PAN, pan));
  });

  return v;
}
