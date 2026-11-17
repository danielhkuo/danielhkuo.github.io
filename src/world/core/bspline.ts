// Periodic uniform cubic B-spline. It never overshoots its control points.
// Fine cell i of an upsample by f sits at node coordinate u = (i + 0.5)/f − 0.5.

import { wrap } from "./torus.ts";

/** Cubic basis on t ∈ [0, 1) for nodes j−1, j, j+1, j+2. */
function cubicWeights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const om = 1 - t;
  const om3 = om * om * om;
  return [om3 / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
}

/** Value at node coordinates (u, v) of a periodic n × n node grid. */
export function bsplineAt(src: Float64Array, n: number, u: number, v: number): number {
  const jx = Math.floor(u);
  const jy = Math.floor(v);
  const [wx0, wx1, wx2, wx3] = cubicWeights(u - jx);
  const [wy0, wy1, wy2, wy3] = cubicWeights(v - jy);
  const x0 = wrap(jx - 1, n);
  const x1 = wrap(jx, n);
  const x2 = wrap(jx + 1, n);
  const x3 = wrap(jx + 2, n);
  const y0 = wrap(jy - 1, n);
  const y1 = wrap(jy, n);
  const y2 = wrap(jy + 1, n);
  const y3 = wrap(jy + 2, n);
  // Separable: x pass on each of the four node rows, then the y pass.
  const r0 = wx0 * src[y0 * n + x0] + wx1 * src[y0 * n + x1] + wx2 * src[y0 * n + x2] + wx3 * src[y0 * n + x3];
  const r1 = wx0 * src[y1 * n + x0] + wx1 * src[y1 * n + x1] + wx2 * src[y1 * n + x2] + wx3 * src[y1 * n + x3];
  const r2 = wx0 * src[y2 * n + x0] + wx1 * src[y2 * n + x1] + wx2 * src[y2 * n + x2] + wx3 * src[y2 * n + x3];
  const r3 = wx0 * src[y3 * n + x0] + wx1 * src[y3 * n + x1] + wx2 * src[y3 * n + x2] + wx3 * src[y3 * n + x3];
  return wy0 * r0 + wy1 * r1 + wy2 * r2 + wy3 * r3;
}

function fineCoord(i: number, f: number): number {
  return (i + 0.5) / f - 0.5;
}

/** The whole (n·f)² upsampled grid. */
export function upsampleBSpline(src: Float64Array, n: number, f: number): Float64Array {
  const m = n * f;
  const out = new Float64Array(m * m);
  for (let j = 0; j < m; j++) {
    const v = fineCoord(j, f);
    const row = j * m;
    for (let i = 0; i < m; i++) out[row + i] = bsplineAt(src, n, fineCoord(i, f), v);
  }
  return out;
}

/** Fine cells [x0, x0 + w) × [y0, y0 + h), wrapped; bit-identical to the same crop of upsampleBSpline. */
export function upsampleTile(
  src: Float64Array,
  n: number,
  f: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): Float64Array {
  const m = n * f;
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const v = fineCoord(wrap(y0 + y, m), f);
    const row = y * w;
    for (let x = 0; x < w; x++) out[row + x] = bsplineAt(src, n, fineCoord(wrap(x0 + x, m), f), v);
  }
  return out;
}
