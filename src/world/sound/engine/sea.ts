// The surf bed and the open sea (design §4.3): the water that cannot be resolved into waves. Persistent while they
// can be heard; the engine builds each when one of its gains passes −54 dB and lets it go after two seconds under
// −60 dB.
//
//   surf bed   brown → low-pass 180 Hz → [rumble]      pink → band-pass 600 Hz → [body]
//              white → high-pass 2.5 kHz → low-pass (the air between) → [hiss]
//              white × velvet (noise in grains) → band-pass 3.6 kHz → [rattle]
//              sum → its two channels (independent noise) → each [wander] → its own pan
//   open sea   pink → band-pass 700 Hz → [0.75 + 0.25 · drift] → [level]

import { rngFor } from "../../core/rng.ts";
import { BED, BED_WANDER, OPEN } from "../levels.ts";
import { T } from "../mix.ts";
import { bandpass, bind, bindHz, bindPan, gain, highpass, loop, lowpass, panner, type Ctx } from "./graph.ts";
import type { Hub } from "./hub.ts";
import type { Kit } from "./kit.ts";
import type { Voice } from "./wind.ts";

interface Parts {
  v: Voice;
  keep<N extends AudioNode>(n: N): N;
  noise(name: string): AudioBufferSourceNode;
}

function parts(ctx: Ctx, kit: Kit, seed: number, tag: string, at: number): Parts {
  const v: Voice = { steps: [], bindings: [], sources: [], nodes: [] };
  const rng = rngFor(seed, `sound/${tag}/offsets`);
  const keep = <N extends AudioNode>(n: N): N => {
    v.nodes.push(n);
    return n;
  };
  return {
    v,
    keep,
    noise(name) {
      const buffer = kit.buffer(name);
      const s = keep(loop(ctx, buffer));
      s.start(at, rng.float() * buffer.duration);
      v.sources.push(s);
      return s;
    },
  };
}

export function buildSurfBed(ctx: Ctx, kit: Kit, out: AudioNode, opts: { hub: Hub; seed: number; at: number }): Voice {
  const p = parts(ctx, kit, opts.seed, "bed", opts.at);
  const { v, keep } = p;
  let sum: GainNode;
  v.steps.push(() => {
    sum = keep(gain(ctx, 1));
    const rumbleLow = keep(lowpass(ctx, BED.rumbleHz));
    const rumble = keep(gain(ctx, 0));
    p.noise("brown0").connect(rumbleLow);
    rumbleLow.connect(rumble);
    rumble.connect(sum);
    const bodyBand = keep(bandpass(ctx, BED.bodyHz, BED.bodyQ));
    const body = keep(gain(ctx, 0));
    p.noise("pink0").connect(bodyBand);
    bodyBand.connect(body);
    body.connect(sum);
    v.bindings.push(bind(T.BED_RUMBLE, [rumble.gain]), bind(T.BED_BODY, [body.gain]));
  });
  v.steps.push(() => {
    const high = keep(highpass(ctx, BED.hissHz));
    const air = keep(lowpass(ctx, 1000));
    const hiss = keep(gain(ctx, 0));
    p.noise("white0").connect(high);
    high.connect(air);
    air.connect(hiss);
    hiss.connect(sum);
    // The rattle: noise let through in grains (each channel of the noise by its own channel of the velvet).
    const band = keep(bandpass(ctx, BED.rattleHz, BED.rattleQ));
    const rattle = keep(gain(ctx, 0));
    const grainSplit = keep(ctx.createChannelSplitter(2));
    p.noise("velvet").connect(grainSplit);
    const noiseSplit = keep(ctx.createChannelSplitter(2));
    p.noise("white0").connect(noiseSplit);
    const grains = keep(ctx.createChannelMerger(2));
    for (let c = 0; c < 2; c++) {
      const g = keep(gain(ctx, 0));
      grainSplit.connect(g.gain, c);
      noiseSplit.connect(g, c);
      g.connect(grains, 0, c);
    }
    grains.connect(band);
    band.connect(rattle);
    rattle.connect(sum);
    v.bindings.push(bind(T.BED_HISS, [hiss.gain]), bindHz(T.BED_AIR_HZ, [air], 1000), bind(T.BED_RATTLE, [rattle.gain]));
  });
  v.steps.push(() => {
    // The two halves: each channel of the sum wanders on its own drift and has its own pan.
    const drift = opts.hub.drift;
    const split = keep(ctx.createChannelSplitter(2));
    const merge = keep(ctx.createChannelMerger(2));
    sum.connect(split);
    const pans = [0, 1].map((half) => {
      const wander = keep(gain(ctx, 1));
      const depth = keep(gain(ctx, BED_WANDER));
      drift.connect(depth, half);
      depth.connect(wander.gain);
      split.connect(wander, half);
      const pan = panner(ctx, 0, merge);
      keep(pan.left);
      keep(pan.right);
      wander.connect(pan.left);
      wander.connect(pan.right);
      return pan;
    });
    merge.connect(out);
    v.bindings.push(bindPan(T.BED_PAN_A, pans[0]), bindPan(T.BED_PAN_B, pans[1]));
  });
  return v;
}

export function buildOpenSea(ctx: Ctx, kit: Kit, out: AudioNode, opts: { hub: Hub; seed: number; at: number }): Voice {
  const p = parts(ctx, kit, opts.seed, "open", opts.at);
  const { v, keep } = p;
  v.steps.push(() => {
    const band = keep(bandpass(ctx, OPEN.hz, OPEN.q));
    const swell = keep(gain(ctx, 0.75));
    const depth = keep(gain(ctx, 0.25));
    opts.hub.drift.connect(depth, 0);
    depth.connect(swell.gain);
    const lev = keep(gain(ctx, 0));
    p.noise("pink0").connect(band);
    band.connect(swell);
    swell.connect(lev);
    lev.connect(out);
    v.bindings.push(bind(T.OPEN, [lev.gain]));
  });
  return v;
}
