// Rain (design §14.2): a bed made when a shower is falling and let go two seconds after it has passed. Weather all
// round: on the water bus (mist and the bells' duck reach it as they reach the sea). Three layers:
//
//   patter: the drops loop, read three times (each at its own rate, set at its own place across) → gain   drops on land
//   sheet:  pink noise → band-pass, wide → low-pass → gain                                                a heavy shower
//   water:  the brook's bubbles read fast, three times across, an octave apart → band-pass ┐
//           white noise → high-pass → shelf → (a share) ──────────────────── ┴→ gain                       drops on water
//
// No read comes round the same: every loop's pitch wanders slowly on one of the hub's drifts (a few tens of cents, so
// each pass of a loop is played a little faster or slower than the last), and the three reads of a layer run at rates
// that share no period. (Read plainly, the loops were heard to repeat every 4.4–4.9 s.) The drops are set left, middle
// and right, so the shower fills the space between the ears, not only the two sides.

import { rngFor } from "../../core/rng.ts";
import { RAIN } from "../levels.ts";
import { T } from "../mix.ts";
import { bandpass, bind, gain, highpass, highshelf, intoPan, loop, lowpass, panner, type Ctx } from "./graph.ts";
import type { Hub } from "./hub.ts";
import type { Kit } from "./kit.ts";
import type { Voice } from "./wind.ts";

export function buildRain(ctx: Ctx, kit: Kit, out: AudioNode, opts: { hub: Hub; seed: number; at: number }): Voice {
  const v: Voice = { steps: [], bindings: [], sources: [], nodes: [] };
  const rng = rngFor(opts.seed, "sound/rain/offsets");
  const keep = <N extends AudioNode>(n: N): N => {
    v.nodes.push(n);
    return n;
  };
  /** A loop of `name` from a seeded place at `rate`, its pitch wandering on drift channel `drift` by up to `cents`. */
  const read = (name: string, rate: number, drift: number, cents: number): AudioBufferSourceNode => {
    const buffer = kit.buffer(name);
    const s = keep(loop(ctx, buffer, rate));
    const wander = keep(gain(ctx, cents));
    opts.hub.drift.connect(wander, drift);
    wander.connect(s.detune);
    s.start(opts.at, rng.float() * buffer.duration);
    v.sources.push(s);
    return s;
  };
  /** Three reads of a mono loop, at RAIN.across's wanders and places and `rates`, summed into one stereo merger. */
  const across = (name: string, rate: number, rates: readonly number[]): ChannelMergerNode => {
    const merger = keep(ctx.createChannelMerger(2));
    RAIN.across.forEach((r, i) => {
      const p = panner(ctx, r.pan, merger);
      keep(p.left);
      keep(p.right);
      intoPan(read(name, rate * rates[i], r.drift, r.cents * RAIN.wanderCents), p);
    });
    return merger;
  };
  v.steps.push(() => {
    const patter = keep(gain(ctx, 0));
    across("drops", 1, RAIN.across.map((r) => r.rate)).connect(patter);
    patter.connect(out);
    v.bindings.push(bind(T.RAIN_PATTER, [patter.gain]));
  });
  v.steps.push(() => {
    const band = keep(bandpass(ctx, RAIN.sheetHz, RAIN.sheetQ));
    const top = keep(lowpass(ctx, RAIN.sheetTopHz));
    const sheet = keep(gain(ctx, 0));
    read("pink0", 1, 0, -RAIN.wanderCents).connect(band);
    band.connect(top);
    top.connect(sheet);
    sheet.connect(out);
    v.bindings.push(bind(T.RAIN_SHEET, [sheet.gain]));
  });
  v.steps.push(() => {
    // Drops on water: the brook's bubbles, read fast so they ring higher and closer together, and a fizz above them.
    const plinks = keep(bandpass(ctx, RAIN.plinkHz, RAIN.plinkQ));
    across("brook", RAIN.plinkRate, RAIN.plinkSpread).connect(plinks);
    const fizzBand = keep(highpass(ctx, RAIN.fizzHz));
    const fizzTop = keep(highshelf(ctx, RAIN.topHz, RAIN.topDb));
    const fizzLevel = keep(gain(ctx, RAIN.fizzShare));
    read("white0", 1, 1, RAIN.wanderCents).connect(fizzBand);
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
