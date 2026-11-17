// Automatic look gates for the render harness (design 5.7). They run on bake
// pixels (contract layout) or on plain grayscale images, before any critic.

/** Share of non-water pixels whose ink bits are non-zero. */
export function inkShare(pixels: Uint32Array, isWater: Uint8Array): number {
  throw new Error("not implemented");
}

/** Share of pixels at tone 0 or tone 15. */
export function toneExtremes(pixels: Uint32Array): number {
  throw new Error("not implemented");
}

/** Tone (0–15) per pixel, as Float32Array, for the spectral gates. */
export function toneImage(pixels: Uint32Array): Float32Array {
  throw new Error("not implemented");
}

/**
 * Grid gate: mean power at axis-aligned frequencies (kx = 0 or ky = 0, DC excluded,
 * |k| ≤ size/4) divided by the median power of all other frequencies in the same radius.
 * A grid-free image scores about 1; the pass mark is ≤ 1.5. `size` must be a power of two.
 */
export function gridScore(img: Float32Array, size: number): number {
  throw new Error("not implemented");
}

/**
 * Repetition gate: autocorrelation at each lag in `lags` (shift along x, toroidal on the image)
 * divided by the mean autocorrelation at lag ± 3. Returns the worst ratio. Pass ≤ 1.25.
 */
export function repeatScore(img: Float32Array, w: number, h: number, lags: readonly number[]): number {
  throw new Error("not implemented");
}

/** Number of 8-connected components of non-zero pixels. */
export function components8(mask: Uint8Array, w: number, h: number): number {
  throw new Error("not implemented");
}

/** Pearson chi-square distance Σ (a − b)² / (a + b) between two normalised histograms. */
export function chiSquare(a: ArrayLike<number>, b: ArrayLike<number>): number {
  throw new Error("not implemented");
}

/** True when two buffers hold the same bytes. */
export function bytesEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  throw new Error("not implemented");
}
