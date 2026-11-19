// Rain (design §13): a bed made when a shower is falling and let go two seconds after it has passed. It is weather
// all round, so it pans nowhere: each channel has its own noise, wide as the wind's buffet. Three layers, on the
// water bus (mist and the bells' duck reach it as they reach the sea):
//
//   patter: white noise let through in grains (the velvet's knocks, read fast) → band-pass → gain    drops on the land
//   sheet:  pink noise → band-pass, wide → shelf → gain                                              a heavy shower's hiss
//   fizz:   the brook's bubbles read fast (each a plink) → band-pass ┐
//           white noise → high-pass ───────────────────────────────── ┴→ shelf → gain                drops on the water
//
// The shelves take 9 dB off the sheet and the fizz above 7 kHz, where the surf's breaks are sharpest; the drops keep
// their top, which is what makes them drops.
//
// No impulses: a drop is a knock in a grain, not a click (single impulses read as clicks to the ear and the checker,
// as they did for the shingle).

import { rngFor } from "../../core/rng.ts";
import { RAIN } from "../levels.ts";
import { T } from "../mix.ts";
import { bandpass, bind, gain, highpass, highshelf, loop, lowpass, type Ctx } from "./graph.ts";
import type { Hub } from "./hub.ts";
import type { Kit } from "./kit.ts";
import type { Voice } from "./wind.ts";

/** x² for x ≥ 0 and 0 below, over the shaper's −1…1. */
function squareCurve(): Float32Array<ArrayBuffer> {
  const n = 1025;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (2 * i) / (n - 1) - 1;
    c[i] = x > 0 ? x * x : 0;
  }
  return c;
}

export function buildRain(ctx: Ctx, kit: Kit, out: AudioNode, opts: { hub: Hub; seed: number; at: number }): Voice {
  const v: Voice = { steps: [], bindings: [], sources: [], nodes: [] };
  const rng = rngFor(opts.seed, "sound/rain/offsets");
  const keep = <N extends AudioNode>(n: N): N => {
    v.nodes.push(n);
    return n;
  };
  const read = (name: string, rate = 1): AudioBufferSourceNode => {
    const buffer = kit.buffer(name);
    const s = keep(loop(ctx, buffer, rate));
    s.start(opts.at, rng.float() * buffer.duration);
    v.sources.push(s);
    return s;
  };
  v.steps.push(() => {
    // The patter: each channel of white noise opened by its own channel of the velvet, read fast (quicker knocks).
    const grainSplit = keep(ctx.createChannelSplitter(2));
    // The velvet's knocks made sparser: squared, its floor (0.36) falls 9 dB more and the knocks stand out of it, one
    // drop each. It is a smooth signal, so its square has no edge in it either. (Cubed, the drops were sharper still,
    // but tripped the click check in a light shower: 47 in 30 s.)
    const sparse = keep(ctx.createWaveShaper());
    sparse.curve = squareCurve();
    sparse.oversample = "none";
    read("velvet", RAIN.patterRate).connect(sparse);
    // Each knock's attack rounded to a few milliseconds: a drop, not a click.
    const round = keep(lowpass(ctx, RAIN.knockHz));
    sparse.connect(round);
    round.connect(grainSplit);
    const noiseSplit = keep(ctx.createChannelSplitter(2));
    read("white0").connect(noiseSplit);
    const grains = keep(ctx.createChannelMerger(2));
    for (let c = 0; c < 2; c++) {
      const g = keep(gain(ctx, 0));
      grainSplit.connect(g.gain, c);
      noiseSplit.connect(g, c);
      g.connect(grains, 0, c);
    }
    const band = keep(bandpass(ctx, RAIN.patterHz, RAIN.patterQ));
    const patter = keep(gain(ctx, 0));
    grains.connect(band);
    band.connect(patter);
    patter.connect(out);
    v.bindings.push(bind(T.RAIN_PATTER, [patter.gain]));
  });
  v.steps.push(() => {
    const band = keep(bandpass(ctx, RAIN.sheetHz, RAIN.sheetQ));
    const top = keep(highshelf(ctx, RAIN.topHz, RAIN.topDb));
    const sheet = keep(gain(ctx, 0));
    read("pink0").connect(band);
    band.connect(top);
    top.connect(sheet);
    sheet.connect(out);
    v.bindings.push(bind(T.RAIN_SHEET, [sheet.gain]));
  });
  v.steps.push(() => {
    // Drops on water: the brook's bubbles, read fast so they ring higher and closer together, and a fizz above them.
    const plinks = keep(bandpass(ctx, RAIN.plinkHz, RAIN.plinkQ));
    // The bubbles are one channel: two reads, apart in time and a little in rate, make the left and the right.
    const wide = keep(ctx.createChannelMerger(2));
    read("brook", RAIN.plinkRate).connect(wide, 0, 0);
    read("brook", RAIN.plinkRate * 1.07).connect(wide, 0, 1);
    wide.connect(plinks);
    const fizzBand = keep(highpass(ctx, RAIN.fizzHz));
    const fizzLevel = keep(gain(ctx, RAIN.fizzShare));
    read("white0").connect(fizzBand);
    fizzBand.connect(fizzLevel);
    const top = keep(highshelf(ctx, RAIN.topHz, RAIN.topDb));
    const fizz = keep(gain(ctx, 0));
    plinks.connect(top);
    fizzLevel.connect(top);
    top.connect(fizz);
    fizz.connect(out);
    v.bindings.push(bind(T.RAIN_FIZZ, [fizz.gain]));
  });
  return v;
}
