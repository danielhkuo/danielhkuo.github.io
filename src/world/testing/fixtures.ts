// Hand-built height fields for generator tests. All are n × n tori.
import { fbm } from "../core/noise.ts";
import { rngFor } from "../core/rng.ts";

export interface Field {
  n: number;
  h: Float64Array;
  isSea: Uint8Array;
}

/** Column x = 0 is sea at height 0; every other node is `fill`. */
export function columnSea(n: number, fill: number): Field {
  const h = new Float64Array(n * n).fill(fill), isSea = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) { h[y * n] = 0; isSea[y * n] = 1; }
  return { n, h, isSea };
}

/** Sea where a smooth noise is low; land heights 0–10 with many interior pits. */
export function bumpy(n: number, seed: number): Field {
  const h = new Float64Array(n * n), isSea = new Uint8Array(n * n), r = rngFor(seed, "bumpy");
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, base = fbm((x * 4) / n, (y * 4) / n, 4, 3, 0.5, seed);
    if (base < -0.15) { isSea[i] = 1; h[i] = -1; } else h[i] = 1 + 9 * r.float();
  }
  return { n, h, isSea };
}
