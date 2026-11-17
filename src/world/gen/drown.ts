// S3 Drowning: the sea rises after erosion and heights are re-zeroed, so
// valley mouths become inlets and spurs become headlands.

export interface DrownResult {
  h: Float64Array;
  isSea: Uint8Array;
}

/** h' = h − rise; sea is wherever h' ≤ 0. */
export function drown(h: Float64Array, n: number, rise: number): DrownResult {
  const count = n * n;
  const out = new Float64Array(count);
  const isSea = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const v = h[i] - rise;
    out[i] = v;
    if (v <= 0) isSea[i] = 1;
  }
  return { h: out, isSea };
}
