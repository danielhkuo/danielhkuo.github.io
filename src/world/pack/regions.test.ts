import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTile } from "../bake/cells.ts";
import { worldLook } from "../bake/look.ts";
import { cutWindow, tileWindows } from "../bake/window.ts";
import type { BakeWorld } from "../bake/world.ts";
import { occlusionFloor } from "../gen/occlusion.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { generatedWorld, loadMask } from "../testing/bakefix.ts";
import { cutFromRegions, decodeCore, decodeRegion, encodeTiled, regionsFor, type Core, type RegionGrids } from "./regions.ts";
import { decodeFlightData, decodeWorld, encodeWorld } from "./world.ts";

const mask = loadMask();
const G_GRIDS = ["ground", "base", "conform", "waterLevel", "waterKind", "hand", "shore"] as const;
const C_GRIDS = ["moisture", "wind", "exposure", "debris", "rock", "regions"] as const;

interface Packed {
  whole: BakeWorld;
  flight: Awaited<ReturnType<typeof decodeFlightData>>;
  core: Core;
  regions: Map<string, RegionGrids>;
  sizes: { whole: number; tiled: number };
}

const cache = new Map<number, Promise<Packed>>();

/** The generated 1280 world, packed whole and in regions of `regionCells`, both decoded. */
function packed(regionCells: number): Promise<Packed> {
  let p = cache.get(regionCells);
  if (!p) {
    p = (async () => {
      const w = generatedWorld();
      const occlusion = { block: 16, data: occlusionFloor(w.ground, w.gN, w.n / w.gN, 16) };
      const one = await encodeWorld(w, { occlusion });
      const tiled = await encodeTiled(w, { regionCells, occlusion });
      const core = await decodeCore(tiled.core.bin);
      const regions = new Map<string, RegionGrids>();
      for (const r of tiled.regions) regions.set(`${r.rx},${r.ry}`, await decodeRegion(r.bin, core));
      return {
        whole: await decodeWorld(one.bin),
        flight: await decodeFlightData(one.bin),
        core,
        regions,
        sizes: { whole: one.bin.length, tiled: tiled.core.bin.length + tiled.regions.reduce((s, r) => s + r.bin.length, 0) },
      };
    })();
    cache.set(regionCells, p);
  }
  return p;
}

const lookup = (p: Packed) => (rx: number, ry: number): RegionGrids => {
  const r = p.regions.get(`${rx},${ry}`);
  if (!r) throw new Error(`region ${rx},${ry} not loaded`);
  return r;
};

test("the core holds every vector and scalar decodeWorld gives, and no grids", async () => {
  const { whole, core } = await packed(320);
  assert.equal(core.regionCells, 320);
  assert.equal(core.side, 4);
  const w = core.world;
  for (const k of ["n", "gN", "cN"] as const) assert.equal(w[k], whole[k]);
  for (const k of ["rivers", "roads", "falls", "stamps", "ponds", "bars", "built"] as const) assert.deepEqual(w[k], whole[k], k);
  for (const k of [...G_GRIDS, ...C_GRIDS]) {
    const a = w[k] as ArrayLike<number> | undefined;
    if (a) assert.equal(a.length, 0, k);
  }
});

test("the core carries the occlusion floor and a coarse overview for the haze", async () => {
  const { flight, core } = await packed(320);
  assert.equal(core.block, flight.block);
  assert.deepEqual(core.occlusion, flight.occlusion);
  const oN = flight.n / 8;
  assert.equal(core.overview.length, oN * oN);
  // One sample per 8 cells: G node (2·ox, 2·oy), in whole units, the sea as 0.
  for (let oy = 0; oy < oN; oy += 9) for (let ox = 0; ox < oN; ox += 7) {
    const h = flight.ground[2 * oy * flight.gN + 2 * ox];
    const want = h <= 0 ? 0 : Math.min(255, Math.max(1, Math.round(h)));
    assert.equal(core.overview[oy * oN + ox], want, `overview ${ox},${oy}`);
  }
});

for (const regionCells of [320, 640]) {
  test(`windows cut from ${regionCells}-cell regions equal windows cut from the whole decoded world`, async () => {
    const p = await packed(regionCells);
    const nT = p.whole.n / 256;
    for (let ty = 0; ty < nT; ty++) for (let tx = 0; tx < nT; tx++) {
      const { g, c } = tileWindows(p.whole, tx, ty);
      const a = cutFromRegions(p.core, lookup(p), g, c);
      const b = cutWindow(p.whole, g, c);
      assert.deepEqual(a.gWin, b.gWin);
      assert.deepEqual(a.cWin, b.cWin);
      for (const k of [...G_GRIDS, ...C_GRIDS]) assert.deepEqual(a[k], b[k], `tile ${tx},${ty}: ${k}`);
    }
  });
}

test("a tile baked from regions equals the tile baked from the whole world file", async () => {
  const p = await packed(320);
  const look = worldLook(p.whole.n, buildPalette(MIDDAY));
  for (const [tx, ty] of [[0, 0], [4, 4], [2, 1], [4, 0]]) {
    const { g, c } = tileWindows(p.whole, tx, ty);
    const a = buildTile(cutFromRegions(p.core, lookup(p), g, c), look, mask, tx, ty);
    const b = buildTile(p.whole, look, mask, tx, ty);
    for (const k of ["surf", "mat", "light", "flags", "aux"] as const) assert.deepEqual(a[k], b[k], `tile ${tx},${ty}: ${k}`);
  }
});

test("regionsFor lists exactly the regions a window touches, across the seam", async () => {
  const { core } = await packed(320);
  // A tile at the world's corner: its windows run off the north and west edges and wrap to the far side.
  const { g, c } = tileWindows(core.world, 0, 0);
  const got = regionsFor(core, g, c).map((r) => `${r.rx},${r.ry}`).sort();
  assert.ok(got.includes("0,0") && got.includes("3,3") && got.includes("3,0") && got.includes("0,3"), got.join(" "));
  assert.equal(new Set(got).size, got.length, "each region once");
  // Every region it lists is needed: cutting with only those loaded works.
  const p = await packed(320);
  const only = new Set(got);
  cutFromRegions(core, (rx, ry) => {
    assert.ok(only.has(`${rx},${ry}`), `asked for unlisted region ${rx},${ry}`);
    return lookup(p)(rx, ry);
  }, g, c);
});

test("splitting into regions costs little: the pieces are within 15 % of the whole file", async () => {
  const { sizes } = await packed(320);
  assert.ok(sizes.tiled <= sizes.whole * 1.15, `${sizes.tiled} vs ${sizes.whole}`);
});

test("a damaged region or core file is refused with a decode error", async () => {
  const w = generatedWorld();
  const tiled = await encodeTiled(w, { regionCells: 640 });
  const core = await decodeCore(tiled.core.bin);
  const bad = tiled.regions[1].bin.slice();
  bad[Math.floor(bad.length / 2)] ^= 0xff;
  await assert.rejects(decodeRegion(bad, core));
  await assert.rejects(decodeCore(tiled.core.bin.slice(0, 40)));
});
