// Void-and-cluster blue noise (Ulichney 1993) on a torus.

export const BLUE_SEED = 1;

/** Ranks 0 … size² − 1, each exactly once; size is a power of two. */
export function voidAndCluster(size: number, seed: number): Uint16Array {
  throw new Error("not implemented");
}

/** One byte per cell: rank >> (31 − clz32(ranks.length) − 8). */
export function ranksToU8(ranks: Uint16Array): Uint8Array {
  throw new Error("not implemented");
}
