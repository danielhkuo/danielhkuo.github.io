// The river bed (design §4.4): fresh water as bubbles. Persistent while it can be heard, as the surf bed is.
//
//   brook (read 1) → [brook] ─┐                                brook (read 2) → [brook] ─┐
//   flow  (read 1) → [flow]  ─┼→ half A → low-pass (air) → pan A      flow (read 2) → [flow] ─┼→ half B → low-pass (air) → pan B
//   pink (left) → band-pass 1.8 kHz → [riffle] ─┘              pink (right) → band-pass → [riffle] ─┘
//
// Each bubble bed is read twice, from seeded places at seeded rates a little off true (0.94–1.06), so the two halves
// never keep step and the river is wide. The riffle is the hiss of white water, the one part of a river that is noise.

import { rngFor } from "../../core/rng.ts";
import { RIVER } from "../levels.ts";
import { T } from "../mix.ts";
import { bandpass, bind, bindHz, bindPan, gain, lowpass, panner, type Ctx } from "./graph.ts";
import type { Kit } from "./kit.ts";
import type { BedOpts, Voice } from "./wind.ts";

export function buildRiverBed(ctx: Ctx, kit: Kit, out: AudioNode, opts: BedOpts): Voice {
  const v: Voice = { steps: [], bindings: [], sources: [], nodes: [] };
  const rng = rngFor(opts.seed, "sound/river/offsets");
  const keep = <N extends AudioNode>(n: N): N => {
    v.nodes.push(n);
    return n;
  };
  const read = (name: string, rate: number, into: AudioNode): void => {
    const buffer = kit.buffer(name);
    const handle = opts.fresh.read(name, { at: opts.at, offset: rng.float() * buffer.duration, rate, bed: "river", into: [into] });
    v.sources.push(handle);
  };
  const halves: GainNode[] = [];
  v.steps.push(() => {
    const brooks: AudioParam[] = [], flows: AudioParam[] = [];
    for (let half = 0; half < 2; half++) {
      const sum = keep(gain(ctx, 1));
      const rate = () => RIVER.rateLo + (RIVER.rateHi - RIVER.rateLo) * rng.float();
      const brook = keep(gain(ctx, 0)), flow = keep(gain(ctx, 0));
      read("brook", rate(), brook);
      read("flow", rate(), flow);
      brook.connect(sum);
      flow.connect(sum);
      brooks.push(brook.gain);
      flows.push(flow.gain);
      halves.push(sum);
    }
    v.bindings.push(bind(T.RIVER_BROOK, brooks), bind(T.RIVER_FLOW, flows));
  });
  v.steps.push(() => {
    const band = keep(bandpass(ctx, RIVER.riffleHz, RIVER.riffleQ));
    const riffle = keep(gain(ctx, 0));
    const split = keep(ctx.createChannelSplitter(2));
    v.sources.push(opts.fresh.group("river", opts.at, [{
      name: "pink0",
      into: [band],
      offset: rng.float() * kit.buffer("pink0").duration,
      rate: 1,
    }]));
    band.connect(riffle);
    riffle.connect(split);
    const merge = keep(ctx.createChannelMerger(2));
    const airs: BiquadFilterNode[] = [];
    for (let half = 0; half < 2; half++) {
      split.connect(halves[half], half);
      const air = keep(lowpass(ctx, 1000));
      const pan = panner(ctx, 0, merge);
      keep(pan.left);
      keep(pan.right);
      halves[half].connect(air);
      air.connect(pan.left);
      air.connect(pan.right);
      airs.push(air);
      v.bindings.push(bindPan(half === 0 ? T.RIVER_PAN_A : T.RIVER_PAN_B, pan));
    }
    merge.connect(out);
    v.bindings.push(bind(T.RIVER_RIFFLE, [riffle.gain]), bindHz(T.RIVER_AIR_HZ, airs, 1000));
  });
  return v;
}
