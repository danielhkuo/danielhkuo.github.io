// The land the page flies over, for a world shipped in regions (pack/regions.ts): ground heights near the flier
// from decoded regions, the core's overview elsewhere, the occlusion floor and the haze from the core. It stands in
// for FlightData, which held the whole ground.

import type { Palette } from "../look/contract.ts";
import type { Core } from "../pack/regions.ts";

export interface RegionLand {
  n: number;
  /** Ground height at cell (x, y), 0 at or below the sea: exact (as the whole world's) where its regions are loaded, the core's overview elsewhere. */
  groundHeight(x: number, y: number): number;
  /** The occlusion floor under cell (x, y), from the core. */
  occlusionFloor(x: number, y: number): number;
  /** The haze for unbaked chunks, from the core's overview: packed RGBA at bake pixel (bx, by), anywhere on the torus. */
  haze(palette: Palette): (bx: number, by: number) => number;
  /**
   * Fetches and decodes the regions within `reach` cells of (x, y) on the torus that are not loaded or in flight,
   * nearest first; resolves when all of them are loaded. A failed fetch rejects; the region can be wanted again.
   */
  want(x: number, y: number, reach: number): Promise<void>;
  /** Regions decoded and held. */
  loaded(): number;
}

export interface RegionLandOptions {
  /** Decoded regions kept, most recently wanted first; default 16. */
  capacity?: number;
}

export function createRegionLand(core: Core, fetchRegion: (rx: number, ry: number) => Promise<Uint8Array>, opts: RegionLandOptions = {}): RegionLand {
  void core, fetchRegion, opts;
  throw new Error("not implemented");
}
