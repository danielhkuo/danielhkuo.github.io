// The clearing a landing opens in the clouds: nothing of a cloud draws inside it, all of it draws without it, and a
// half-open clearing is smaller than a full one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { LOW_ALT } from "./field.ts";
import { drawClouds, type Hole } from "./sky.ts";

const W = 64, H = 48, N = 1024;
const WHITE = 0xffffffff, LAND = 0xff102030;

/** One opaque 40 × 30 cloud whose top-left lands on frame pixel (10, 8). */
function frameWith(hole: Hole | null): Uint32Array {
  const out = new Uint32Array(W * H).fill(LAND);
  const sprite = { w: 40, h: 30, rgba: new Uint32Array(40 * 30).fill(WHITE), alpha: new Uint8Array(40 * 30).fill(255) };
  // Bake row of the cloud's top = 0.8·y − alt = 8 with the frame's rect at the origin.
  const field = { n: N, wind: { x: 0, y: 0 }, clouds: [{ shape: 0, x: 10, y: (8 + LOW_ALT) / 0.8, layer: "low" as const }] };
  drawClouds(out, { x: 0, y: 0, w: W, h: H }, field, [sprite], 0, "low", 255, false, 0, hole);
  return out;
}

function covered(out: Uint32Array): number {
  let k = 0;
  for (const v of out) if (v === WHITE) k++;
  return k;
}

test("without a clearing the whole cloud draws", () => {
  assert.equal(covered(frameWith(null)), 40 * 30);
  assert.equal(covered(frameWith({ x: 30, y: 23, r: 10, amount: 0 })), 40 * 30);
});

test("inside an open clearing nothing of the cloud draws", () => {
  const out = frameWith({ x: 30, y: 23, r: 10, amount: 1 });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if ((x - 30) ** 2 + (y - 23) ** 2 < 100) assert.notEqual(out[y * W + x], WHITE, `(${x}, ${y})`);
  }
  // Well outside it, the cloud is whole.
  assert.equal(out[9 * W + 11], WHITE);
});

test("a clearing opening part way is smaller than one fully open", () => {
  const half = covered(frameWith({ x: 30, y: 23, r: 12, amount: 0.5 }));
  const full = covered(frameWith({ x: 30, y: 23, r: 12, amount: 1 }));
  assert.ok(full < half && half < 40 * 30, `${full} < ${half} < ${40 * 30}`);
});
