import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewRect } from "../render/compose.ts";
import { BANK_ALT, cloudAt, LOW_ALT, type Cloud, type SkyField } from "./field.ts";
import { createSky, drawClouds } from "./sky.ts";
import type { Sprite } from "./sprite.ts";
import { STYLES } from "./styles.ts";

const N = 1280, W = 400, H = 225, GREY = 0xff808080, WHITE = 0xffffffff, BLACK = 0xff000000;

function solid(w: number, h: number, rgba = WHITE, alpha = 255): Sprite {
  return { w, h, rgba: new Uint32Array(w * h).fill(rgba), alpha: new Uint8Array(w * h).fill(alpha) };
}
function field(...clouds: Cloud[]): SkyField {
  return { n: N, clouds, wind: { x: 0, y: 0 }, highWind: { x: 0, y: 0 } };
}
const rect = (x = 0, y = 0): ViewRect => ({ x, y, w: W, h: H });
const frame = () => new Uint32Array(W * H).fill(GREY);
/** A cloud whose sprite's top-left lands at screen (sx, sy) in rect(0, 0); 0.8·y lands on whole rows for y = 5k. */
const at = (sx: number, sy: number, layer: Cloud["layer"], alt: number): Cloud => ({ shape: 0, x: sx, y: (sy + alt) / 0.8, layer, flip: false });

test("a low cloud is drawn by the low layer only", () => {
  const f = field(at(190, 105, "low", LOW_ALT));
  const out = frame();
  drawClouds(out, rect(), f, [solid(20, 10)], 0, "bank", 255);
  assert.ok(out.every((v) => v === GREY), "not by the bank layer");
  drawClouds(out, rect(), f, [solid(20, 10)], 0, "low", 255);
  assert.equal(out[110 * W + 200], WHITE);
  assert.equal(out[105 * W + 190], WHITE, "its top-left corner");
  assert.equal(out[104 * W + 190], GREY);
  assert.equal(out[105 * W + 189], GREY);
  assert.equal(out[114 * W + 209], WHITE, "its bottom-right corner");
  assert.equal(out[115 * W + 209], GREY);
});

test("a bank is lifted by its own height", () => {
  const f = field(at(100, 60, "bank", BANK_ALT));
  const out = frame();
  drawClouds(out, rect(), f, [solid(20, 10)], 0, "bank", 255);
  assert.equal(out[60 * W + 100], WHITE);
  assert.equal(out[59 * W + 100], GREY);
});

test("a cloud across the seam is drawn on both sides of it", () => {
  // Spans x 1270–1289, which wraps to 1270–1279 and 0–9.
  const c: Cloud = { shape: 0, x: 1270, y: 250, layer: "low", flip: false };
  const row = Math.round(0.8 * 250) - LOW_ALT;
  const left = frame();
  drawClouds(left, rect(-5, 0), field(c), [solid(20, 10)], 0, "low", 255);
  for (let x = 0; x < 15; x++) assert.equal(left[row * W + x], WHITE, `col ${x} at rect.x −5`);
  assert.equal(left[row * W + 15], GREY);
  const right = frame();
  drawClouds(right, rect(1260, 0), field(c), [solid(20, 10)], 0, "low", 255);
  for (let x = 10; x < 30; x++) assert.equal(right[row * W + x], WHITE, `col ${x} at rect.x 1260`);
  // Bake rows wrap every 0.8·n = 1024: a cloud near the bottom of the world shows above a view just past the top.
  const low: Cloud = { shape: 0, x: 50, y: 1270, layer: "low", flip: false };
  const top = frame();
  drawClouds(top, rect(0, -60), field(low), [solid(20, 10)], 0, "low", 255);
  const sy = Math.round(0.8 * 1270) - LOW_ALT - 1024 + 60;
  assert.equal(top[sy * W + 55], WHITE, `row ${sy} with rect.y < 0`);
});

test("clouds clip at the frame's edge instead of wrapping onto its other side", () => {
  const out = frame();
  drawClouds(out, rect(), field(at(390, 100, "low", LOW_ALT)), [solid(20, 10)], 0, "low", 255);
  for (let x = 390; x < 400; x++) assert.equal(out[100 * W + x], WHITE);
  for (let x = 0; x < 12; x++) assert.equal(out[101 * W + x], GREY, `col ${x} of the next row`);
});

test("alpha blends, and zero alpha leaves a pixel alone", () => {
  const f = field(at(100, 100, "low", LOW_ALT));
  const none = frame();
  drawClouds(none, rect(), f, [solid(20, 10, WHITE, 0)], 0, "low", 255);
  drawClouds(none, rect(), f, [solid(20, 10)], 0, "low", 0);
  assert.ok(none.every((v) => v === GREY));
  const half = frame();
  drawClouds(half, rect(), f, [solid(20, 10)], 0, "low", 128);
  const r = half[105 * W + 110] & 255;
  assert.ok(Math.abs(r - (0x80 + (0xff - 0x80) * 128 / 255)) <= 1.01, `red ${r}`);
  assert.equal(half[105 * W + 110] >>> 24, 255, "the frame stays opaque");
});

test("a flipped cloud is the mirror image", () => {
  const s = solid(20, 10);
  for (let y = 0; y < 10; y++) for (let x = 10; x < 20; x++) s.rgba[y * 20 + x] = BLACK;
  const plain = frame(), flipped = frame();
  drawClouds(plain, rect(), field(at(100, 100, "low", LOW_ALT)), [s], 0, "low", 255);
  drawClouds(flipped, rect(), field({ ...at(100, 100, "low", LOW_ALT), flip: true }), [s], 0, "low", 255);
  assert.equal(plain[100 * W + 100], WHITE);
  assert.equal(plain[100 * W + 119], BLACK);
  assert.equal(flipped[100 * W + 100], BLACK);
  assert.equal(flipped[100 * W + 119], WHITE);
});

test("clouds drift with the wind", () => {
  const f: SkyField = { ...field(at(100, 100, "low", LOW_ALT)), wind: { x: 10, y: 0 } };
  const out = frame();
  drawClouds(out, rect(), f, [solid(20, 10)], 2, "low", 255);
  assert.equal(out[100 * W + 120], WHITE, "20 cells east after 2 s");
  assert.equal(out[100 * W + 105], GREY);
  assert.equal(cloudAt(f, f.clouds[0], 2).x, 120);
});

test("the sky draws low clouds below the flier and banks above it", () => {
  const sky = createSky(3, 6400, STYLES.watercolour);
  // A view with a bank in it and one without, found from the field.
  const bank = sky.field.clouds.find((c) => c.layer === "bank")!;
  const p = cloudAt(sky.field, bank, 0);
  const r = rect(Math.round(p.x) - 150, Math.round(0.8 * p.y) - BANK_ALT - 80);
  const below = frame(), above = frame();
  sky.draw(below, r, 0, "below");
  sky.draw(above, r, 0, "above");
  assert.ok(above.some((v) => v !== GREY), "the bank is drawn in the above pass");
  assert.notDeepEqual(below, above);
});

test("the busiest view draws in under 3 ms in Node", () => {
  const sky = createSky(3, 6400, STYLES.layered);
  let best = rect(), most = -1;
  for (let k = 0; k < 120; k++) {
    const r = rect((k * 977) % 6400, (k * 613) % 5120);
    const out = frame();
    sky.draw(out, r, 0, "below");
    let changed = 0;
    for (const v of out) if (v !== GREY) changed++;
    if (changed > most) { most = changed; best = r; }
  }
  const out = frame(), times: number[] = [];
  for (let k = 0; k < 50; k++) {
    const t0 = performance.now();
    sky.draw(out, best, k / 60, "below");
    sky.draw(out, best, k / 60, "above");
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[25] < 3, `median ${times[25].toFixed(2)} ms`);
});
