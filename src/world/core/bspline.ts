// Periodic uniform cubic B-spline. It never overshoots its control points.
// Fine cell i of an upsample by f sits at node coordinate u = (i + 0.5)/f − 0.5.

/** Value at node coordinates (u, v) of a periodic n × n node grid. */
export function bsplineAt(src: Float64Array, n: number, u: number, v: number): number {
  throw new Error("not implemented");
}

/** The whole (n·f)² upsampled grid. */
export function upsampleBSpline(src: Float64Array, n: number, f: number): Float64Array {
  throw new Error("not implemented");
}

/** Fine cells [x0, x0 + w) × [y0, y0 + h), wrapped; bit-identical to the same crop of upsampleBSpline. */
export function upsampleTile(src: Float64Array, n: number, f: number, x0: number, y0: number, w: number, h: number): Float64Array {
  throw new Error("not implemented");
}
