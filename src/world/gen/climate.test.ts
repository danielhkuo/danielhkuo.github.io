import assert from "node:assert/strict";
import { test } from "node:test";
import { seamRatio } from "../testing/seam.ts";
import { blurTorus, climateFields, curveAt, equatorOf, latitudeAt, type ClimateParams, type LatCurve, TEMPERATE, toCoarse, type ZoneLayout } from "./climate.ts";
import { paramsFor } from "./params.ts";

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

// The zones of latitude.

test("curveAt is exact at its points, linear between them and held beyond its ends", () => {
  const curve: LatCurve = [[0, 1], [0.4, 0.2], [0.5, 0.2], [1, 0.6]];
  // At its points the value is the point's own, to the last bit of the arithmetic between them.
  for (const [phi, v] of curve) assert.ok(Math.abs(curveAt(curve, phi) - v) < 1e-12, `at ${phi}: ${curveAt(curve, phi)}`);
  // Across a flat stretch it is exact: the temperate plateau is TEMPERATE to the bit.
  for (let phi = 0.4; phi <= 0.5; phi += 0.01) if (phi > 0.4) assert.equal(curveAt(curve, phi), 0.2);
  const real = ZP.zones!.temp;
  for (let phi = 0.53; phi < 0.66; phi += 0.01) assert.equal(curveAt(real, phi), TEMPERATE, `plateau at ${phi}`);
  for (const [phi, v] of real) assert.equal(Math.fround(curveAt(real, phi)), Math.fround(v), `real curve at ${phi}`);
  assert.ok(Math.abs(curveAt(curve, 0.1) - 0.8) < 1e-12);
  assert.ok(Math.abs(curveAt(curve, 0.45) - 0.2) < 1e-12);
  assert.ok(Math.abs(curveAt(curve, 0.75) - 0.4) < 1e-12);
  assert.equal(curveAt(curve, -0.3), 1);
  assert.equal(curveAt(curve, 1.7), 0.6);
});

test("latitude is 0 on the equator, 1 half a world away, symmetric and periodic", () => {
  const n = 1024, eq = 300;
  assert.equal(latitudeAt(eq, n, eq), 0);
  assert.equal(latitudeAt(eq + n / 2, n, eq), 1);
  assert.equal(latitudeAt(eq - n / 2, n, eq), 1);
  for (let d = 0; d < n; d += 37) {
    assert.ok(Math.abs(latitudeAt(eq + d, n, eq) - latitudeAt(eq - d, n, eq)) < 1e-12, `symmetric at ${d}`);
    const y = eq + d;
    assert.ok(Math.abs(latitudeAt(y + n, n, eq) - latitudeAt(y, n, eq)) < 1e-12, `periodic at ${y}`);
    assert.ok(Math.abs(latitudeAt(y - 3 * n, n, eq) - latitudeAt(y, n, eq)) < 1e-12, `periodic at ${y}`);
    const v = latitudeAt(y, n, eq);
    assert.ok(v >= 0 && v <= 1);
  }
});

test("equatorOf puts the home row at homeLat with the pole to its north, wrapped into the world", () => {
  const n = 1024;
  for (const homeY of [0, 100, 600, 1000, 1023]) {
    for (const homeLat of [0.2, 0.57, 0.9]) {
      const eq = equatorOf(n, homeY, homeLat);
      assert.ok(eq >= 0 && eq < n, `equator ${eq}`);
      assert.ok(Math.abs(latitudeAt(homeY, n, eq) - homeLat) < 1e-9, `home lies at ${latitudeAt(homeY, n, eq)}`);
      // North is smaller y: a step north of home is nearer the pole, a step south nearer the equator.
      assert.ok(latitudeAt(homeY - 8, n, eq) > latitudeAt(homeY, n, eq), `north of ${homeY} is colder`);
      assert.ok(latitudeAt(homeY + 8, n, eq) < latitudeAt(homeY, n, eq), `south of ${homeY} is warmer`);
    }
  }
});

const ZP = paramsFor(1024).climate;
const ZN = 1024, ZG = 256, ZC = 128;
const LAYOUT: ZoneLayout = { n: ZN, seed: 3, homeY: 300 };

/** All land at one height, with even rain. */
function flatWorld(gN: number) {
  return { h: new Float64Array(gN * gN).fill(10), rain: new Float64Array(gN * gN).fill(1), isSea: new Uint8Array(gN * gN) };
}

/** The mean of each row of a C field. */
function rowMeans(f: Float32Array, cN: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < cN; y++) {
    let s = 0;
    for (let x = 0; x < cN; x++) s += f[y * cN + x];
    out.push(s / cN);
  }
  return out;
}

test("zoned fields are sized to C, finite, in range and seamless, and temperature runs from equator to pole", () => {
  const { h, rain, isSea } = ridgeWorld(ZG);
  const c = climateFields(h, rain, isSea, ZG, ZP, LAYOUT);
  assert.ok(c.temp, "a zoned world has a temperature");
  for (const f of [c.moisture, c.wind, c.temp as Float32Array]) {
    assert.equal(f.length, ZC * ZC);
    for (const v of f) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `value ${v}`);
    assert.ok(seamRatio(f, ZC) <= 1, `seam ${seamRatio(f, ZC)}`);
  }
  const eq = equatorOf(ZN, LAYOUT.homeY, ZP.zones!.homeLat);
  assert.equal(c.equatorY, eq);
  const means = rowMeans(c.temp as Float32Array, ZC);
  const eqRow = Math.floor(eq / 8) % ZC, poleRow = Math.floor((eq + ZN / 2) / 8) % ZC;
  const hottest = means.indexOf(Math.max(...means)), coldest = means.indexOf(Math.min(...means));
  const ring = (a: number, b: number) => Math.min(Math.abs(a - b), ZC - Math.abs(a - b));
  assert.ok(ring(hottest, eqRow) <= 8, `hottest row ${hottest}, equator row ${eqRow}`);
  assert.ok(ring(coldest, poleRow) <= 8, `coldest row ${coldest}, pole row ${poleRow}`);
  assert.ok(means[eqRow] > 0.85 && means[poleRow] < 0.2, `equator ${means[eqRow]}, pole ${means[poleRow]}`);
});

test("with no layout, or no zones in the params, there is no temperature and the moisture is the unzoned one", () => {
  const { h, rain, isSea } = ridgeWorld(ZG);
  const plain: ClimateParams = { ...ZP, zones: undefined };
  const base = climateFields(h, rain, isSea, ZG, plain);
  const noAt = climateFields(h, rain, isSea, ZG, ZP);
  const noZones = climateFields(h, rain, isSea, ZG, plain, LAYOUT);
  for (const c of [base, noAt, noZones]) {
    assert.equal(c.temp, undefined);
    assert.equal(c.equatorY, undefined);
  }
  assert.deepEqual(noAt.moisture, base.moisture);
  assert.deepEqual(noZones.moisture, base.moisture);
  assert.deepEqual(noZones.wind, base.wind);
});

test("zoned climate is deterministic", () => {
  const { h, rain, isSea } = ridgeWorld(ZG);
  const home = new Uint8Array(ZC * ZC);
  for (let y = 34; y < 40; y++) for (let x = 20; x < 30; x++) home[y * ZC + x] = 1;
  const at = { ...LAYOUT, home };
  assert.deepEqual(climateFields(h, rain, isSea, ZG, ZP, at), climateFields(h, rain, isSea, ZG, ZP, at));
});

test("the home island keeps the temperate plateau exactly, and far from home the equator is hot and the pole cold", () => {
  const { h, rain, isSea } = flatWorld(ZG);
  const home = new Uint8Array(ZC * ZC);
  const hy = Math.floor(LAYOUT.homeY / 8);
  for (let y = hy - 4; y < hy + 4; y++) for (let x = 40; x < 56; x++) home[y * ZC + x] = 1;
  const plain = climateFields(h, rain, isSea, ZG, { ...ZP, zones: undefined });
  const c = climateFields(h, rain, isSea, ZG, ZP, { ...LAYOUT, home });
  const temp = c.temp as Float32Array;
  for (let i = 0; i < home.length; i++) {
    if (home[i] === 0) continue;
    assert.equal(temp[i], TEMPERATE, `home node ${i % ZC},${Math.floor(i / ZC)}`);
    assert.equal(c.moisture[i], plain.moisture[i], `home moisture ${i % ZC},${Math.floor(i / ZC)}`);
  }
  const eq = c.equatorY as number;
  const eqRow = Math.floor(eq / 8) % ZC, poleRow = Math.floor((eq + ZN / 2) / 8) % ZC;
  for (let x = 0; x < ZC; x++) {
    assert.ok(temp[eqRow * ZC + x] > 0.9, `equator ${x}: ${temp[eqRow * ZC + x]}`);
    assert.ok(temp[poleRow * ZC + x] < 0.1, `pole ${x}: ${temp[poleRow * ZC + x]}`);
  }
});

test("rain by zone: the equator is wetter than the dry belt, and the dry belt drier than the temperate plateau", () => {
  const { h, rain, isSea } = flatWorld(ZG);
  const c = climateFields(h, rain, isSea, ZG, ZP, LAYOUT);
  const eq = c.equatorY as number;
  const means = rowMeans(c.moisture, ZC);
  const band = (lo: number, hi: number): number => {
    let s = 0, k = 0;
    for (let y = 0; y < ZC; y++) {
      const lat = latitudeAt((y + 0.5) * 8, ZN, eq);
      if (lat >= lo && lat <= hi) { s += means[y]; k++; }
    }
    assert.ok(k > 0, `rows at ${lo}-${hi}`);
    return s / k;
  };
  const equator = band(0, 0.04), dry = band(0.28, 0.34), plateau = band(0.56, 0.62);
  assert.ok(equator > dry + 0.2, `equator ${equator}, dry belt ${dry}`);
  assert.ok(plateau > dry + 0.2, `plateau ${plateau}, dry belt ${dry}`);
});
