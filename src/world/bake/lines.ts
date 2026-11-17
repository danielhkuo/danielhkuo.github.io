// Rivers as lines. The generator's river vectors are walked in small steps;
// the cell tiles use the points for cover and clearance, and the chunk
// painter draws them in bake-pixel space, onto visible ground only.
//
// Continuous cell coordinates: cell i spans [i, i + 1).

import { RIVER_BUCKET, type BakeWorld, type RiverIndex } from "./world.ts";

/** No river segment is longer than this many cells. */
export const RIVER_PIECE_REACH = 8;
/** Points are emitted at most this far apart, in cells. */
const STEP = 0.45;

export type RiverPointFn = (x: number, y: number, width: number, run: number, first: boolean) => void;

/**
 * Walks every river segment filed within RIVER_PIECE_REACH of the cell
 * rectangle [x0, x1) × [y0, y1) and calls `emit` along it in steps of under
 * half a cell. `first` marks the start of a segment. Coordinates come out
 * unwrapped, in the rectangle's frame. A segment is always emitted whole, so
 * what is drawn never depends on the rectangle.
 */
export function forEachRiverPoint(world: BakeWorld, x0: number, y0: number, x1: number, y1: number, emit: RiverPointFn): void {
  forEachLinePoint(world.rivers, x0, y0, x1, y1, emit);
}

/** The same walk over any indexed set of polylines (rivers, roads). */
export function forEachLinePoint(index: RiverIndex, x0: number, y0: number, x1: number, y1: number, emit: RiverPointFn): void {
  const { vertices, bN, bucketStart, segments } = index;
  if (segments.length === 0) return;
  const bx0 = Math.floor((x0 - RIVER_PIECE_REACH) / RIVER_BUCKET), bx1 = Math.floor((x1 + RIVER_PIECE_REACH) / RIVER_BUCKET);
  const by0 = Math.floor((y0 - RIVER_PIECE_REACH) / RIVER_BUCKET), by1 = Math.floor((y1 + RIVER_PIECE_REACH) / RIVER_BUCKET);
  for (let by = by0; by <= by1; by++) {
    const wy = by - Math.floor(by / bN) * bN;
    for (let bx = bx0; bx <= bx1; bx++) {
      const wx = bx - Math.floor(bx / bN) * bN;
      const b = wy * bN + wx;
      for (let s = bucketStart[b]; s < bucketStart[b + 1]; s++) {
        const v = segments[s] * 4;
        const ax = vertices[v], ay = vertices[v + 1];
        // Whole periods that carry the segment's first vertex into this bucket.
        const ox = (bx - Math.floor(ax / RIVER_BUCKET)) * RIVER_BUCKET, oy = (by - Math.floor(ay / RIVER_BUCKET)) * RIVER_BUCKET;
        const dx = vertices[v + 4] - ax, dy = vertices[v + 5] - ay;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > RIVER_PIECE_REACH) continue;
        const steps = Math.max(1, Math.ceil(len / STEP));
        // Still water (an oxbow) carries a negative width; it is handed on as run −1.
        const still = vertices[v + 2] < 0;
        const w = Math.floor((still ? -vertices[v + 2] : vertices[v + 2]) + 0.5), run = vertices[v + 3], dRun = vertices[v + 7] - run;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          emit(ax + ox + t * dx, ay + oy + t * dy, w < 1 ? 1 : w > 6 ? 6 : w, still ? -1 : run + t * dRun, k === 0);
        }
      }
    }
  }
}
