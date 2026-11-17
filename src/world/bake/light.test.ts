import assert from "node:assert/strict";
import { test } from "node:test";
import { rngFor } from "../core/rng.ts";
import { BASE_TONE, boxBlur, shade, SHADOW_DROP, sweepShadow } from "./light.ts";

function fixture(n: number, seed: number, top: number): Float32Array {
  const r = rngFor(seed, "light-fixture");
  const h = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = r.float() < 0.15 ? r.range(0, top) : r.range(0, 2);
  return h;
}

/** Marches from each cell towards the sun, one diagonal step at a time. */
function bruteRay(h: Float32Array, n: number, x: number, y: number): number {
  let best = -Infinity;
  for (let k = 1; x - k >= 0 && y - k >= 0; k++) {
    // The same arithmetic as the sweep: the caster's height lowered one step at a time, in single precision.
    let v = h[(y - k) * n + (x - k)];
    for (let s = 0; s < k; s++) v = Math.fround(v - SHADOW_DROP);
    if (v > best) best = v;
  }
  return best;
}

test("the shadow sweep equals a brute-force march on 32² fixtures", () => {
  for (const seed of [1, 2, 3]) {
    const n = 32, h = fixture(n, seed, 40), out = new Float32Array(n * n);
    sweepShadow(h, n, n, out);
    let shaded = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const want = bruteRay(h, n, x, y);
      assert.equal(out[y * n + x], Math.fround(want), `seed ${seed} at ${x},${y}`);
      if (want > h[y * n + x]) shaded++;
    }
    assert.ok(shaded > 50, "the fixture casts shadows");
  }
});

test("two windows agree on shadow wherever the caster lies in both", () => {
  // Heights under 20 reach at most 8 diagonal steps, so cells 8 in from a window's north-west edges are settled.
  const n = 48, h = fixture(n, 9, 20);
  const full = new Float32Array(n * n);
  sweepShadow(h, n, n, full);
  const ox = 11, oy = 7, m = 32;
  const crop = new Float32Array(m * m), out = new Float32Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) crop[y * m + x] = h[(y + oy) * n + x + ox];
  sweepShadow(crop, m, m, out);
  for (let y = 8; y < m; y++) for (let x = 8; x < m; x++) {
    const a = out[y * m + x], b = full[(y + oy) * n + x + ox], s = crop[y * m + x];
    assert.equal(a > s, b > s);
    if (a > s) assert.equal(a, b);
  }
});

test("flat ground sits at the base tone; slopes towards the sun are lighter, away darker", () => {
  assert.equal(shade(0, 0, 0, 0), BASE_TONE);
  assert.equal(shade(0, 0, 0, 100), BASE_TONE);
  // Rising to the south-east faces north-west, towards the sun.
  assert.ok(shade(0.4, 0.4, 0, 20) > BASE_TONE);
  assert.ok(shade(-0.4, -0.4, 0, 20) < BASE_TONE);
  // Ridges lighten, valley floors darken.
  assert.ok(shade(0, 0, 3, 20) > BASE_TONE && shade(0, 0, -3, 20) < BASE_TONE);
  // Contrast grows with height.
  assert.ok(shade(-0.4, -0.4, 0, 120) < shade(-0.4, -0.4, 0, 10));
});

test("the relief blur does not depend on where its window starts", () => {
  const n = 64, h = fixture(n, 4, 30), r = 8;
  const a = new Float32Array(n * n), b = new Float32Array(40 * 40);
  boxBlur(h, n, 10, 50, r, a, new Float64Array(n * n + n));
  const ox = 9, oy = 13, m = 40, crop = new Float32Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) crop[y * m + x] = h[(y + oy) * n + x + ox];
  boxBlur(crop, m, r, m - r - 1, r, b, new Float64Array(m * m + m));
  for (let y = r; y < m - r - 1; y++) for (let x = r; x < m - r - 1; x++) {
    if (y + oy >= 10 && y + oy < 50 && x + ox >= 10 && x + ox < 50) assert.equal(b[y * m + x], a[(y + oy) * n + x + ox]);
  }
});
