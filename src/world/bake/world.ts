// BakeWorld: everything the bake reads, on the torus. Heights and water live
// on the solver grid G (4 cells per node); climate, rock and region weights on
// the coarse grid C (8 cells per node); rivers are vectors.
//
// buildBakeWorld adapts the generator's stages (gen/pipeline.ts makeWorld).
// Stages that are not built yet are filled by the stand-ins in
// standin-land.ts, each marked STAND-IN there.

import { wrap } from "../core/torus.ts";
import type { WorldParams } from "../gen/params.ts";
import { makeWorld, type World } from "../gen/pipeline.ts";
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

  rivers: RiverIndex;
  /** Waterfalls: x, y (cells), drop (units) each. */
  falls: Float32Array;

  // --- C grid, cN² each ---
  moisture: Float32Array;
  wind: Float32Array;
  exposure: Float32Array;
  debris: Float32Array;
  /** 0 hard, 1 medium, 2 soft. */
  rock: Uint8Array;
  /** Six planes of cN², archetype-major, summing to 1 per node. */
  regions: Float32Array;
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
  const { land, hydro, rivers, climate } = w;
  const isSea = land.isSea;

  // The rivers stage's ground is final. The coast stage shelves the sea bed; a flat one gets the stand-in.
  let deepest = 0;
  for (let i = 0; i < isSea.length; i++) if (isSea[i] && rivers.ground[i] < deepest) deepest = rivers.ground[i];
  const ground = deepest < -2 ? Float32Array.from(rivers.ground) : standinSeaBed(rivers.ground, isSea, gN);
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

  return {
    n, gN, cN, ground, waterLevel, waterKind, hand, shore,
    // First-order streams shorter than MIN_STREAM cells are left out: on a planar slope they draw as a comb.
    rivers: riverIndex(rivers.reaches.filter((r) => r.order > 1 || reachLength(r.vertices) >= MIN_STREAM).map((r) => ({ vertices: r.vertices, stride: 4 })), n),
    falls: Float32Array.from(rivers.falls.flatMap((f) => [f.x, f.y, f.drop])),
    moisture: climate.moisture, wind: climate.wind, exposure, debris: debrisOnC(land.debris, gN),
    rock: land.plan.rock, regions: land.plan.regions,
  };
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
