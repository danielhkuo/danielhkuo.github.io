import assert from "node:assert/strict";
import { test } from "node:test";
import { fbm, GRADIENTS, gradNoise, octaveMatrixPower, ridgedFbm } from "./noise.ts";
import { type Rng, rngFor } from "./rng.ts";

const dyadic = (r: Rng) => r.int(8192) / 1024;

test("16 unit gradients at k·22.5°", () => {
  assert.equal(GRADIENTS.length, 32);
  for (let k = 0; k < 16; k++) {
    assert.ok(Math.abs(GRADIENTS[2 * k] - Math.cos((k * Math.PI) / 8)) < 1e-15, `gx ${k}`);
    assert.ok(Math.abs(GRADIENTS[2 * k + 1] - Math.sin((k * Math.PI) / 8)) < 1e-15, `gy ${k}`);
  }
});

test("octave matrix powers", () => {
  assert.deepEqual(octaveMatrixPower(0), [1, 0, 0, 1]);
  assert.deepEqual(octaveMatrixPower(1), [2, 1, -1, 2]);
  assert.deepEqual(octaveMatrixPower(2), [3, 4, -4, 3]);
  assert.deepEqual(octaveMatrixPower(3), [2, 11, -11, 2]);
});

test("zero on lattice points", () => {
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) assert.equal(Math.abs(gradNoise(x, y, 8, 1)), 0);
});

test("gradNoise, fbm and ridgedFbm tile exactly", () => {
  const r = rngFor(3, "noise-test");
  for (let i = 0; i < 2000; i++) {
    const x = dyadic(r), y = dyadic(r), s = r.next();
    for (const f of [
      (a: number, b: number) => gradNoise(a, b, 8, s),
      (a: number, b: number) => fbm(a, b, 8, 6, 0.5, s),
      (a: number, b: number) => ridgedFbm(a, b, 8, 6, 0.5, s),
    ]) {
      const v = f(x, y);
      assert.equal(f(x + 8, y), v);
      assert.equal(f(x, y + 8), v);
      assert.equal(f(x + 16, y - 8), v);
    }
  }
});

test("seeds change the field", () => {
  let diff = 0;
  for (let i = 0; i < 100; i++) if (fbm(i / 13, i / 7, 8, 4, 0.5, 1) !== fbm(i / 13, i / 7, 8, 4, 0.5, 2)) diff++;
  assert.ok(diff > 90);
});

test("ranges", () => {
  const r = rngFor(4, "noise-test");
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 100000; i++) {
    const x = r.float() * 8, y = r.float() * 8;
    const g = gradNoise(x, y, 8, 5);
    assert.ok(Math.abs(g) <= 1 + 1e-12);
    lo = Math.min(lo, g); hi = Math.max(hi, g);
    assert.ok(Math.abs(fbm(x, y, 8, 6, 0.5, 5)) <= 1 + 1e-12);
    const rd = ridgedFbm(x, y, 8, 6, 0.5, 5);
    assert.ok(rd >= 0 && rd <= 1);
  }
  assert.ok(lo < -0.6 && hi > 0.6, `gradNoise spans ${lo}..${hi}`);
});

test("continuous", () => {
  const r = rngFor(5, "noise-test");
  for (let i = 0; i < 20000; i++) {
    const x = r.float() * 8, y = r.float() * 8;
    assert.ok(Math.abs(fbm(x + 1e-4, y, 8, 6, 0.5, 1) - fbm(x, y, 8, 6, 0.5, 1)) < 2e-3);
  }
});

test("isotropic", () => {
  const r = rngFor(6, "noise-test");
  const dirs = [[1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0, 1], [-Math.SQRT1_2, Math.SQRT1_2]];
  const e = [0, 0, 0, 0], h = 1e-3;
  for (let i = 0; i < 40000; i++) {
    const x = r.float() * 8, y = r.float() * 8, f0 = fbm(x, y, 8, 6, 0.5, 9);
    dirs.forEach(([dx, dy], j) => {
      const g = (fbm(x + h * dx, y + h * dy, 8, 6, 0.5, 9) - f0) / h;
      e[j] += g * g;
    });
  }
  const mean = (e[0] + e[1] + e[2] + e[3]) / 4;
  for (const v of e) assert.ok(Math.abs(v / mean - 1) <= 0.1, `${e.map((v) => (v / mean).toFixed(3))}`);
});
