import assert from "node:assert/strict";
import { test } from "node:test";
import { torusDist } from "../core/torus.ts";
import { bumpy } from "../testing/fixtures.ts";
import { seamRatio } from "../testing/seam.ts";
import { boxBlur, drainage, nearestSource, nodeAt, regionsOn, rockOn } from "./field.ts";
import { paramsFor } from "./params.ts";
import { planWorld } from "./plan.ts";

test("nearestSource matches brute force on the torus, across the wrap", () => {
  const n = 48, src = new Uint8Array(n * n);
  const pts = [[0, 0], [47, 20], [10, 46], [30, 31], [31, 31], [5, 12]];
  for (const [x, y] of pts) src[y * n + x] = 1;
  const r = nearestSource(n, src);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let best = Infinity;
    for (const [sx, sy] of pts) best = Math.min(best, torusDist(sx, sy, x, y, n));
    const i = y * n + x;
    assert.ok(Math.abs(r.dist[i] - best) <= 1e-5 + 0.02 * best, `(${x}, ${y}) ${r.dist[i]} vs ${best}`);
    const s = r.src[i];
    assert.ok(src[s] === 1);
    assert.ok(Math.abs(torusDist(s % n, Math.floor(s / n), x, y, n) - r.dist[i]) < 1e-5);
  }
});

test("nearestSource with no source reports none", () => {
  const r = nearestSource(8, new Uint8Array(64));
  for (let i = 0; i < 64; i++) {
    assert.equal(r.src[i], -1);
    assert.equal(r.dist[i], Infinity);
  }
});

test("boxBlur keeps a constant, conserves the mean and wraps", () => {
  const n = 32, flat = new Float32Array(n * n).fill(0.25);
  for (const v of boxBlur(flat, n, 3, 2)) assert.ok(Math.abs(v - 0.25) < 1e-6);
  const spike = new Float32Array(n * n);
  spike[0] = 1;
  const b = boxBlur(spike, n, 2, 1);
  let sum = 0;
  for (const v of b) sum += v;
  assert.ok(Math.abs(sum - 1) < 1e-5);
  // A spike on the corner spreads to the three other corners.
  for (const i of [n - 1, (n - 1) * n, n * n - 1]) assert.ok(Math.abs(b[i] - 1 / 25) < 1e-6);
  assert.equal(spike[0], 1, "the input is not written");
});

test("plan fields carried to G: weights still sum to one, rock is its coarse node's, nothing has a seam", () => {
  const p = paramsFor(512), plan = planWorld(p, 42), gN = p.gN, nn = gN * gN;
  const regions = regionsOn(plan, 2);
  assert.equal(regions.length, 6 * nn);
  for (let i = 0; i < nn; i += 7) {
    let sum = 0;
    for (let a = 0; a < 6; a++) sum += regions[a * nn + i];
    assert.ok(Math.abs(sum - 1) < 1e-4);
  }
  for (let a = 0; a < 6; a++) assert.ok(seamRatio(regions.subarray(a * nn, (a + 1) * nn), gN) <= 1);
  const rock = rockOn(plan, 2);
  for (let y = 0; y < gN; y++) for (let x = 0; x < gN; x++) assert.equal(rock[y * gN + x], plan.rock[(y >> 1) * plan.n + (x >> 1)]);
});

test("drainage fills pits and sends every land node's water to the sea", () => {
  const f = bumpy(48, 5), d = drainage(f.h, 48, f.isSea, 1e-6);
  let land = 0, toSea = 0;
  for (let i = 0; i < f.h.length; i++) {
    if (f.isSea[i]) continue;
    land++;
    assert.ok(d.filled[i] >= f.h[i]);
    assert.ok(d.filled[d.rcv[i]] < d.filled[i]);
    if (f.isSea[d.rcv[i]]) toSea += d.area[i];
  }
  assert.equal(toSea, land);
});

test("nodeAt finds the node a point in cells falls in, wrapped", () => {
  assert.equal(nodeAt(0.1, 0.1, 4, 16), 0);
  assert.equal(nodeAt(7.9, 4, 4, 16), 16 + 1);
  assert.equal(nodeAt(-0.5, 64.5, 4, 16), 15);
});
