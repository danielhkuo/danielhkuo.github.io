// Baking from a window of the world's grids instead of the whole world. A bake worker for a large world cannot hold
// every grid; it holds the vectors (rivers, roads, stamps, buildings) whole, and for each 256-cell tile it cuts the
// G and C nodes that tile reads. A tile baked from its window is byte-identical to the same tile baked from the
// whole world: the world keeps its size n, gN and cN and its global coordinates, and only the grid storage shrinks.

import type { Look } from "./cells.ts";
import type { TileSource } from "./chunk.ts";
import type { BakeWorld, GridWindow } from "./world.ts";

export type { GridWindow };

/** A function that returns a world whose grids hold just these G and C windows (see cutWindow). */
export type WindowCutter = (g: GridWindow, c: GridWindow) => BakeWorld;

/**
 * The G and C node windows that buildTile reads for tile (tx, ty), in global node coordinates (they may start below
 * zero or run past the grid's size; reads wrap). A window may be larger than the bake strictly needs; it is fixed per
 * tile, so the same tile always gets the same window.
 */
export function tileWindows(world: Pick<BakeWorld, "n" | "gN" | "cN">, tx: number, ty: number): { g: GridWindow; c: GridWindow } {
  void world, tx, ty;
  throw new Error("not implemented");
}

/**
 * A copy of `world` whose G-grid arrays hold only window `g` and whose C-grid arrays hold only window `c` (row-major,
 * w × h each), with gWin and cWin set. Vectors, indexes and scalars are shared, not copied. Nodes are read from the
 * whole world with wrapping, so a window may straddle the torus seam.
 */
export function cutWindow(world: BakeWorld, g: GridWindow, c: GridWindow): BakeWorld {
  void world, g, c;
  throw new Error("not implemented");
}

/** A copy of `world` with every G- and C-grid array emptied: what a worker holds besides its windows. */
export function strippedWorld(world: BakeWorld): BakeWorld {
  void world;
  throw new Error("not implemented");
}

/**
 * A tile source like tileCache, with a most-recently-used cache of `capacity` tiles, that builds each tile from the
 * world `cut` returns for that tile's windows (tileWindows). Tile indices are wrapped.
 */
export function windowTileSource(world: Pick<BakeWorld, "n" | "gN" | "cN">, cut: WindowCutter, look: Look, mask: Uint8Array, capacity: number): TileSource {
  void world, cut, look, mask, capacity;
  throw new Error("not implemented");
}
