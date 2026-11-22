import assert from "node:assert/strict";
import { test } from "node:test";
import { bsplineAt, upsampleBSpline, upsampleTile } from "./bspline.ts";
import { rngFor } from "./rng.ts";

function randomGrid(n: number, seed: number): Float64Array {
  const r = rngFor(seed, "bspline-test"), a = new Float64Array(n * n);
  for (let i = 0; i < a.length; i++) a[i] = r.range(-20, 130);
  return a;
}
const wrap = (i: number, n: number) => ((i % n) + n) % n;

test("constant in, constant out", () => {
  const src = new Float64Array(8 * 8).fill(3.25);
  for (const v of upsampleBSpline(src, 8, 4)) assert.ok(Math.abs(v - 3.25) < 1e-12);
});

test("output size", () => {
  assert.equal(upsampleBSpline(new Float64Array(16 * 16), 16, 4).length, 64 * 64);
  assert.equal(upsampleBSpline(new Float64Array(16 * 16), 16, 2).length, 32 * 32);
});

test("convex hull of the 4×4 node patch", () => {
  const n = 16, f = 4, src = randomGrid(n, 1), out = upsampleBSpline(src, n, f), m = n * f;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const u = (i + 0.5) / f - 0.5, v = (j + 0.5) / f - 0.5;
    const bx = Math.floor(u) - 1, by = Math.floor(v) - 1;
    let lo = Infinity, hi = -Infinity;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const s = src[wrap(by + dy, n) * n + wrap(bx + dx, n)];
      lo = Math.min(lo, s); hi = Math.max(hi, s);
    }
    const o = out[j * m + i];
    assert.ok(o >= lo - 1e-9 && o <= hi + 1e-9, `(${i},${j}) ${o} outside [${lo}, ${hi}]`);
  }
});

test("linear precision away from the wrap", () => {
  const n = 32, f = 4, src = new Float64Array(n * n), m = n * f;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) src[y * n + x] = x;
  const out = upsampleBSpline(src, n, f);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const u = (i + 0.5) / f - 0.5;
    if (Math.floor(u) - 1 < 0 || Math.floor(u) + 2 > n - 1) continue;
    assert.ok(Math.abs(out[j * m + i] - u) < 1e-12);
  }
});

test("tile equals the crop, across the seam", () => {
  const n = 16, f = 4, m = n * f, src = randomGrid(n, 2), whole = upsampleBSpline(src, n, f);
  for (const [x0, y0] of [[0, 0], [50, 3], [-7, 61], [61, -7], [128, 64]]) {
    const w = 37, h = 29, crop = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) crop[y * w + x] = whole[wrap(y0 + y, m) * m + wrap(x0 + x, m)];
    assert.deepEqual(upsampleTile(src, n, f, x0, y0, w, h), crop);
  }
});

test("bsplineAt agrees with upsample at fine-cell centres", () => {
  const n = 16, f = 4, m = n * f, src = randomGrid(n, 3), whole = upsampleBSpline(src, n, f);
  for (let j = 0; j < m; j += 5) for (let i = 0; i < m; i += 3) {
    const v = bsplineAt(src, n, (i + 0.5) / f - 0.5, (j + 0.5) / f - 0.5);
    assert.ok(Math.abs(v - whole[j * m + i]) < 1e-12);
  }
});

test("bsplineAt is periodic", () => {
  const n = 16, src = randomGrid(n, 4);
  for (const [u, v] of [[0.3, 0.7], [15.9, 2.25], [-0.5, 7]]) {
    assert.ok(Math.abs(bsplineAt(src, n, u + n, v) - bsplineAt(src, n, u, v)) < 1e-9);
    assert.ok(Math.abs(bsplineAt(src, n, u, v - n) - bsplineAt(src, n, u, v)) < 1e-9);
  }
});
