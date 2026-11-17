// S10 roads: least-cost paths on G with 16 step directions, a grade limit that
// makes switchbacks, cheaper south-facing flanks (so switchbacks face the
// camera), bridges and fords, joined into a network per island.

export interface RoadInput {
  /** G grid size (nodes a side). */
  n: number;
  /** Cells per node (4 on G); grades are in height units per cell. */
  cellsPerNode: number;
  h: Float64Array;
  isSea: Uint8Array;
  /** 1 on lake nodes. */
  lake: Uint8Array;
  /** River width class per node: 0 none, 1–6. */
  riverWidth: Uint8Array;
}

export interface RoadParams {
  /** Steepest allowed grade, height per cell (0.12). */
  gradeMax: number;
  /** cost = length · (1 + slopeCost · grade²) … (40). */
  slopeCost: number;
  /** Fractional discount on south-facing flanks (0.15). */
  southBonus: number;
  /** Extra cost of a bridge crossing (50). */
  bridgeCost: number;
  /** Widest river a road may bridge (4); wider ones block. */
  maxBridgeWidth: number;
  /** Cost per radian of turn between consecutive steps. */
  turnCost: number;
  /** Extra edges beyond the minimum spanning tree, as a share of its edge count (0.2). */
  extraEdges: number;
}

export interface Road {
  /** Indices into the `points` list given to roadNetwork. */
  a: number;
  b: number;
  /** Node indices along the road, endpoints included. */
  path: Uint32Array;
  /** Nodes where the road crosses a river of width ≥ 2. */
  bridges: number[];
  /** Nodes where it crosses a width-1 stream. */
  fords: number[];
}

/** Connected land components (8-connected, wrapped); −1 on sea and lake. */
export function islandIds(isSea: Uint8Array, lake: Uint8Array, n: number): Int32Array {
  throw new Error("not implemented");
}

/** Least-cost path from node `from` to node `to`, or null if none. */
export function leastCostPath(inp: RoadInput, p: RoadParams, from: number, to: number): Uint32Array | null {
  throw new Error("not implemented");
}

/** A road network joining `points` (node indices) island by island: minimum spanning tree plus extra edges. */
export function roadNetwork(inp: RoadInput, p: RoadParams, points: readonly number[]): Road[] {
  throw new Error("not implemented");
}
