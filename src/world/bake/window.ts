// Baking from a window of the world's grids instead of the whole world. A bake worker for a large world cannot hold
// every grid; it holds the vectors (rivers, roads, buildings) whole, and for each 256-cell tile it cuts the G and C
// nodes that tile reads, and the coast stamps that can reach them. A tile baked from its window is byte-identical to
// the same tile baked from the whole world: the world keeps its size n, gN and cN and its global coordinates, and
// only the grid storage and the stamp list shrink.

import { wrap } from "../core/torus.ts";
import { stampReach, type Stamp } from "../gen/stamps.ts";
import { buildTile, TILE, type Cells, type Look } from "./cells.ts";
import type { TileSource } from "./chunk.ts";
import type { BakeWorld, GridWindow } from "./world.ts";

export type { GridWindow };

/** A function that returns a world whose grids hold just these G and C windows (see cutWindow). */
export type WindowCutter = (g: GridWindow, c: GridWindow) => BakeWorld;

// A 256-cell tile whose north-west cell is T reads cells [T−65, T+283). That is G nodes [T/4−19, T/4+73]; the same
// reach on y, which runs further south than north because the tile itself extends south and tall ground projects up.
// The cover reads C nodes [T/8−2, T/8+33], and the climate is read at the C node nearest every cell of the window
// (dunes, dry streams), which is [T/8−9, T/8+35]. A node or two of slack past the measured reach, still inside 128² G
// nodes and 64² C nodes, and never past the G window's own cells, so no tile reads a region for C alone.
const G_BEFORE = 21;
const G_SPAN = 96;
const C_BEFORE = 10;
const C_SPAN = 47;

function placed(x0: number, y0: number, span: number, n: number): GridWindow {
  // A window wider than the grid would alias under the read formula; the whole grid covers every node.
  if (span >= n) return { x0: 0, y0: 0, w: n, h: n };
  return { x0, y0, w: span, h: span };
}

/**
 * The G and C node windows that buildTile reads for tile (tx, ty), in global node coordinates (they may start below
 * zero or run past the grid's size; reads wrap). A window may be larger than the bake strictly needs; it is fixed per
 * tile, so the same tile always gets the same window.
 */
export function tileWindows(world: Pick<BakeWorld, "n" | "gN" | "cN">, tx: number, ty: number): { g: GridWindow; c: GridWindow } {
  const gPer = (TILE * world.gN) / world.n, cPer = (TILE * world.cN) / world.n;
  return {
    g: placed(tx * gPer - G_BEFORE, ty * gPer - G_BEFORE, G_SPAN, world.gN),
    c: placed(tx * cPer - C_BEFORE, ty * cPer - C_BEFORE, C_SPAN, world.cN),
  };
}

// How far past its reach a stamp still counts as reaching a cell. The bake takes a stamp whose centre lies within its
// reach and 2 of the cells it builds (cells.ts stampsNear); two more keep this test the wider of the two whatever the
// rounding.
const STAMP_SLACK = 4;

/**
 * Whether coast stamp `s` can change a cell of [x0, x0 + w) × [y0, y0 + h) on a torus n cells round: its centre lies
 * within its reach, and a little slack, of the rectangle. Never narrower than the bake's own test, so a window that
 * keeps the stamps reaching its cells bakes as the whole world does.
 */
export function stampReaches(s: Stamp, n: number, x0: number, y0: number, w: number, h: number): boolean {
  const e = stampReach(s) + STAMP_SLACK;
  return wrap(s.x - x0 + e, n) <= w + 2 * e && wrap(s.y - y0 + e, n) <= h + 2 * e;
}

/**
 * Whether stamp `s` can change a cell under G window `g` (in nodes; the world is n cells and gN nodes a side). A tile
 * reads no cell outside its G window, whose nodes it upsamples, so no other stamp can change the tile.
 */
export function stampReachesWindow(s: Stamp, n: number, gN: number, g: GridWindow): boolean {
  const per = n / gN;
  return stampReaches(s, n, g.x0 * per, g.y0 * per, g.w * per, g.h * per);
}

function fillWindow(src: ArrayLike<number>, n: number, win: GridWindow, out: Float32Array | Uint8Array): void {
  const { x0, y0, w, h } = win;
  for (let y = 0; y < h; y++) {
    const srcRow = wrap(y0 + y, n) * n, dstRow = y * w;
    for (let x = 0; x < w; x++) out[dstRow + x] = src[srcRow + wrap(x0 + x, n)];
  }
}

function cutF32(src: Float32Array, n: number, win: GridWindow): Float32Array {
  const out = new Float32Array(win.w * win.h);
  fillWindow(src, n, win, out);
  return out;
}

function cutU8(src: Uint8Array, n: number, win: GridWindow): Uint8Array {
  const out = new Uint8Array(win.w * win.h);
  fillWindow(src, n, win, out);
  return out;
}

/** Six planes, each a window, archetype-major — the same layout as the full regions grid. */
function cutRegions(src: Float32Array, n: number, win: GridWindow): Float32Array {
  const plane = n * n, wp = win.w * win.h;
  const out = new Float32Array(wp * 6);
  for (let p = 0; p < 6; p++) fillWindow(src.subarray(p * plane, (p + 1) * plane), n, win, out.subarray(p * wp, (p + 1) * wp));
  return out;
}

/**
 * A copy of `world` whose G-grid arrays hold only window `g` and whose C-grid arrays hold only window `c` (row-major,
 * w × h each), with gWin and cWin set, and whose stamps are the ones that can reach `g` (stampReachesWindow), in world
 * order. Other vectors, indexes and scalars are shared, not copied. Nodes are read from the whole world with wrapping,
 * so a window may straddle the torus seam.
 */
export function cutWindow(world: BakeWorld, g: GridWindow, c: GridWindow): BakeWorld {
  return {
    ...world,
    gWin: g,
    cWin: c,
    stamps: world.stamps?.filter((s) => stampReachesWindow(s, world.n, world.gN, g)),
    ground: cutF32(world.ground, world.gN, g),
    waterLevel: cutF32(world.waterLevel, world.gN, g),
    waterKind: cutU8(world.waterKind, world.gN, g),
    hand: cutF32(world.hand, world.gN, g),
    shore: cutU8(world.shore, world.gN, g),
    base: world.base ? cutF32(world.base, world.gN, g) : undefined,
    conform: world.conform ? cutF32(world.conform, world.gN, g) : undefined,
    moisture: cutF32(world.moisture, world.cN, c),
    wind: cutF32(world.wind, world.cN, c),
    exposure: cutF32(world.exposure, world.cN, c),
    debris: cutF32(world.debris, world.cN, c),
    rock: cutU8(world.rock, world.cN, c),
    regions: cutRegions(world.regions, world.cN, c),
    temp: world.temp ? cutF32(world.temp, world.cN, c) : undefined,
    arid: world.arid ? cutF32(world.arid, world.cN, c) : undefined,
  };
}

/** A copy of `world` with every G- and C-grid array emptied: what a worker holds besides its windows. */
export function strippedWorld(world: BakeWorld): BakeWorld {
  return {
    ...world,
    ground: new Float32Array(0),
    waterLevel: new Float32Array(0),
    waterKind: new Uint8Array(0),
    hand: new Float32Array(0),
    shore: new Uint8Array(0),
    base: world.base ? new Float32Array(0) : undefined,
    conform: world.conform ? new Float32Array(0) : undefined,
    moisture: new Float32Array(0),
    wind: new Float32Array(0),
    exposure: new Float32Array(0),
    debris: new Float32Array(0),
    rock: new Uint8Array(0),
    regions: new Float32Array(0),
    temp: world.temp ? new Float32Array(0) : undefined,
    arid: world.arid ? new Float32Array(0) : undefined,
  };
}

/**
 * A tile source like tileCache, with a most-recently-used cache of `capacity` tiles, that builds each tile from the
 * world `cut` returns for that tile's windows (tileWindows). Tile indices are wrapped.
 */
export function windowTileSource(world: Pick<BakeWorld, "n" | "gN" | "cN">, cut: WindowCutter, look: Look, mask: Uint8Array, capacity: number): TileSource {
  const nT = world.n / TILE;
  const cache = new Map<number, Cells>();
  return (tx, ty) => {
    const wx = wrap(tx, nT), wy = wrap(ty, nT);
    const key = wy * nT + wx;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const { g, c } = tileWindows(world, wx, wy);
    const tile = buildTile(cut(g, c), look, mask, wx, wy);
    cache.set(key, tile);
    if (cache.size > capacity) cache.delete(cache.keys().next().value as number);
    return tile;
  };
}
