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
import { type Stamp, stampReach } from "../gen/stamps.ts";

export const WATER = { land: 0, sea: 1, lake: 2, river: 3 } as const;
export const SHORE = { none: 0, beach: 1, rocky: 2, cliff: 3, cove: 4 } as const;
/** No surface, canopy included, stands above this. */
export const HMAX = 160;

/** Side of a stamp bucket, in cells. */
export const STAMP_BUCKET = 64;

/** Coast stamps filed under every bucket their reach touches. */
export interface StampIndex {
  stamps: readonly Stamp[];
  /** Buckets a side: n / STAMP_BUCKET. */
  bN: number;
  bucketStart: Uint32Array;
  /** Indices into `stamps`, ascending within a bucket. */
  entries: Uint32Array;
}

export function stampIndex(stamps: readonly Stamp[], n: number): StampIndex {
  const bN = n / STAMP_BUCKET;
  const count = new Uint32Array(bN * bN + 1);
  const visit = (each: (b: number, k: number) => void): void => {
    for (let k = 0; k < stamps.length; k++) {
      const s = stamps[k], r = stampReach(s);
      if (r <= 0) continue;
      const x0 = Math.floor((s.x - r) / STAMP_BUCKET), x1 = Math.floor((s.x + r) / STAMP_BUCKET);
      const y0 = Math.floor((s.y - r) / STAMP_BUCKET), y1 = Math.floor((s.y + r) / STAMP_BUCKET);
      for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) each(wrap(by, bN) * bN + wrap(bx, bN), k);
    }
  };
  visit((b) => count[b + 1]++);
  for (let b = 0; b < bN * bN; b++) count[b + 1] += count[b];
  const entries = new Uint32Array(count[bN * bN]);
  const fill = new Uint32Array(count.subarray(0, bN * bN));
  visit((b, k) => { entries[fill[b]++] = k; });
  return { stamps, bN, bucketStart: count, entries };
}

/** The stamps that can touch cells [x0, x0 + w) × [y0, y0 + h), in list order, each once. */
export function stampsNear(ix: StampIndex, x0: number, y0: number, w: number, h: number): Stamp[] {
  const seen = new Set<number>();
  const bx0 = Math.floor(x0 / STAMP_BUCKET), bx1 = Math.floor((x0 + w - 1) / STAMP_BUCKET);
  const by0 = Math.floor(y0 / STAMP_BUCKET), by1 = Math.floor((y0 + h - 1) / STAMP_BUCKET);
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
    const b = wrap(by, ix.bN) * ix.bN + wrap(bx, ix.bN);
    for (let e = ix.bucketStart[b]; e < ix.bucketStart[b + 1]; e++) seen.add(ix.entries[e]);
  }
  // Ascending by index (insertion sort: a window sees a few hundred at most).
  const ids = Uint32Array.from(seen);
  for (let a = 1; a < ids.length; a++) {
    const v = ids[a];
    let b = a - 1;
    for (; b >= 0 && ids[b] > v; b--) ids[b + 1] = ids[b];
    ids[b + 1] = v;
  }
  const out: Stamp[] = [];
  for (const k of ids) out.push(ix.stamps[k]);
  return out;
}

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
  /** Coast stamps, cut into the upsampled ground at cell size. */
  stamps: StampIndex;

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

export interface BakeWorldInput {
  params: WorldParams;
  seed: number;
  /** The generator's stages (gen/pipeline.ts makeWorld()). Run here when absent. */
  world?: World;
  /** Shore classes on G; the coast stage's when absent. */
  shore?: Uint8Array;
  /** Coastal exposure on C, 0–1; the coast stage's when absent. */
  exposure?: Float32Array;
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

  // Land is the rivers stage's ground; the sea bed is the coast stage's. Where a
  // coast stamp cut land away on G, the uncut land goes back in: the bake
  // upsamples it and cuts the same stamps at cell size, so a cliff keeps a crisp face.
  const ground = new Float32Array(gN * gN);
  const waterLevel = new Float32Array(gN * gN), waterKind = new Uint8Array(gN * gN), hand = new Float32Array(gN * gN);
  for (let i = 0; i < waterKind.length; i++) {
    hand[i] = hydro.hand[i];
    if (isSea[i]) {
      waterKind[i] = 1;
      ground[i] = land.base[i] > 0 ? land.base[i] : Math.min(land.g[i], -0.01);
    } else {
      ground[i] = Math.max(rivers.ground[i], 0.01);
      if (hydro.lakeId[i] >= 0) { waterKind[i] = 2; waterLevel[i] = hydro.surface[i]; }
    }
  }
  let exposure = inp.exposure;
  if (!exposure) {
    exposure = new Float32Array(cN * cN);
    for (let y = 0; y < cN; y++) for (let x = 0; x < cN; x++) {
      const i = 2 * y * gN + 2 * x;
      exposure[y * cN + x] = (land.exposure[i] + land.exposure[i + 1] + land.exposure[i + gN] + land.exposure[i + gN + 1]) / 4;
    }
  }
  const shore = inp.shore ?? land.shoreClass;

  return {
    n, gN, cN, ground, waterLevel, waterKind, hand, shore,
    rivers: riverIndex(rivers.reaches.map((r) => ({ vertices: r.vertices, stride: 4 })), n),
    stamps: stampIndex(land.stamps, n),
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
    stamps: stampIndex([], n),
    moisture: new Float32Array(cN * cN).fill(0.5),
    wind: new Float32Array(cN * cN),
    exposure: new Float32Array(cN * cN),
    debris: new Float32Array(cN * cN),
    rock: new Uint8Array(cN * cN).fill(1),
    regions,
  };
}
