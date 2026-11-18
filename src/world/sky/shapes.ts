// Cloud shapes: a coverage mask and a dome height per pixel, generated once from
// the world seed. Painters turn them into sprites; the field places them.

export type CloudKind = "heap" | "wisp" | "bank" | "streak";

/** One shape: `cover` (0–1, how much cloud) and `dome` (0–1, the height of the cloud's top, for lighting), w·h row-major. */
export interface CloudShape {
  kind: CloudKind;
  w: number;
  h: number;
  cover: Float32Array;
  dome: Float32Array;
}

/** Box sizes in pixels, [min, max] inclusive. */
export const SHAPE_SIZES: Readonly<Record<CloudKind, { w: readonly [number, number]; h: readonly [number, number] }>> = {
  heap: { w: [40, 140], h: [18, 60] },
  wisp: { w: [60, 200], h: [8, 24] },
  bank: { w: [120, 220], h: [50, 110] },
  streak: { w: [100, 260], h: [3, 8] },
};

/** How many shapes of each kind the sky makes: about forty. */
export const SHAPE_COUNTS: Readonly<Record<CloudKind, number>> = { heap: 18, wisp: 8, bank: 6, streak: 8 };

/** The shapes, ordered by kind (heap, wisp, bank, streak) and then by index. Deterministic in the seed. */
export function makeShapes(seed: number, counts: Readonly<Record<CloudKind, number>>): CloudShape[] {
  void seed;
  void counts;
  throw new Error("not implemented");
}
