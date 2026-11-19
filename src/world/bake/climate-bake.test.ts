// The bake with climates is still a pure function of position: a crop of a larger bake, a tile from its window and a
// tile from the whole world agree to the byte. A temperate world bakes as one with no temperature, and dunes are relief.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DESERT_RAIN, ergAt } from "../biome.ts";
import { isCanopy, MATERIAL as M, MATERIAL_NAMES } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { loadMask } from "../testing/bakefix.ts";
import { buildCells, buildTile, type Cells } from "./cells.ts";
import { worldLook } from "./look.ts";
import { cutWindow, tileWindows } from "./window.ts";
import { blankWorld, type BakeWorld } from "./world.ts";

const mask = loadMask();
const N = 1024;
const look = worldLook(N, buildPalette(MIDDAY));
const ARRAYS = ["surf", "mat", "light", "flags", "aux"] as const;

/** 0 at 0, 1 half way round, 0 again at the end: a periodic ramp. */
function tri(i: number, n: number): number {
  return 1 - Math.abs(1 - (2 * i) / n);
}

/**
 * A 1024 world that holds every climate: the pole on y = 0 and the equator on y = 512, temp a triangle wave between;
 * moisture 0.05 round x = 0 rising to 0.95 round x = 512. Flat skerry land at 6, gentle hills on x 384–640, a sea strip on
 * x 800–864, and no rivers.
 */
function climateWorld(): BakeWorld {
  const w = blankWorld(N, 6);
  const { gN, cN } = w;
  w.regions.fill(0);
  w.regions.fill(1, 5 * cN * cN, 6 * cN * cN);
  for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
    const i = gy * gN + gx;
    w.hand[i] = 8;
    if (gx >= 96 && gx < 160) w.ground[i] = 6 + 3 * Math.sin((2 * Math.PI * gx) / 32) * Math.sin((2 * Math.PI * gy) / 32);
    if (gx >= 200 && gx < 216) {
      w.ground[i] = -3;
      w.waterKind[i] = 1;
      w.hand[i] = 0;
    }
  }
  w.temp = new Float32Array(cN * cN);
  for (let cy = 0; cy < cN; cy++) for (let cx = 0; cx < cN; cx++) {
    const i = cy * cN + cx;
    w.temp[i] = tri(cy, cN);
    w.moisture[i] = 0.05 + 0.9 * Math.min(1, Math.max(0, (tri(cx, cN) - 0.2) / 0.6));
    w.wind[i] = 0.3;
    w.exposure[i] = 0.5;
  }
  return w;
}

let memo: BakeWorld | null = null;
function world(): BakeWorld {
  memo ??= climateWorld();
  return memo;
}

function crop(c: Cells, k: (typeof ARRAYS)[number], dx: number, dy: number, w: number, h: number): ArrayLike<number> {
  const src = c[k], out = new (src.constructor as new (n: number) => typeof src)(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = src[(y + dy) * c.w + x + dx];
  return out;
}

const DESERT = new Set<number>([M.desertSand, M.desertSandDeep, M.reg, M.earthPale, M.salt]);
const JUNGLE = new Set<number>([M.floorJungle, M.jungleCool, M.jungleMid, M.jungleWarm, M.jungleBright, M.jungleBloom]);
const TUNDRA = new Set<number>([M.tundraCool, M.tundraMid, M.tundraWarm, M.lichen, M.sedge, M.pool, M.frostNet, M.bog, M.bogRed]);
const POLAR = new Set<number>([M.packIce, M.packIceBlue, M.snow]);

test("a crop of a larger bake equals the smaller bake, in every climate and across the seam", () => {
  const w = world();
  const seen = new Set<number>();
  // Desert across the x seam; jungle; tundra; the polar sea across both seams; the corner.
  for (const [x0, y0] of [[980, 400], [470, 470], [300, 80], [790, 990], [1000, 1000], [40, 420]]) {
    const small = buildCells(w, look, mask, x0, y0, 96, 96);
    const big = buildCells(w, look, mask, x0 - 40, y0 - 40, 176, 176);
    for (const k of ARRAYS) assert.deepEqual(small[k], crop(big, k, 40, 40, 96, 96), `window ${x0},${y0}: ${k}`);
    for (const m of small.mat) seen.add(m);
  }
  const names = [...seen].map((m) => MATERIAL_NAMES[m]);
  assert.ok([...seen].some((m) => DESERT.has(m)), `no desert in ${names}`);
  assert.ok([...seen].some((m) => JUNGLE.has(m)), `no jungle in ${names}`);
  assert.ok([...seen].some((m) => TUNDRA.has(m)), `no tundra in ${names}`);
  assert.ok([...seen].some((m) => POLAR.has(m)), `no pack ice or snow in ${names}`);
});

test("every tile baked from its window equals the tile baked from the whole climate world", () => {
  // The climate world, and the same world dry everywhere, whose hot rows are dunes from edge to edge.
  const dry: BakeWorld = { ...world(), moisture: new Float32Array(world().moisture.length).fill(0.05) };
  const nT = N / 256;
  for (const [label, w] of [["climate", world()], ["dry", dry]] as const) {
    for (let ty = 0; ty < nT; ty++) for (let tx = 0; tx < nT; tx++) {
      const { g, c } = tileWindows(w, tx, ty);
      const fromWindow = buildTile(cutWindow(w, g, c), look, mask, tx, ty);
      const fromWorld = buildTile(w, look, mask, tx, ty);
      for (const k of ARRAYS) assert.deepEqual(fromWindow[k], fromWorld[k], `${label} tile ${tx},${ty}: ${k}`);
    }
  }
});

test("a world all at the temperate plateau bakes as one with no temperature", () => {
  const w = world();
  const none: BakeWorld = { ...w, temp: undefined };
  const plateau: BakeWorld = { ...w, temp: new Float32Array(w.temp!.length).fill(0.5) };
  const nT = N / 256;
  for (let ty = 0; ty < nT; ty++) for (let tx = 0; tx < nT; tx++) {
    const a = buildTile(none, look, mask, tx, ty), b = buildTile(plateau, look, mask, tx, ty);
    for (const k of ARRAYS) assert.deepEqual(b[k], a[k], `tile ${tx},${ty}: ${k}`);
  }
});

test("dunes are relief: desert sand rises and falls, and the same ground with no climate is flat", (t) => {
  // The climate world, dry everywhere: the sand seas lie where they lie, not where this world's dry strip is.
  const w: BakeWorld = { ...world(), moisture: new Float32Array(world().moisture.length).fill(0.05) };
  const none: BakeWorld = { ...w, temp: undefined };
  // A 64 × 64 patch of hot, dry, flat land (off the hills and the sea) that lies in a sand sea, at y ≈ 420 (temp about 0.8).
  let at: [number, number] | null = null;
  for (let x0 = -64; x0 <= 320 && !at; x0 += 16) {
    for (let y0 = 400; y0 <= 440 && !at; y0 += 8) {
      let inside = 0;
      for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) if (ergAt((x0 + x + N) % N, y0 + y, N) >= 1) inside++;
      if (inside >= 128) at = [(x0 + N) % N, y0];
    }
  }
  assert.ok(at, "a patch in a sand sea");
  const [x0, y0] = at;
  const cy = Math.floor((y0 + 32) / 8), cx = Math.floor(((x0 + 32) % N) / 8);
  assert.ok(w.temp![cy * w.cN + cx] > 0.75 && w.moisture[cy * w.cN + cx] < DESERT_RAIN / 2, "the patch is hot and dry");
  const hot = buildCells(w, look, mask, x0, y0, 64, 64), cool = buildCells(none, look, mask, x0, y0, 64, 64);
  let lo = Infinity, hi = -Infinity, coolLo = Infinity, coolHi = -Infinity, sand = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = y * 64 + x;
    if (ergAt((x0 + x) % N, y0 + y, N) < 1) continue;
    if (hot.mat[i] === M.desertSand || hot.mat[i] === M.desertSandDeep) {
      sand++;
      lo = Math.min(lo, hot.surf[i]);
      hi = Math.max(hi, hot.surf[i]);
    }
    if (isCanopy[cool.mat[i]] !== 1) {
      coolLo = Math.min(coolLo, cool.surf[i]);
      coolHi = Math.max(coolHi, cool.surf[i]);
    }
  }
  t.diagnostic(`patch ${x0},${y0}: ${sand} sand cells, dune relief ${(hi - lo).toFixed(2)}, relief with no climate ${(coolHi - coolLo).toFixed(3)}`);
  assert.ok(sand > 500, `sand cells ${sand}`);
  assert.ok(hi - lo > 1, `dune relief ${hi - lo}`);
  assert.ok(coolHi - coolLo < 0.05, `relief with no climate ${coolHi - coolLo}`);
});
