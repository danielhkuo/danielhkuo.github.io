// The bake bench: one 256 × 256 pixel chunk, doing the real per-cell workload
// of the design's section 5.5 so its timing can gate the architecture.

import type { BenchField } from "./field.ts";

export const TILE = 256;
export const CHUNK = 256;

/** Material ids written to the low byte of each bake pixel. */
export const MAT = {
  water: 1, sand: 2, snow: 3, rock: 4, scree: 5, alpine: 6, heath: 7, forest: 8, conifer: 9,
  farmland: 10, marsh: 11, meadow: 12, scrub: 13, cliff: 14,
} as const;

export interface BenchStats {
  tilesBuilt: number;
  cellsUpsampled: number;
  coverEvals: number;
  crownsStamped: number;
  lambertEvals: number;
  shadowCells: number;
  pixelsPainted: number;
  inkTests: number;
}

export interface BenchChunk {
  /** 65536 bake pixels: material | (tone | shadow << 4 | ink << 6) << 8 | depth << 16. */
  pixels: Uint32Array;
  stats: BenchStats;
}

/** Cell tiles are cached under `ty * 4096 + tx`. */
export type TileCache = Map<number, unknown>;

export function bakeBenchChunk(field: BenchField, cx: number, cy: number, cache: TileCache | null, mask: Uint8Array): BenchChunk {
  throw new Error("not implemented");
}
