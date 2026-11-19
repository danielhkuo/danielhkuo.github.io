import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIAL as M } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { airOf, NOON_AIR } from "./air.ts";
import { makeField } from "./field.ts";
import { createRain, rainLean, splashLayer, STREAKS } from "./rain.ts";
import { makeShapes, SHAPE_COUNTS } from "./shapes.ts";
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
  assert.ok(n > STREAKS && n < W * H * 0.03, `${n} pixels of rain`);
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
  assert.ok(n > 100 && n < 700, `${n} pixels of splashes`);
});

test("the rain leans the way the clouds drift, every streak one pixel wide", () => {
  for (const seed of [1, 2, 3, 7, 11]) {
    const wind = makeField(seed, 1280, makeShapes(seed, SHAPE_COUNTS)).wind;
    assert.equal(rainLean(seed), wind.x < 0 ? -1 : 1, `seed ${seed}`);
  }
  // Seed 3's wind blows a little west: a streak's foot is to the left of its head, so no pixel has rain to its
  // lower right more often than to its lower left.
  const base = new Uint32Array(W * H).fill(0xff203040);
  const wet = new Uint32Array(base);
  createRain(3)(wet, rect, 1.3, RAIN);
  let left = 0, right = 0, beside = 0, drawn = 0;
  for (let y = 0; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (wet[y * W + x] === base[0]) continue;
    drawn++;
    if (wet[(y + 1) * W + x - 1] !== base[0]) left++;
    if (wet[(y + 1) * W + x + 1] !== base[0]) right++;
    if (wet[y * W + x + 1] !== base[0]) beside++;
  }
  assert.equal(rainLean(3), -1);
  assert.ok(left > 4 * right, `${left} steps left, ${right} right`);
  assert.ok(beside < drawn * 0.05, `${beside} of ${drawn} pixels have a neighbour beside them`);
});

test("rain is pale on dark ground and inked on pale ground, so it shows on both", () => {
  const dark = new Uint32Array(W * H).fill(0xff403020), pale = new Uint32Array(W * H).fill(0xffe0e4e8);
  const rain = createRain(3);
  rain(dark, rect, 2, RAIN);
  rain(pale, rect, 2, RAIN);
  let lighter = 0, darker = 0;
  for (let i = 0; i < dark.length; i++) {
    if ((dark[i] & 255) > 0x20 + 24) lighter++;
    if ((pale[i] & 255) < 0xe8 - 24) darker++;
    assert.ok((dark[i] & 255) >= 0x20 && (pale[i] & 255) <= 0xe8);
  }
  assert.ok(lighter > STREAKS && darker > STREAKS, `${lighter} pale, ${darker} inked`);
});

test("the rain comes in gusts: never an even hatch, and never a curtain", () => {
  const base = new Uint32Array(W * H).fill(0xff203040);
  const rain = createRain(3);
  let thinnest = 1, thickest = 0;
  for (let k = 0; k < 40; k++) {
    const wet = new Uint32Array(base);
    rain(wet, rect, k * 0.37, RAIN);
    // The rain's strength in each tenth of the frame's width.
    const bands = new Float64Array(10);
    for (let i = 0; i < wet.length; i++) bands[Math.floor(((i % W) * 10) / W)] += (wet[i] & 255) - 0x40;
    const most = Math.max(...bands), least = Math.min(...bands);
    assert.ok(least > 0, "no tenth of the frame is dry");
    thinnest = Math.min(thinnest, least / most);
    thickest = Math.max(thickest, changed(wet, base) / wet.length);
  }
  assert.ok(thinnest < 0.5, `the thinnest band has ${thinnest} of the thickest`);
  assert.ok(thickest < 0.03, `at most ${thickest} of the frame is rain`);
});

test("a splash keeps its place on the land while the camera moves", () => {
  const palette = buildPalette(MIDDAY);
  const layer = splashLayer(3);
  const bake = new Uint32Array(W * H).fill(M.sea | (9 << 8));
  const draw = (x: number, y: number): Uint32Array => {
    const out = new Uint32Array(W * H).fill(0xff406080);
    layer.draw({ out, bake, rect: { x, y, w: W, h: H }, t: 2, palette, n: 1280, air: RAIN });
    return out;
  };
  const a = draw(100, 50), b = draw(103, 52);
  let kept = 0, drawn = 0;
  for (let y = 4; y < H - 4; y++) for (let x = 6; x < W - 6; x++) {
    if (a[y * W + x] === 0xff406080) continue;
    drawn++;
    if (b[(y - 2) * W + x - 3] === a[y * W + x]) kept++;
  }
  assert.ok(drawn > 100 && kept > drawn * 0.95, `${kept} of ${drawn}`);
});
