// The temperature ships: it round-trips whole and in regions, to a 500th, with the temperate plateau exact; and a
// world without it decodes as one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { blankWorld, type BakeWorld } from "../bake/world.ts";
import { MATERIAL } from "../look/materials.ts";
import { cutFromRegions, decodeCore, decodeRegion, encodeTiled, type RegionGrids } from "./regions.ts";
import { decodeWorld, encodeWorld, quantised, TEMP_SCALE } from "./world.ts";

/** A small world, with or without a temperature that holds the plateau, both ends and values between steps. */
function smallWorld(withTemp: boolean): BakeWorld {
  const w = blankWorld(256, 3);
  if (!withTemp) return w;
  const cN = w.cN, temp = new Float32Array(cN * cN);
  for (let cy = 0; cy < cN; cy++) for (let cx = 0; cx < cN; cx++) {
    const i = cy * cN + cx;
    // A ramp over y, a plateau of exactly 0.5 in the middle rows, and the odd value off the 500-step grid.
    temp[i] = cy >= 12 && cy < 18 ? 0.5 : cy / (cN - 1);
    if ((cx * 7 + cy) % 11 === 0) temp[i] = (Math.sin(i) + 1) / 2;
  }
  temp[0] = 0;
  temp[1] = 1;
  temp[2] = 0.5;
  temp[3] = 0.123456;
  w.temp = temp;
  return w;
}

test("a world without temperature has no temp section and decodes without one", async () => {
  const w = smallWorld(false);
  const { bin, sections } = await encodeWorld(w);
  assert.ok(!sections.some((s) => s.name === "temp"), `sections ${sections.map((s) => s.name)}`);
  const d = await decodeWorld(bin, sections);
  assert.equal(d.temp, undefined);
});

test("temperature round-trips to a 500th, and the plateau to the bit", async () => {
  const w = smallWorld(true);
  const { bin, sections } = await encodeWorld(w);
  assert.ok(sections.some((s) => s.name === "temp"), "a temp section");
  const d = await decodeWorld(bin, sections);
  const src = w.temp as Float32Array, got = d.temp as Float32Array;
  assert.ok(got, "decoded temp");
  assert.equal(got.length, src.length);
  let plateau = 0;
  for (let i = 0; i < src.length; i++) {
    assert.ok(Math.abs(got[i] - src[i]) <= 1 / 1000 + 1e-7, `node ${i}: ${got[i]} against ${src[i]}`);
    if (src[i] === 0.5) {
      plateau++;
      assert.equal(got[i], 0.5, `plateau node ${i}`);
    }
  }
  assert.ok(plateau > 100, `plateau nodes ${plateau}`);
  assert.equal(got[0], 0);
  assert.equal(got[1], 1);
});

for (const withTemp of [true, false]) {
  test(`temperature ships in regions and is cut back whole (${withTemp ? "with" : "without"} temp)`, async () => {
    const w = smallWorld(withTemp);
    const tiled = await encodeTiled(w, { regionCells: 128 });
    const core = await decodeCore(tiled.core.bin);
    if (!withTemp) {
      assert.equal(core.world.temp, undefined);
    } else {
      assert.ok(core.world.temp, "the core says the world has climates");
      assert.equal(core.world.temp.length, 0, "and holds none of it");
    }
    const regions = new Map<string, RegionGrids>();
    for (const r of tiled.regions) regions.set(`${r.rx},${r.ry}`, await decodeRegion(r.bin, core));
    const { cN, gN } = w, cS = 128 / 8;
    const q = withTemp ? quantised(w.temp as Float32Array, TEMP_SCALE) : null;
    for (const reg of regions.values()) {
      if (!q) {
        assert.equal(reg.temp, undefined, `region ${reg.rx},${reg.ry}`);
        continue;
      }
      assert.ok(reg.temp, `region ${reg.rx},${reg.ry} has temp`);
      assert.equal(reg.temp.length, cS * cS);
      for (let y = 0; y < cS; y++) for (let x = 0; x < cS; x++) {
        const want = q[(reg.ry * cS + y) * cN + reg.rx * cS + x];
        assert.ok(Math.abs(reg.temp[y * cS + x] - want) < 1e-7, `region ${reg.rx},${reg.ry} node ${x},${y}: ${reg.temp[y * cS + x]} against ${want}`);
      }
    }
    const whole = await decodeWorld((await encodeWorld(w)).bin);
    const cut = cutFromRegions(core, (rx, ry) => regions.get(`${rx},${ry}`) as RegionGrids, { x0: 0, y0: 0, w: gN, h: gN }, { x0: 0, y0: 0, w: cN, h: cN });
    if (!withTemp) {
      assert.equal(cut.temp, undefined);
      assert.equal(whole.temp, undefined);
    } else {
      assert.deepEqual(cut.temp, whole.temp);
    }
  });
}

test("a core of a world with climates carries the haze's washes beside its overview; one without does not", async () => {
  const world = blankWorld(256, 3);
  const plain = await decodeCore((await encodeTiled(world, { regionCells: 128 })).core.bin);
  assert.equal(plain.overviewWash, undefined);
  // A pole at the top and an equator at the bottom, bone dry: ice, then tundra, then sand.
  const cN = world.cN, temp = new Float32Array(cN * cN);
  for (let y = 0; y < cN; y++) for (let x = 0; x < cN; x++) temp[y * cN + x] = y / (cN - 1);
  world.temp = temp;
  world.arid = new Float32Array(cN * cN).fill(1);
  world.moisture.fill(0.05);
  const core = await decodeCore((await encodeTiled(world, { regionCells: 128 })).core.bin);
  const wash = core.overviewWash as Uint8Array;
  assert.equal(wash.length, cN * cN);
  assert.equal(wash[0], MATERIAL.snow);
  assert.equal(wash[(cN - 1) * cN], MATERIAL.desertSand);
  // The row nearest the plateau is left to the height.
  const mid = Math.round((cN - 1) / 2);
  assert.ok(wash[mid * cN] === MATERIAL.sageMid || wash[mid * cN] === MATERIAL.steppeMid);
  // The same world on the wet side: no sand at the equator, and the plateau's row left to the height.
  world.arid = undefined;
  const wet = (await decodeCore((await encodeTiled(world, { regionCells: 128 })).core.bin)).overviewWash as Uint8Array;
  assert.equal(wet[0], MATERIAL.snow);
  assert.equal(wet[(cN - 1) * cN], MATERIAL.jungleMid);
});

test("the dry side's share round-trips, ships only in the regions that have some, and is cut back whole", async () => {
  const world = blankWorld(256, 3);
  const { gN, cN } = world;
  world.temp = new Float32Array(cN * cN).fill(0.7);
  world.arid = new Float32Array(cN * cN);
  // The dry side is the right-hand half, with a ramp into it.
  for (let y = 0; y < cN; y++) for (let x = 0; x < cN; x++) world.arid[y * cN + x] = Math.min(1, Math.max(0, (x - cN / 2) / 4));
  const whole = await decodeWorld((await encodeWorld(world)).bin);
  for (let i = 0; i < cN * cN; i++) assert.ok(Math.abs((whole.arid as Float32Array)[i] - world.arid[i]) <= 0.005 + 1e-6, `node ${i}`);
  const tiled = await encodeTiled(world, { regionCells: 128 });
  const core = await decodeCore(tiled.core.bin);
  assert.ok(core.world.arid, "the core says the world has two sides");
  const regions = new Map<string, RegionGrids>();
  for (const r of tiled.regions) {
    const reg = await decodeRegion(r.bin, core);
    regions.set(`${reg.rx},${reg.ry}`, reg);
    assert.equal(reg.arid !== undefined, reg.rx === 1, `region ${reg.rx},${reg.ry}`);
  }
  const cut = cutFromRegions(core, (rx, ry) => regions.get(`${rx},${ry}`) as RegionGrids, { x0: 0, y0: 0, w: gN, h: gN }, { x0: 0, y0: 0, w: cN, h: cN });
  assert.deepEqual(cut.arid, whole.arid);
});
