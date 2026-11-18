// The occlusion floor: for each block of the world, the lowest altitude at which
// a flier is not hidden by land to its south. The camera looks north, so a hill
// south of the flier draws over it once the flier is low enough.

/** How far south, in cells, land can hide a flier: 0.8 · 200 = 160 covers the highest land. */
export const OCCLUSION_REACH = 200;

/**
 * One byte per `block`-cell square, row-major over (n / block)², n = gN · cellsPerNode. For each G node the floor is
 * max(0, max over k = 1 … ceil(OCCLUSION_REACH / cellsPerNode) of h[x, y + k] − 0.8 · k · cellsPerNode), wrapping;
 * a block holds the ceiling of its nodes' largest floor, at most 255.
 */
export function occlusionFloor(ground: ArrayLike<number>, gN: number, cellsPerNode: number, block: number): Uint8Array {
  void ground;
  void gN;
  void cellsPerNode;
  void block;
  throw new Error("not implemented");
}
