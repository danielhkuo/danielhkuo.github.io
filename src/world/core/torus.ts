// Torus helpers. Nothing in the world has an edge.

/** i wrapped into [0, n). */
export function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** Flat index of (x, y) wrapped onto an n × n torus: y·n + x. */
export function wrapIndex(x: number, y: number, n: number): number {
  return wrap(y, n) * n + wrap(x, n);
}

/** Minimum-image b − a on a ring of n, in [−n/2, n/2). */
export function torusDelta(a: number, b: number, n: number): number {
  let d = ((b - a) % n + n) % n;
  if (d >= n / 2) {
    d -= n;
  }
  return d;
}

export function torusDist2(ax: number, ay: number, bx: number, by: number, n: number): number {
  const dx = torusDelta(ax, bx, n);
  const dy = torusDelta(ay, by, n);
  return dx * dx + dy * dy;
}

export function torusDist(ax: number, ay: number, bx: number, by: number, n: number): number {
  return Math.sqrt(torusDist2(ax, ay, bx, by, n));
}

/** 8-neighbour offsets in the order E, SE, S, SW, W, NW, N, NE. */
export const NB8_DX: Int8Array = new Int8Array([1, 1, 0, -1, -1, -1, 0, 1]);
export const NB8_DY: Int8Array = new Int8Array([0, 1, 1, 1, 0, -1, -1, -1]);
/** Step length to each neighbour: 1 or Math.SQRT2. */
export const NB8_DIST: Float64Array = new Float64Array([
  1,
  Math.SQRT2,
  1,
  Math.SQRT2,
  1,
  Math.SQRT2,
  1,
  Math.SQRT2,
]);