// Rain (design §14.2): a bed made when a shower is falling and let go two seconds after it has passed. Weather all
// round: on the water bus (mist and the bells' duck reach it as they reach the sea). Three layers:
//
//   patter: the drops loop, read three times (each at its own rate, set at its own place across) → gain   drops on land
//   sheet:  pink noise → band-pass, wide → low-pass → gain                                                a heavy shower
//   water:  rain's own bubbles (plinks), read three times across → band-pass ┐
//           white noise → high-pass → shelf → (a share) ──────────────────── ┴→ gain                       drops on water
//
// No read comes round the same: every loop's pitch wanders slowly on one of the hub's drifts (a few tens of cents, so
// each pass of a loop is played a little faster or slower than the last), and the three reads of a layer run at rates
// that share no period. (Read plainly, the loops were heard to repeat every 4.4–4.9 s.) The drops are set left, middle
// and right, so the shower fills the space between the ears, not only the two sides.

import { rngFor } from "../../core/rng.ts";
import { RAIN } from "../levels.ts";
import { T } from "../mix.ts";
import { bandpass, bind, gain, highpass, highshelf, lowpass, panner, type Ctx } from "./graph.ts";
import type { Kit } from "./kit.ts";
import type { BedOpts, Voice } from "./wind.ts";

export function buildRain(ctx: Ctx, kit: Kit, out: AudioNode, opts: BedOpts): Voice {
  const v: Voice = { steps: [], bindings: [], sources: [], nodes: [] };
  const rng = rngFor(opts.seed, "sound/rain/offsets");
  const keep = <N extends AudioNode>(n: N): N => {
    v.nodes.push(n);
    return n;
  };
  /**
   * A loop of `name` from a seeded place at `rate`, its pitch wandering on drift channel `drift` by up to `cents`,
   * each generation's fade straight into `into`. One wander gain for the read: each new generation is driven by it,
   * and unwire only disconnects that source.
   */
  const read = (name: string, rate: number, drift: number, cents: number, into: AudioNode[]): void => {
    const buffer = kit.buffer(name);
    const wander = keep(gain(ctx, cents));
    opts.hub.drift.connect(wander, drift);
    const handle = opts.fresh.read(name, {
      at: opts.at,
      offset: rng.float() * buffer.duration,
      rate,
      bed: "rain",
      into,
      wire: (src) => {
        wander.connect(src.detune);
        return () => wander.disconnect(src.detune);
      },
    });
    v.sources.push(handle);
  };
  /** Three reads of a mono loop, at RAIN.across's places and `rates`, wandering by up to `cents`, in one stereo merger. */
  const across = (name: string, rate: number, rates: readonly number[], cents: number): ChannelMergerNode => {
    const merger = keep(ctx.createChannelMerger(2));
    RAIN.across.forEach((r, i) => {
      const p = panner(ctx, r.pan, merger);
      keep(p.left);
      keep(p.right);
      read(name, rate * rates[i], r.drift, r.cents * cents, [p.left, p.right]);
    });
    return merger;
  };
  v.steps.push(() => {
    const patter = keep(gain(ctx, 0));
    across("drops", 1, RAIN.across.map((r) => r.rate), RAIN.wanderCents).connect(patter);
    patter.connect(out);
    v.bindings.push(bind(T.RAIN_PATTER, [patter.gain]));
  });
  // The sheet and the fizz are one worklet. The sheet's offset is drawn here, where it always was; the node itself
  // waits until the fizz's offset has been drawn after the plinks, so the loop path's places stay in order.
  let sheetBand: AudioNode;
  let sheetOffset = 0;
  v.steps.push(() => {
    const band = keep(bandpass(ctx, RAIN.sheetHz, RAIN.sheetQ));
    const top = keep(lowpass(ctx, RAIN.sheetTopHz));
    const sheet = keep(gain(ctx, 0));
    sheetBand = band;
    sheetOffset = rng.float() * kit.buffer("pink0").duration;
    band.connect(top);
    top.connect(sheet);
    sheet.connect(out);
    v.bindings.push(bind(T.RAIN_SHEET, [sheet.gain]));
  });
  v.steps.push(() => {
    // Drops on water: the bubbles each drop leaves, and a fizz above them.
    const plinks = keep(bandpass(ctx, RAIN.plinkHz, RAIN.plinkQ));
    across("plinks", RAIN.plinkRate, RAIN.plinkSpread, RAIN.plinkCents).connect(plinks);
    const fizzBand = keep(highpass(ctx, RAIN.fizzHz));
    const fizzTop = keep(highshelf(ctx, RAIN.topHz, RAIN.topDb));
    const fizzLevel = keep(gain(ctx, RAIN.fizzShare));
    const fizzOffset = rng.float() * kit.buffer("white0").duration;
    // Wander only on the fresh-loop path: a worklet has no detune, and the wire is what applies it.
    // One wander gain a layer, made on the first generation that wants it (a new one each move would stay on the hub).
    const wander = (drift: number, cents: number) => {
      let g: GainNode | null = null;
      return (src: AudioBufferSourceNode) => {
        if (!g) {
          g = keep(gain(ctx, cents));
          opts.hub.drift.connect(g, drift);
        }
        const mine = g;
        mine.connect(src.detune);
        return () => mine.disconnect(src.detune);
      };
    };
    v.sources.push(opts.fresh.group("rain", opts.at, [
      { name: "pink0", into: [sheetBand], offset: sheetOffset, rate: 1, wire: wander(0, -RAIN.wanderCents) },
      { name: "white0", into: [fizzBand], offset: fizzOffset, rate: 1, wire: wander(1, RAIN.wanderCents) },
    ]));
    fizzBand.connect(fizzTop);
    fizzTop.connect(fizzLevel);
    const water = keep(gain(ctx, 0));
    plinks.connect(water);
    fizzLevel.connect(water);
    water.connect(out);
    v.bindings.push(bind(T.RAIN_FIZZ, [water.gain]));
  });
  return v;
}
