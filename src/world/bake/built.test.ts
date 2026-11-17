import assert from "node:assert/strict";
import { test } from "node:test";
import { type Built, indexBuilt } from "../gen/built.ts";
import { house, mark, sculpt, standAt, T_WALL } from "../gen/structures.ts";
import { loadMask, M_LAND, plainLook } from "../testing/bakefix.ts";
import { buildCells } from "./cells.ts";
import { bakeWindow, tileCache } from "./chunk.ts";
import { blankWorld, riverIndex, type BakeWorld } from "./world.ts";

const mask = loadMask();
const M_WALL = 40, M_ROOF = 41, M_YARD = 42, M_WINDOW = 43, M_ROAD = 44, M_PATH = 45, M_RETAIN = 46, M_GRASS = 47, M_VINE = 48;

/** A flat world at height 10 with a house at (100, 100), a pad, a terraced slope and a road. */
function builtWorld(slope = false): BakeWorld {
  const w = blankWorld(1024, 10);
  if (slope) for (let gy = 0; gy < w.gN; gy++) for (let gx = 0; gx < w.gN; gx++) w.ground[gy * w.gN + gx] = 10 + Math.max(0, 60 - gy) * 1.2;
  const s = sculpt(8, 6);
  house(s, 1, 0, 6, 5, 5, 3, { gable: 0, wallMat: M_WALL, roofMat: M_ROOF, openings: 0, chimney: false });
  for (let x = 0; x < 8; x++) s.paint[5 * 8 + x] = M_YARD;
  mark(s, 3, 4, 2, M_WINDOW, 128);
  // A second house straddling the world's seam.
  const t = sculpt(6, 5);
  house(t, 0, 0, 6, 5, 5, 3, { gable: 1, wallMat: M_WALL, roofMat: M_ROOF, openings: 0, chimney: false });
  const built: Built = {
    structures: [standAt(s, 100, 100, 10), standAt(t, 1023, 1022, 10)],
    conforms: [
      { kind: "flat", x: 300, y: 300, rx: 10, ry: 10, round: true, level: 12, skirt: 5, limit: 3 },
      { kind: "terrace", x: 500, y: 120, rx: 60, ry: 50, round: true, level: 1.8, skirt: 10, limit: 2.5 },
    ],
    roads: [],
    mats: { path: M_PATH, road: M_ROAD, retaining: M_RETAIN, yard: M_GRASS, vine: M_VINE },
  };
  w.built = indexBuilt(built, 1024);
  w.roads = riverIndex([{ vertices: [60, 140, 2, 64, 140, 2, 68, 141, 2, 72, 143, 2, 76, 146, 2, 80, 150, 2, 84, 150, 2, 88, 150, 2], stride: 3 }], 1024);
  return w;
}

test("a structure stands in the cells: wall row, roof behind it, yard paint, fixed light", () => {
  const w = builtWorld();
  const c = buildCells(w, plainLook(), mask, 64, 64, 96, 96);
  const at = (x: number, y: number) => (y - 64) * 96 + (x - 64);
  // The house's raster is 8 × 6 centred on (100, 100): its north-west corner is cell (96, 97).
  const south = 97 + 4;
  for (let x = 97; x <= 102; x++) {
    assert.equal(c.mat[at(x, south)], M_WALL);
    assert.equal(c.surf[at(x, south)], 15);
    assert.equal(c.light[at(x, south)], T_WALL);
    assert.equal(c.mat[at(x, south - 1)], M_ROOF);
    assert.ok(c.surf[at(x, south - 1)] > 15);
    assert.equal(c.mat[at(x, south + 1)], M_YARD);
    assert.equal(c.surf[at(x, south + 1)], 10);
  }
  assert.equal(c.mat[at(90, 100)], M_LAND);
  assert.equal(c.surf[at(90, 100)], 10);
});

test("conforms are cut at cell size: a level pad, stepped terraces with retaining walls", () => {
  const flat = buildCells(builtWorld(), plainLook(), mask, 270, 270, 64, 64);
  assert.equal(flat.surf[30 * 64 + 30], 12);
  assert.equal(flat.surf[2 * 64 + 2], 10);
  // The pad is a clearing.
  assert.equal(flat.mat[30 * 64 + 30], M_GRASS);
  const terr = buildCells(builtWorld(true), plainLook(), mask, 470, 90, 64, 64);
  const levels = new Set<number>();
  let walls = 0, ground = 0;
  for (let y = 0; y < 64; y++) for (let x = 20; x < 44; x++) {
    const i = y * 64 + x;
    levels.add(Math.round(terr.surf[i] * 100));
    if (terr.mat[i] === M_RETAIN) walls++;
    if (terr.mat[i] === M_GRASS || terr.mat[i] === M_VINE) ground++;
  }
  const sorted = [...levels].sort((a, b) => a - b);
  assert.ok(sorted.length >= 4 && sorted.length <= 12, `${sorted.length} levels`);
  for (let k = 1; k < sorted.length; k++) assert.equal(sorted[k] - sorted[k - 1], 250);
  assert.ok(walls > 40 && ground > 400, `${walls} wall cells, ${ground} garden cells`);
});

test("built cells are a pure function of position: any window, and a world period away", () => {
  const w = builtWorld(true), look = plainLook(true);
  for (const [x0, y0] of [[70, 80], [1000, 1000], [470, 90]] as const) {
    const small = buildCells(w, look, mask, x0, y0, 64, 64);
    const big = buildCells(w, look, mask, x0 - 29, y0 - 13, 128, 96);
    const far = buildCells(w, look, mask, x0 - 1024, y0 + 2048, 64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const a = y * 64 + x, b = (y + 13) * 128 + x + 29;
      for (const k of ["surf", "mat", "light", "flags", "aux"] as const) {
        assert.equal(small[k][a], big[k][b], `${k} at ${x0 + x},${y0 + y}`);
        assert.equal(small[k][a], far[k][a], `${k} at ${x0 + x},${y0 + y} across the wrap`);
      }
    }
  }
  // The house on the seam is whole in a window that spans it.
  const seam = buildCells(builtWorld(), look, mask, 1000, 1000, 64, 64);
  let wall = 0;
  for (const m of seam.mat) if (m === M_WALL) wall++;
  assert.equal(wall, 6);
});

test("the painter shows the south wall under the roof, a window on it, and the road as a joined line", () => {
  const w = builtWorld(), look = plainLook();
  look.isWater[M_ROAD] = 0;
  const tiles = tileCache(w, look, mask, 16);
  const x0 = 40, r0 = 40, W = 96, H = 96;
  const px = bakeWindow(w, look, mask, tiles, x0, r0, W, H);
  const matAt = (x: number, r: number) => px[(r - r0) * W + (x - x0)] & 255;
  // Column 99 of the house: its wall row is world row 101, top at 15: bake row floor(0.8·101) − 15 = 65.
  const top = Math.floor(0.8 * 101) - 15;
  assert.equal(matAt(99, top - 1), M_ROOF);
  for (let r = top; r < top + 5; r++) assert.ok(matAt(99, r) === M_WALL || matAt(99, r) === M_WINDOW, `row ${r}: ${matAt(99, r)}`);
  // The window: raster column 3 is world column 99, two above the base.
  assert.equal(matAt(99, Math.floor(0.8 * 101) - 12), M_WINDOW);
  assert.equal(matAt(98, Math.floor(0.8 * 101) - 12), M_WALL);
  // The road: every vertex's pixel is road, and road pixels form one 8-connected line.
  const road: number[] = [];
  for (let i = 0; i < px.length; i++) if ((px[i] & 255) === M_ROAD) road.push(i);
  assert.ok(road.length >= 26, `${road.length} road pixels`);
  const set = new Set(road);
  let ends = 0;
  for (const i of road) {
    let nb = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && set.has(i + dy * W + dx)) nb++;
    assert.ok(nb >= 1, "no stray road pixel");
    if (nb === 1) ends++;
  }
  assert.ok(ends <= 2, `${ends} loose ends`);
  // Baking the same window as part of a larger one gives the same material and light (depth is relative to the window).
  const big = bakeWindow(w, look, mask, tiles, x0 - 16, r0 - 8, W + 32, H + 16);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) assert.equal(px[r * W + c] & 0xffff, big[(r + 8) * (W + 32) + c + 16] & 0xffff);
});
