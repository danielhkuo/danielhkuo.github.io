// Synthetic land for the bake bench. Not the generator: it only has to give
// the bake the same shapes and sizes of input the real packs will carry.

export interface BenchField {
  /** World size in cells; a multiple of 256. */
  nCells: number;
  /** nCells / 4: the solver grid G. */
  gN: number;
  /** nCells / 8: the coarse grid C. */
  cN: number;
  /** gN² heights in units; sea is negative, down to −24. */
  heights: Float32Array;
  /** gN² height above nearest drainage, 0–255. */
  hand: Uint8Array;
  /** Six planes of cN², 0–255: moisture, wind exposure, coast exposure, debris, rock class (0, 1, 2), region (0–5). */
  fields: Uint8Array;
}

export function makeBenchField(nCells: number, seed: number): BenchField {
  throw new Error("not implemented");
}

/** A 256² dither mask, one byte per cell. The real blue-noise mask replaces it later; the cost is one lookup either way. */
export function makeBenchMask(seed: number): Uint8Array {
  throw new Error("not implemented");
}
