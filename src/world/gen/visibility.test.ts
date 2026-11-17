import assert from "node:assert/strict";
import { test } from "node:test";
import { rngFor } from "../core/rng.ts";
import { visibility } from "./visibility.ts";

function brute(h: Float64Array, n: number, c: number, reach: number) {
  const horizon = new Float32Array(n * n), visible = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let m = -Infinity;
    for (let k = 1; k <= reach; k++) m = Math.max(m, h[((y + k) % n) * n + x] - c * k);
    horizon[y * n + x] = m;
    visible[y * n + x] = h[y * n + x] > m ? 1 : 0;
  }
  return { horizon, visible };
}

test("equals a brute-force search on random fields", () => {
  for (const [seed, c] of [[1, 3.2], [2, 0.8], [3, 1.6]] as const) {
    const n = 48, r = rngFor(seed, "vis-test"), h = new Float64Array(n * n);
    for (let i = 0; i < h.length; i++) h[i] = r.range(-5, 130);
    const reach = Math.ceil(160 / c), got = visibility(h, n, c, reach), want = brute(h, n, c, reach);
    assert.deepEqual(got.visible, want.visible);
    for (let i = 0; i < h.length; i++) assert.ok(Math.abs(got.horizon[i] - want.horizon[i]) <= 1e-4, `node ${i}`);
  }
});

test("a flat world is all visible", () => {
  const n = 16, v = visibility(new Float64Array(n * n).fill(10), n, 3.2, 50);
  assert.ok(v.visible.every((b) => b === 1));
});

test("a wall hides the ground just north of it, across the wrap too", () => {
  const n = 32, h = new Float64Array(n * n);
  for (let x = 0; x < n; x++) h[0 * n + x] = 40; // wall on row 0
  const v = visibility(h, n, 3.2, 50);
  // Rows n−1 … n−12 lie just north of row 0 across the wrap: 40 − 3.2k ≥ 0 for k ≤ 12.
  for (let k = 1; k <= 12; k++) assert.equal(v.visible[(n - k) * n + 5], 0, `row ${n - k}`);
  assert.equal(v.visible[(n - 13) * n + 5], 1);
  assert.equal(v.visible[0 * n + 5], 1);
});

test("columns are independent", () => {
  const n = 16, h = new Float64Array(n * n);
  h[8 * n + 3] = 100;
  const v = visibility(h, n, 3.2, 50);
  for (let y = 0; y < n; y++) if (y !== 8) assert.equal(v.visible[y * n + 4], 1);
});
