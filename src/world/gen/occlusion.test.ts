import assert from "node:assert/strict";
import { test } from "node:test";
import { OCCLUSION_REACH, occlusionFloor } from "./occlusion.ts";

function brute(h: Float64Array, gN: number, cpn: number, block: number): Uint8Array {
  const per = block / cpn, bN = gN / per, out = new Uint8Array(bN * bN);
  const K = Math.ceil(OCCLUSION_REACH / cpn);
  for (let by = 0; by < bN; by++) for (let bx = 0; bx < bN; bx++) {
    let best = 0;
    for (let y = by * per; y < (by + 1) * per; y++) for (let x = bx * per; x < (bx + 1) * per; x++) {
      for (let k = 1; k <= K; k++) best = Math.max(best, h[((y + k) % gN) * gN + x] - 0.8 * k * cpn);
    }
    out[by * bN + bx] = Math.min(255, Math.ceil(best));
  }
  return out;
}

test("occlusion equals a brute-force march on a random field", () => {
  const gN = 64;
  const h = new Float64Array(gN * gN);
  let s = 12345;
  for (let i = 0; i < h.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    h[i] = (s / 4294967296) * 140 - 10;
  }
  assert.deepEqual(occlusionFloor(h, gN, 4, 16), brute(h, gN, 4, 16));
  assert.deepEqual(occlusionFloor(h, gN, 4, 32), brute(h, gN, 4, 32));
});

test("a flat field has no floor", () => {
  const out = occlusionFloor(new Float64Array(64 * 64).fill(30), 64, 4, 16);
  assert.equal(out.length, 16 * 16);
  assert.ok(out.every((v) => v === 0));
});

test("a wall 40 high sets the floor north of it, and the floor wraps", () => {
  const gN = 64, h = new Float32Array(gN * gN);
  for (let x = 0; x < gN; x++) h[10 * gN + x] = 40;
  const out = occlusionFloor(h, gN, 4, 16);
  const col = (by: number) => out[by * 16 + 5];
  // Block rows are four nodes: row 9 sees the wall one node away (40 − 3.2), row 7 three away (40 − 9.6), row 3 seven away.
  assert.deepEqual([col(0), col(1), col(2), col(3)], [18, 31, 37, 0]);
  // Row 63 sees it eleven nodes south, across the wrap: 40 − 35.2.
  assert.equal(col(15), 5);
  for (let by = 4; by < 15; by++) assert.equal(col(by), 0, `block row ${by}`);
});

test("the floor is capped at 255", () => {
  const gN = 64, h = new Float64Array(gN * gN);
  for (let x = 0; x < gN; x++) h[20 * gN + x] = 400;
  assert.equal(occlusionFloor(h, gN, 4, 16)[4 * 16], 255);
});
