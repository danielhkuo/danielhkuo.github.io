// Rivers as lines. The generator's river raster on G is turned into smooth
// curves (corner-cut through the midpoints between nodes), which the cell
// tiles use for cover and clearance and the chunk painter draws in bake-pixel
// space, onto visible ground only.
//
// Continuous cell coordinates: cell i spans [i, i + 1); G node g sits at 4g + 2.

import { hash2 } from "../core/hash.ts";
import { NB8_DX, NB8_DY, wrap } from "../core/torus.ts";
import type { BakeWorld } from "./world.ts";

/** Samples per curve piece; a piece is at most ~6 cells long. */
const PIECE_STEPS = 14;
/** River nodes wander this far (cells) off the lattice so reaches do not run on the grid's 8 directions. */
const WANDER = 1.1;
/** A curve piece stays within this many cells of its node. */
export const RIVER_PIECE_REACH = 8;

export type RiverPointFn = (x: number, y: number, width: number, run: number, first: boolean) => void;

function nodeX(gx: number, gy: number, gN: number): number {
  const h = hash2(wrap(gx, gN), wrap(gy, gN), 0x7e1a);
  return 4 * gx + 2 + WANDER * ((h & 0xffff) / 32768 - 1);
}

function nodeY(gx: number, gy: number, gN: number): number {
  const h = hash2(wrap(gx, gN), wrap(gy, gN), 0x7e1a);
  return 4 * gy + 2 + WANDER * ((h >>> 16) / 32768 - 1);
}

/**
 * Walks every river curve piece owned by a G node whose lattice position lies
 * within RIVER_PIECE_REACH of the cell rectangle [x0, x1) × [y0, y1), and
 * calls `emit` along it in steps of under half a cell. `first` marks the
 * start of a piece. Coordinates are unwrapped continuous cells. A piece is
 * always emitted whole, so what is drawn never depends on the rectangle.
 */
export function forEachRiverPoint(world: BakeWorld, x0: number, y0: number, x1: number, y1: number, emit: RiverPointFn): void {
  const gN = world.gN;
  const { riverWidth, riverTo, riverRun } = world;
  const gx0 = Math.floor((x0 - RIVER_PIECE_REACH - 2) / 4), gx1 = Math.floor((x1 + RIVER_PIECE_REACH - 2) / 4);
  const gy0 = Math.floor((y0 - RIVER_PIECE_REACH - 2) / 4), gy1 = Math.floor((y1 + RIVER_PIECE_REACH - 2) / 4);
  for (let gy = gy0; gy <= gy1; gy++) {
    const row = wrap(gy, gN) * gN;
    for (let gx = gx0; gx <= gx1; gx++) {
      const i = row + wrap(gx, gN);
      const w = riverWidth[i];
      if (w === 0) continue;
      const to = riverTo[i];
      if (to > 7) continue;
      const px = nodeX(gx, gy, gN), py = nodeY(gx, gy, gN);
      const rgx = gx + NB8_DX[to], rgy = gy + NB8_DY[to];
      const r = wrap(rgy, gN) * gN + wrap(rgx, gN);
      const rx = nodeX(rgx, rgy, gN), ry = nodeY(rgx, rgy, gN);
      const run = riverRun[i];
      const ends = riverWidth[r] === 0;
      // Downstream end of this node's pieces: the midpoint to the receiver, or the receiver itself at a mouth.
      const ex = ends ? rx : (px + rx) / 2, ey = ends ? ry : (py + ry) / 2;
      const eRun = ends ? riverRun[r] : (run + riverRun[r]) / 2;

      let donors = 0;
      for (let d = 0; d < 8; d++) {
        const dgx = gx + NB8_DX[d], dgy = gy + NB8_DY[d];
        const j = wrap(dgy, gN) * gN + wrap(dgx, gN);
        // A donor points back at this node: its direction is the opposite of d.
        if (riverWidth[j] === 0 || riverTo[j] !== ((d + 4) & 7)) continue;
        donors++;
        const sx = (nodeX(dgx, dgy, gN) + px) / 2, sy = (nodeY(dgx, dgy, gN) + py) / 2;
        const sRun = (riverRun[j] + run) / 2;
        for (let s = 0; s <= PIECE_STEPS; s++) {
          const t = s / PIECE_STEPS, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
          emit(a * sx + b * px + c * ex, a * sy + b * py + c * ey, w, a * sRun + b * run + c * eRun, s === 0);
        }
      }
      if (donors === 0) {
        // A head: a straight run from the node.
        for (let s = 0; s <= PIECE_STEPS; s++) {
          const t = s / PIECE_STEPS;
          emit(px + t * (ex - px), py + t * (ey - py), w, run + t * (eRun - run), s === 0);
        }
      }
    }
  }
}
