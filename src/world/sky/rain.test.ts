import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIAL as M } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { airOf, NOON_AIR } from "./air.ts";
import { createRain, splashLayer, STREAKS } from "./rain.ts";
import { parseWeather } from "./weather.ts";

const W = 400, H = 225;
const rect = { x: 0, y: 0, w: W, h: H };
const RAIN = airOf(0.5, 0.25, parseWeather("rain") ?? undefined);

function changed(a: Uint32Array, b: Uint32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

test("no rain draws nothing; full rain draws thin streaks over a small share of the frame", () => {
  const rain = createRain(3);
  const base = new Uint32Array(W * H).fill(0xff406080);
  const dry = new Uint32Array(base);
  rain(dry, rect, 4, NOON_AIR);
  assert.equal(changed(dry, base), 0);
  const wet = new Uint32Array(base);
  rain(wet, rect, 4, RAIN);
  const n = changed(wet, base);
  assert.ok(n > STREAKS && n < W * H * 0.04, `${n} pixels of rain`);
  // The same time draws the same rain, and the rain falls.
  const again = new Uint32Array(base);
  createRain(3)(again, rect, 4, RAIN);
  assert.deepEqual(again, wet);
  const later = new Uint32Array(base);
  rain(later, rect, 4.1, RAIN);
  assert.ok(changed(later, wet) > STREAKS);
});

test("rain makes rings on water and flecks on the ground, and nothing in fair weather", () => {
  const palette = buildPalette(MIDDAY);
  const layer = splashLayer(3);
  const bake = new Uint32Array(W * H);
  for (let i = 0; i < bake.length; i++) bake[i] = ((i % W) < W / 2 ? M.sea : M.meadowMid) | (9 << 8);
  const out = new Uint32Array(W * H).fill(0xff406080);
  const frame = { out: new Uint32Array(out), bake, rect, t: 2, palette, n: 1280 };
  layer.draw({ ...frame, air: NOON_AIR });
  layer.draw(frame);
  assert.equal(changed(frame.out, out), 0);
  layer.draw({ ...frame, air: RAIN });
  const n = changed(frame.out, out);
  assert.ok(n > 20 && n < 600, `${n} pixels of splashes`);
});
