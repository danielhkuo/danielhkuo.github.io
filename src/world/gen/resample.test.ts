import assert from "node:assert/strict";
import { test } from "node:test";
import { makeJitter } from "./flood.ts";
import { resampleToLattice } from "./resample.ts";

test("zero jitter is the identity, exactly", () => {
  const n = 16, h = new Float64Array(n * n).map((_, i) => (i * 37) % 11), j = makeJitter(n, 0, 1);
  assert.deepEqual(resampleToLattice(h, n, j), h);
});

test("a linear field is reproduced from jittered samples", () => {
  const n = 32, j = makeJitter(n, 0.4, 3), h = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    h[i] = 0.3 * (x + j.jx[i]) + 0.7 * (y + j.jy[i]);
  }
  const out = resampleToLattice(h, n, j);
  for (let y = 2; y <= n - 3; y++) for (let x = 2; x <= n - 3; x++) {
    assert.ok(Math.abs(out[y * n + x] - (0.3 * x + 0.7 * y)) <= 1e-9, `(${x},${y})`);
  }
});

test("resampled values stay within the local range", () => {
  const n = 32, j = makeJitter(n, 0.4, 4), h = new Float64Array(n * n).map((_, i) => ((i * 7919) % 101) / 10);
  const out = resampleToLattice(h, n, j);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let lo = Infinity, hi = -Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const v = h[((y + dy + n) % n) * n + ((x + dx + n) % n)];
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    assert.ok(out[y * n + x] >= lo - 1e-9 && out[y * n + x] <= hi + 1e-9);
  }
});
