// BakeWorld: everything the bake reads, on the torus. Heights and water live
// on the solver grid G (4 cells per node); climate, rock and region weights on
// the coarse grid C (8 cells per node); rivers are vectors.
//
// buildBakeWorld adapts the generator's stages (gen/pipeline.ts makeWorld).
// Stages that are not built yet are filled by the stand-ins in
// standin-land.ts, each marked STAND-IN there.

import { wrap } from "../core/torus.ts";
import type { WorldParams } from "../gen/params.ts";
import { type BuiltIndex, indexBuilt } from "../gen/built.ts";
import { makeWorld, type World } from "../gen/pipeline.ts";
import type { Stamp as CoastStamp } from "../gen/stamps.ts";
import { standinSeaBed } from "./standin-land.ts";

export const WATER = { land: 0, sea: 1, lake: 2, river: 3 } as const;
export const SHORE = { none: 0, beach: 1, rocky: 2, cliff: 3, cove: 4 } as const;
/** No surface, canopy included, stands above this. */
export const HMAX = 160;

/** Side of a river bucket, in cells. */
export const RIVER_BUCKET = 32;

/** River polylines with a bucket index over their segments. */
export interface RiverIndex {
  /** Per vertex: x, y (cells, unwrapped), width (px), distance along the reach (cells). */
  vertices: Float32Array;
  /** Buckets a side: n / RIVER_BUCKET. */
  bN: number;
  /** bucketStart[b] … bucketStart[b + 1]: this bucket's entries in `segments`. */
  bucketStart: Uint32Array;
  /** Vertex index of each segment's first vertex; the segment runs to the next vertex. Filed under the bucket of its first vertex. */
  segments: Uint32Array;
}

/** A closed polygon in cells, in its own unwrapped frame (wrap by n): even-odd fill, no repeated closing vertex. */
export interface Patch {
  /** x, y per vertex, quarter-cell snapped. */
  outline: Float32Array;
  /** Bounding box in whole cells: [x0, x1) × [y0, y1). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Ponds: the height of the still water. */
  level: number;
}

/** A patch from an outline; a closing vertex that repeats the first is dropped. */
export function patchOf(outline: ArrayLike<number>, level: number): Patch {
  let m = Math.floor(outline.length / 2);
  if (m > 1 && outline[0] === outline[2 * m - 2] && outline[1] === outline[2 * m - 1]) m--;
  const v = new Float32Array(2 * m);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < m; k++) {
    const x = outline[2 * k], y = outline[2 * k + 1];
    v[2 * k] = x;
    v[2 * k + 1] = y;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { outline: v, x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.floor(x1) + 1, y1: Math.floor(y1) + 1, level };
}

export interface BakeWorld {
  /** Cells a side; a multiple of 256. */
  n: number;
  /** n / 4 and n / 8. */
  gN: number;
  cN: number;

  // --- G grid, gN² each ---
  /** Ground height in units; sea bed is negative. */
  ground: Float32Array;
  /** Water surface: 0 on sea nodes, the lake's level on lake nodes; unused on land. */
  waterLevel: Float32Array;
  /** 0 land, 1 sea, 2 lake. */
  waterKind: Uint8Array;
  /** Height above nearest drainage, units. */
  hand: Float32Array;
  /** Shore class: 0 none, 1 beach, 2 rocky, 3 cliff, 4 cove. */
  shore: Uint8Array;

  /**
   * Crisp coasts: when present, a cell's ground is upsample(base), then the
   * coast stamps applied at cell size, then upsample(conform) — the rivers
   * stage's change to the ground on G.
   */
  base?: Float32Array;
  conform?: Float32Array;
  stamps?: readonly CoastStamp[];

  rivers: RiverIndex;
  /** Waterfalls: x, y (cells), drop (units) each. */
  falls: Float32Array;
  /** Oxbow ponds: still water with a soft shore. */
  ponds?: readonly Patch[];
  /** Point bars: pale sand inside large bends. */
  bars?: readonly Patch[];

  // --- C grid, cN² each ---
  moisture: Float32Array;
  wind: Float32Array;
  exposure: Float32Array;
  debris: Float32Array;
  /** 0 hard, 1 medium, 2 soft. */
  rock: Uint8Array;
  /** Six planes of cN², archetype-major, summing to 1 per node. */
  regions: Float32Array;

  /** What people built: structures, pads and terraces. Absent on a wild world. */
  built?: BuiltIndex;

  /**
   * When set, every G-grid array holds only this window of nodes (row-major, gWin.w × gWin.h) instead of gN²; the
   * bake reads global node (gx, gy), wrapped into [0, gN), at its offset inside the window. See bake/window.ts.
   */
  gWin?: GridWindow;
  /** The same for the C-grid arrays (each regions plane is cWin.w × cWin.h). */
  cWin?: GridWindow;
  /** Roads and paths, indexed like rivers; a vertex's width is 2 for a road, 1 for a path. */
  roads?: RiverIndex;
}

/** A rectangle of grid nodes: north-west node (x0, y0) in global coordinates, which may lie outside [0, size) and wrap, and size w × h. */
export interface GridWindow {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** One river polyline: x, y, width per vertex (cells, unwrapped; any consistent frame). */
export interface RiverLine {
  vertices: ArrayLike<number>;
  /** Values per vertex in `vertices`: 3 (x, y, width) or 4 (x, y, width, level). */
  stride: number;
}

/** Indexes river polylines for the bake. A segment may be no longer than RIVER_PIECE_REACH cells. */
export function riverIndex(lines: readonly RiverLine[], n: number): RiverIndex {
  let total = 0;
  for (const l of lines) total += Math.floor(l.vertices.length / l.stride);
  const vertices = new Float32Array(total * 4);
  const bN = n / RIVER_BUCKET;
  const count = new Uint32Array(bN * bN + 1);
  const firsts: number[] = [];
  let v = 0;
  for (const l of lines) {
    const m = Math.floor(l.vertices.length / l.stride);
    let run = 0;
    for (let k = 0; k < m; k++, v++) {
      const x = l.vertices[k * l.stride], y = l.vertices[k * l.stride + 1];
      if (k > 0) {
        const dx = x - l.vertices[(k - 1) * l.stride], dy = y - l.vertices[(k - 1) * l.stride + 1];
        run += Math.sqrt(dx * dx + dy * dy);
      }
      vertices[v * 4] = x;
      vertices[v * 4 + 1] = y;
      // A negative width marks still water (an oxbow pond).
      vertices[v * 4 + 2] = l.vertices[k * l.stride + 2];
      vertices[v * 4 + 3] = run;
      if (k + 1 < m) firsts.push(v);
    }
  }
  const bucketOf = (i: number) => wrap(Math.floor(vertices[i * 4 + 1] / RIVER_BUCKET), bN) * bN + wrap(Math.floor(vertices[i * 4] / RIVER_BUCKET), bN);
  for (const i of firsts) count[bucketOf(i) + 1]++;
  for (let b = 0; b < bN * bN; b++) count[b + 1] += count[b];
  const segments = new Uint32Array(firsts.length);
  const fill = new Uint32Array(count.subarray(0, bN * bN));
  for (const i of firsts) segments[fill[bucketOf(i)]++] = i;
  return { vertices, bN, bucketStart: count, segments };
}

/** First-order streams shorter than this, in cells, are not drawn. */
export const MIN_STREAM = 60;

/**
 * A reach that ends at the sea is carried on along its last heading until it
 * is three cells into the water, so no stream stops short on the beach.
 */
function runToSea(v: Float32Array, ground: Float32Array, gN: number): Float32Array {
  const m = v.length / 4;
  if (m < 2) return v;
  const back = Math.max(0, m - 4);
  let dx = v[(m - 1) * 4] - v[back * 4], dy = v[(m - 1) * 4 + 1] - v[back * 4 + 1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return v;
  dx /= len;
  dy /= len;
  const extra: number[] = [];
  let x = v[(m - 1) * 4], y = v[(m - 1) * 4 + 1], wet = 0;
  const w = v[(m - 1) * 4 + 2], level = v[(m - 1) * 4 + 3];
  for (let k = 0; k < 40 && wet < 3; k++) {
    x += dx;
    y += dy;
    extra.push(x, y, w, level);
    const gx = wrap(Math.floor(x / 4), gN), gy = wrap(Math.floor(y / 4), gN);
    if (ground[gy * gN + gx] <= 0) wet++;
  }
  // Only keep the run if it found the sea.
  if (wet < 3) return v;
  const out = new Float32Array(v.length + extra.length);
  out.set(v);
  out.set(extra, v.length);
  return out;
}

function reachLength(v: Float32Array): number {
  let len = 0;
  for (let k = 4; k < v.length; k += 4) {
    const dx = v[k] - v[k - 4], dy = v[k + 1] - v[k - 3];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

export interface BakeWorldInput {
  params: WorldParams;
  seed: number;
  /** The generator's stages (gen/pipeline.ts makeWorld()). Run here when absent. */
  world?: World;
}

/** Talus debris on G as a 0–1 field on C: thick from about 3 units. */
export function debrisOnC(debris: ArrayLike<number>, gN: number): Float32Array {
  const cN = gN / 2, out = new Float32Array(cN * cN);
  for (let y = 0; y < cN; y++) for (let x = 0; x < cN; x++) {
    const i = 2 * y * gN + 2 * x;
    const v = (debris[i] + debris[i + 1] + debris[i + gN] + debris[i + gN + 1]) / 12;
    out[y * cN + x] = v > 1 ? 1 : v;
  }
  return out;
}

export function buildBakeWorld(inp: BakeWorldInput): BakeWorld {
  const { params: p, seed } = inp;
  const { n, gN, cN } = p;
  if (n % 256 !== 0) throw new Error(`the bake needs a world of whole 256-cell tiles, not ${n}`);
  const w = inp.world ?? makeWorld(p, seed);
  const { land, hydro, rivers, climate, settlement } = w;
  const isSea = land.isSea;

  // The rivers stage's ground is final. The coast stage shelves the sea bed; a flat one gets the stand-in.
  let deepest = 0;
  const final = settlement ? settlement.ground : rivers.ground;
  for (let i = 0; i < isSea.length; i++) if (isSea[i] && final[i] < deepest) deepest = final[i];
  const ground = deepest < -2 ? Float32Array.from(final) : standinSeaBed(final, isSea, gN);
  for (let i = 0; i < ground.length; i++) if (!isSea[i] && ground[i] <= 0) ground[i] = 0.01;
  const waterLevel = new Float32Array(gN * gN), waterKind = new Uint8Array(gN * gN), hand = new Float32Array(gN * gN);
  for (let i = 0; i < waterKind.length; i++) {
    hand[i] = hydro.hand[i];
    if (isSea[i]) waterKind[i] = 1;
    else if (hydro.lakeId[i] >= 0) { waterKind[i] = 2; waterLevel[i] = hydro.surface[i]; }
  }
  // Coastal exposure on C from the coast stage's G field.
  const exposure = new Float32Array(cN * cN);
  for (let y = 0; y < cN; y++) for (let x = 0; x < cN; x++) {
    const i = 2 * y * gN + 2 * x;
    exposure[y * cN + x] = (land.exposure[i] + land.exposure[i + 1] + land.exposure[i + gN] + land.exposure[i + gN + 1]) / 4;
  }
  const shore = land.shoreClass;

  // First-order streams shorter than MIN_STREAM cells are left out: on a planar slope they draw as a comb.
  const lines: RiverLine[] = [];
  for (const r of rivers.reaches) {
    if (r.order <= 1 && reachLength(r.vertices) < MIN_STREAM) continue;
    lines.push({ vertices: r.endsIn === "sea" ? runToSea(r.vertices, ground, gN) : r.vertices, stride: 4 });
  }
  const ponds = rivers.oxbows.filter((o) => o.outline.length >= 6).map((o) => patchOf(o.outline, o.level));
  const bars = rivers.bars.filter((b) => b.outline.length >= 6).map((b) => patchOf(b.outline, 0));

  return {
    n, gN, cN, ground, waterLevel, waterKind, hand, shore,
    // First-order streams shorter than MIN_STREAM cells are left out: on a planar slope they draw as a comb.
    base: Float32Array.from(land.base),
    conform: Float32Array.from(rivers.ground, (v, i) => v - land.g[i]),
    stamps: land.stamps,
    rivers: riverIndex(lines, n),
    falls: Float32Array.from(rivers.falls.flatMap((f) => [f.x, f.y, f.drop])),
    ponds, bars,
    moisture: climate.moisture, wind: climate.wind, exposure, debris: debrisOnC(land.debris, gN),
    rock: land.plan.rock, regions: land.plan.regions,
    built: settlement ? indexBuilt(settlement.built, n) : undefined,
    roads: settlement ? riverIndex(settlement.built.roads.map((r) => ({ vertices: roadVertices(r.vertices, r.width), stride: 3 })), n) : undefined,
  };
}

/** x, y, width triples from a road's x, y pairs. */
function roadVertices(xy: readonly number[], width: number): number[] {
  const out: number[] = [];
  for (let k = 0; k + 1 < xy.length; k += 2) out.push(xy[k], xy[k + 1], width);
  return out;
}

/** A blank world of the given size: flat ground at `level`, no water, no rivers, one region. For tests and fixtures. */
export function blankWorld(n: number, level: number): BakeWorld {
  const gN = n / 4, cN = n / 8;
  const regions = new Float32Array(6 * cN * cN);
  regions.fill(1, 0, cN * cN);
  return {
    n, gN, cN,
    ground: new Float32Array(gN * gN).fill(level),
    waterLevel: new Float32Array(gN * gN),
    waterKind: new Uint8Array(gN * gN),
    hand: new Float32Array(gN * gN),
    shore: new Uint8Array(gN * gN),
    rivers: riverIndex([], n),
    falls: new Float32Array(0),
    moisture: new Float32Array(cN * cN).fill(0.5),
    wind: new Float32Array(cN * cN),
    exposure: new Float32Array(cN * cN),
    debris: new Float32Array(cN * cN),
    rock: new Uint8Array(cN * cN).fill(1),
    regions,
  };
}
