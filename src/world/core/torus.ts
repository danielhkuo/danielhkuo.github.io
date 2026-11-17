// Torus helpers. Nothing in the world has an edge.

/** i wrapped into [0, n). */
export function wrap(i: number, n: number): number {
  throw new Error("not implemented");
}

/** Flat index of (x, y) wrapped onto an n × n torus: y·n + x. */
export function wrapIndex(x: number, y: number, n: number): number {
  throw new Error("not implemented");
}

/** Minimum-image b − a on a ring of n, in [−n/2, n/2). */
export function torusDelta(a: number, b: number, n: number): number {
  throw new Error("not implemented");
}

export function torusDist2(ax: number, ay: number, bx: number, by: number, n: number): number {
  throw new Error("not implemented");
}

export function torusDist(ax: number, ay: number, bx: number, by: number, n: number): number {
  throw new Error("not implemented");
}

/** 8-neighbour offsets in the order E, SE, S, SW, W, NW, N, NE. */
export const NB8_DX: Int8Array = new Int8Array(8);
export const NB8_DY: Int8Array = new Int8Array(8);
/** Step length to each neighbour: 1 or Math.SQRT2. */
export const NB8_DIST: Float64Array = new Float64Array(8);
