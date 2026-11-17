// Periodic gradient noise with rotated octaves. Every octave tiles exactly:
// octave k samples at M^k·p with the integer matrix M = [[2, 1], [−1, 2]].

/** 16 unit gradients; gradient k is (cos k·22.5°, sin k·22.5°), as literals. */
export const GRADIENTS: Float64Array = new Float64Array(32);

/** Gradient noise on a lattice of `period` units that wraps; range [−1, 1]. */
export function gradNoise(x: number, y: number, period: number, seed: number): number {
  throw new Error("not implemented");
}

/** M^k in row-major order [a, b, c, d] for M = [[2, 1], [−1, 2]]. */
export function octaveMatrixPower(k: number): [number, number, number, number] {
  throw new Error("not implemented");
}

/** Normalised sum of octaves; range [−1, 1]. */
export function fbm(x: number, y: number, period: number, octaves: number, gain: number, seed: number): number {
  throw new Error("not implemented");
}

/** Normalised sum of 1 − |octave|; range [0, 1]. */
export function ridgedFbm(x: number, y: number, period: number, octaves: number, gain: number, seed: number): number {
  throw new Error("not implemented");
}
