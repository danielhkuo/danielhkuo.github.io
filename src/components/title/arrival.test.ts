// The world's arrival behind the title: it starts on blank paper, and each pixel of the world switches on in its turn,
// spreading out from the dragon with an ordered-dither edge. Slow, but in hard pixel steps: never a fade.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ARRIVAL_MS, arrivalOrder, paperOver } from "./arrival.ts";

const W = 400, H = 225, CX = 200, CY = 180;
const PAPER: [number, number, number] = [255, 252, 240];

test("it takes a few seconds: slow enough to watch the world come in", () => {
  assert.ok(ARRIVAL_MS >= 2000 && ARRIVAL_MS <= 3500, `ARRIVAL_MS ${ARRIVAL_MS}`);
});

test("every pixel has a turn between 0 and 1, and the dragon's pixel comes first", () => {
  const order = arrivalOrder(W, H, CX, CY);
  assert.equal(order.length, W * H);
  let min = Infinity, at = -1;
  for (let i = 0; i < order.length; i++) {
    assert.ok(order[i] >= 0 && order[i] <= 1, `pixel ${i}: ${order[i]}`);
    if (order[i] < min) { min = order[i]; at = i; }
  }
  const x = at % W, y = Math.floor(at / W);
  assert.ok(Math.hypot(x - CX, y - CY) <= 8, `the first pixel (${x},${y}) is by the dragon`);
});

test("near pixels come before far ones, but the edge is broken by an ordered pattern, not a smooth line", () => {
  const order = arrivalOrder(W, H, CX, CY);
  const ring = (r: number) => { const v: number[] = []; for (let a = 0; a < 360; a += 3) { const x = Math.round(CX + r * Math.cos((a * Math.PI) / 180)), y = Math.round(CY + r * Math.sin((a * Math.PI) / 180)); if (x >= 0 && y >= 0 && x < W && y < H) v.push(order[y * W + x]); } return v; };
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  assert.ok(mean(ring(20)) < mean(ring(60)) && mean(ring(60)) < mean(ring(120)), "farther rings come later");
  const r = ring(60), spread = Math.max(...r) - Math.min(...r);
  assert.ok(spread > 0.05, "pixels the same distance away do not all switch at once");
  // the pattern repeats on an 8-pixel grid
  const a = order[100 * W + 100] - order[100 * W + 101], b = order[108 * W + 108] - order[108 * W + 109];
  assert.ok(Math.abs(a - b) < 0.05, "the dither repeats every 8 pixels");
});

test("paperOver lays paper where the world has not arrived, and leaves the arrived pixels clear", () => {
  const order = arrivalOrder(W, H, CX, CY), out = new Uint8ClampedArray(W * H * 4);
  paperOver(order, -1, out, PAPER);
  for (let i = 0; i < W * H; i++) assert.deepEqual([out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]], [...PAPER, 255]);
  paperOver(order, 1.02, out, PAPER);
  for (let i = 0; i < W * H; i++) assert.equal(out[i * 4 + 3], 0, "all clear at the end");
});

test("only fully opaque paper or fully clear: no half-tones, so nothing ever fades", () => {
  const order = arrivalOrder(W, H, CX, CY), out = new Uint8ClampedArray(W * H * 4);
  let last = -1;
  for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    paperOver(order, p, out, PAPER);
    let clear = 0;
    for (let i = 0; i < W * H; i++) { const a = out[i * 4 + 3]; assert.ok(a === 0 || a === 255, `alpha ${a}`); if (a === 0) clear++; }
    assert.ok(clear > last, `more of the world at ${p}`);
    last = clear;
  }
});
