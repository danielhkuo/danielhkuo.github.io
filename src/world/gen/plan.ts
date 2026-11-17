// S1 Plan: island cores, fold-belt spines, uplift U, erodibility K, rock and
// soft region weights, all on the coarse grid C.

import type { Archetype, WorldParams } from "./params.ts";

export interface Core {
  /** Centre in cells. */
  x: number;
  y: number;
  archetype: Archetype;
  /** Half the island length, in cells. */
  radius: number;
  /** Main spine polyline x0, y0, x1, y1, … in cells, unwrapped from the centre. */
  spine: Float64Array;
}

export interface Plan {
  /** Grid size: the C grid, cN nodes a side. */
  n: number;
  cores: Core[];
  /** Uplift rate per node. */
  uplift: Float64Array;
  /** Erodibility per node: kBase · kMul[rock]. */
  k: Float64Array;
  /** Hillslope diffusion per node, blended from the archetype values by region weight. */
  d: Float64Array;
  /** Rock class per node: 0 hard, 1 medium, 2 soft. */
  rock: Uint8Array;
  /** Six planes of n², archetype-major: soft membership of each node; sums to 1. */
  regions: Float32Array;
}

export function planWorld(p: WorldParams, seed: number): Plan {
  throw new Error("not implemented");
}
