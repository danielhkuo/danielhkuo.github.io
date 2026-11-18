// The world in pieces: a core (meta, every vector, the falls, the occlusion floor and a haze overview) and one file
// per square region holding that region's G and C grids. A bake worker or the page fetches the core, then only the
// regions near the flier; a window of the grids cut from regions equals the same window cut from the whole decoded
// world (pack/world.ts), value for value.

import type { BakeWorld, GridWindow } from "../bake/world.ts";
import type { Occlusion, WorldSection } from "./world.ts";

/** Cells a side of one region in the shipped world. */
export const REGION_CELLS = 1280;

export interface TiledWorld {
  core: { bin: Uint8Array; sections: WorldSection[] };
  /** Every region, row-major (ry, then rx). */
  regions: { rx: number; ry: number; bin: Uint8Array; sections: WorldSection[] }[];
}

/** One region's grids, in the units decodeWorld gives: G arrays (regionCells / 4)², C arrays (regionCells / 8)². */
export interface RegionGrids {
  rx: number;
  ry: number;
  ground: Float32Array;
  base?: Float32Array;
  conform?: Float32Array;
  waterLevel: Float32Array;
  waterKind: Uint8Array;
  hand: Float32Array;
  shore: Uint8Array;
  moisture: Float32Array;
  wind: Float32Array;
  exposure: Float32Array;
  debris: Float32Array;
  rock: Uint8Array;
  /** Six planes, plane-major, each (regionCells / 8)². */
  regions: Float32Array;
}

export interface Core {
  /** The world with every grid empty (bake/window.ts strippedWorld) and every vector decoded. */
  world: BakeWorld;
  regionCells: number;
  /** Regions a side: n / regionCells. */
  side: number;
  /** The occlusion floor, as decodeFlightData gives it (block 0 and empty when absent). */
  occlusion: Uint8Array;
  block: number;
  /** Ground height at one sample per 8 cells, (n / 8)², for the haze: whole units, the sea as 0. */
  overview: Uint8Array;
}

/**
 * Encodes `w` as a core and (n / regionCells)² regions. regionCells must divide n and be a multiple of 8. Grids are
 * quantised exactly as encodeWorld quantises them, so decoding gives the same values decodeWorld would.
 */
export async function encodeTiled(w: BakeWorld, opts: { regionCells: number; occlusion?: Occlusion }): Promise<TiledWorld> {
  void w, opts;
  throw new Error("not implemented");
}

/** Decodes a core. Throws a decode error (as decodeWorld does) on a damaged file. */
export async function decodeCore(bin: Uint8Array): Promise<Core> {
  void bin;
  throw new Error("not implemented");
}

/** Decodes one region file for `core`. Throws a decode error on a damaged file or one from another world. */
export async function decodeRegion(bin: Uint8Array, core: Core): Promise<RegionGrids> {
  void bin, core;
  throw new Error("not implemented");
}

/** The regions (wrapped, each once, row-major order) that the windows g (G nodes) and c (C nodes) touch. */
export function regionsFor(core: Pick<Core, "regionCells" | "side"> & { world: Pick<BakeWorld, "gN" | "cN"> }, g: GridWindow, c: GridWindow): { rx: number; ry: number }[] {
  void core, g, c;
  throw new Error("not implemented");
}

/**
 * The world cutWindow(whole, g, c) would give, cut from regions instead: `region(rx, ry)` returns a decoded region
 * (regionsFor lists the ones needed). Vectors and scalars are shared with core.world.
 */
export function cutFromRegions(core: Core, region: (rx: number, ry: number) => RegionGrids, g: GridWindow, c: GridWindow): BakeWorld {
  void core, region, g, c;
  throw new Error("not implemented");
}
