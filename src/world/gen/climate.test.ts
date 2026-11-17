import assert from "node:assert/strict";
import { test } from "node:test";
import { seamRatio } from "../testing/seam.ts";
import { blurTorus, climateFields, type ClimateParams, toCoarse } from "./climate.ts";

const P: ClimateParams = { moistureRadius: 3, windReach: 20, windDropPerNode: 0.8, windScale: 30 };

test("toCoarse averages 2 × 2 blocks", () => {
  const g = new Float64Array(16).map((_, i) => i);
  assert.deepEqual([...toCoarse(g, 4)], [2.5, 4.5, 10.5, 12.5]);
});

test("blurTorus conserves the mean, smooths, and wraps", () => {
  const n = 32, a = new Float32Array(n * n);
  a[0] = 1024;
  const b = blurTorus(a, n, 2, 3);
  const sum = b.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1024) < 1e-2);
  assert.ok(b[0] < 1024 && b[0] > 0);
  assert.ok(Math.abs(b[1] - b[n - 1]) < 1e-3 && Math.abs(b[n] - b[(n - 1) * n]) < 1e-3);
});

/** A ridge across the south-west wind (along x − y ≡ 0) with sea beyond, on G. */
function ridgeWorld(gN: number) {
  const h = new Float64Array(gN * gN), rain = new Float64Array(gN * gN), isSea = new Uint8Array(gN * gN);
  for (let y = 0; y < gN; y++) for (let x = 0; x < gN; x++) {
    const i = y * gN + x, s = ((x - y + gN + gN / 2) % gN) - gN / 2, d = Math.abs(s);
    if (d < 24) h[i] = 80 - 3 * d; else if (d < 40) h[i] = 2; else { h[i] = -5; isSea[i] = 1; }
    rain[i] = isSea[i] ? 1 : s < 0 ? 1 + h[i] / 20 : 0.5;
  }
  return { h, rain, isSea };
}

test("fields are sized to C, in range, finite and seamless", () => {
  const gN = 128, { h, rain, isSea } = ridgeWorld(gN), c = climateFields(h, rain, isSea, gN, P);
  for (const f of [c.moisture, c.wind]) {
    assert.equal(f.length, 64 * 64);
    for (const v of f) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v));
    assert.ok(seamRatio(f, 64) <= 1);
  }
});

test("windward is wetter than leeward", () => {
  const gN = 128, { h, rain, isSea } = ridgeWorld(gN), c = climateFields(h, rain, isSea, gN, P);
  let w = 0, nw = 0, l = 0, nl = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const s = ((x - y + 64 + 32) % 64) - 32;
    if (Math.abs(s) < 2 || Math.abs(s) > 10) continue;
    if (s < 0) { w += c.moisture[y * 64 + x]; nw++; } else { l += c.moisture[y * 64 + x]; nl++; }
  }
  assert.ok(w / nw > l / nl + 0.1, `windward ${w / nw} lee ${l / nl}`);
});

test("crests are exposed, the lee foot is sheltered, the open sea is fully exposed", () => {
  const gN = 128, { h, rain, isSea } = ridgeWorld(gN), c = climateFields(h, rain, isSea, gN, P);
  const at = (s: number) => {
    let sum = 0, k = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (((x - y + 64 + 32) % 64) - 32 === s) { sum += c.wind[y * 64 + x]; k++; }
    return sum / k;
  };
  assert.ok(at(0) > 0.7, `crest ${at(0)}`);
  assert.ok(at(14) < 0.35, `lee ${at(14)}`);
  assert.ok(at(-31) > 0.99, `sea ${at(-31)}`);
});

test("deterministic", () => {
  const gN = 64, { h, rain, isSea } = ridgeWorld(gN);
  assert.deepEqual(climateFields(h, rain, isSea, gN, P), climateFields(h, rain, isSea, gN, P));
});
