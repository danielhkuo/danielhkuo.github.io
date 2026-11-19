import assert from "node:assert/strict";
import { test } from "node:test";
import { mistLayer } from "../live/mist.ts";
import { nightLayer } from "../live/night.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { seaFrame } from "../testing/liveShot.ts";
import { airOf } from "./air.ts";
import { PHASES } from "./clock.ts";
import { createRain, splashLayer } from "./rain.ts";
import { parseWeather } from "./weather.ts";

// The frame fills the window (runtime/fit.ts), so it can be wide, tall or square, not only 400 × 225. Rain, splashes,
// stars and mist must reach every part of a frame of any size.

const N = 1280;
const palette = buildPalette(MIDDAY);
const SIZES: readonly [number, number][] = [[400, 225], [700, 300], [220, 560], [520, 290]];
const BLOCK = 100;

/** How many BLOCK × BLOCK blocks of a w × h frame have no pixel changed between `a` and `b`. */
function emptyBlocks(a: Uint32Array, b: Uint32Array, w: number, h: number): number {
  let empty = 0;
  for (let by = 0; by + BLOCK <= h; by += BLOCK) for (let bx = 0; bx + BLOCK <= w; bx += BLOCK) {
    let any = false;
    for (let y = by; y < by + BLOCK && !any; y++) for (let x = bx; x < bx + BLOCK; x++) if (a[y * w + x] !== b[y * w + x]) { any = true; break; }
    if (!any) empty++;
  }
  return empty;
}

test("rain falls over the whole of a frame of any size", () => {
  const air = airOf(0.5, 0.25, parseWeather("rain") ?? undefined);
  for (const [w, h] of SIZES) {
    const before = new Uint32Array(w * h).fill(0xff406080);
    const out = new Uint32Array(before);
    createRain(3)(out, { x: 300, y: 200, w, h }, 4, air);
    assert.equal(emptyBlocks(before, out, w, h), 0, `${w}×${h}`);
  }
});

test("splashes land over the whole of a frame of any size", () => {
  const air = airOf(0.5, 0.25, parseWeather("rain") ?? undefined);
  for (const [w, h] of SIZES) {
    const f = { ...seaFrame(300, 200, 2, palette, N, M.sea, w, h), air };
    const before = new Uint32Array(f.out);
    // Over a second of splashes, every block of the frame takes some.
    const layer = splashLayer(3);
    for (let t = 2; t < 3; t += 0.05) layer.draw({ ...f, t });
    assert.equal(emptyBlocks(before, f.out, w, h), 0, `${w}×${h}`);
  }
});

test("stars and mist reach every part of a frame of any size", () => {
  const night = airOf(PHASES.night, 0.25);
  const misty = airOf(0.5, 0.25, parseWeather("mist") ?? undefined);
  for (const [w, h] of SIZES) {
    const sea = { ...seaFrame(300, 200, 5, palette, N, M.sea, w, h), air: night };
    const dark = new Uint32Array(sea.out);
    nightLayer(3).draw(sea);
    assert.equal(emptyBlocks(dark, sea.out, w, h), 0, `stars on ${w}×${h}`);
    // Mist lies in banks with clear water between, so every block of a frame shows some of it over a few places.
    let covered = 0, blocks = 0;
    for (const at of [[300, 200], [900, 640], [40, 1000]]) {
      const f = { ...seaFrame(at[0], at[1], 5, palette, N, M.sea, w, h), air: misty };
      const clear = new Uint32Array(f.out);
      mistLayer(3).draw(f);
      const total = Math.floor(w / BLOCK) * Math.floor(h / BLOCK);
      blocks += total;
      covered += total - emptyBlocks(clear, f.out, w, h);
    }
    assert.ok(covered > blocks * 0.6, `mist over ${covered} of ${blocks} blocks of ${w}×${h}`);
  }
});
