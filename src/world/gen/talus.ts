// S5 Talus: thermal erosion. Material slides downhill until no slope exceeds
// its rock's angle of repose; what lands accumulates in a debris layer.

export interface TalusResult {
  h: Float64Array;
  /** Material deposited on each node, ≥ 0; scree is later drawn where it is thick. */
  debris: Float64Array;
}

/**
 * @param cellsPerNode node spacing in cells (4 on G); repose is height per cell.
 * @param repose angle of repose per rock class [hard, medium, soft], e.g. [1.8, 1.0, 0.6].
 */
export function talus(h: Float64Array, n: number, rock: Uint8Array, repose: readonly [number, number, number], cellsPerNode: number, sweeps: number): TalusResult {
  throw new Error("not implemented");
}
