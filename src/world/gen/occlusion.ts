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
  const per = block / cellsPerNode;
  const side = (gN * cellsPerNode) / block;
  const out = new Uint8Array(side * side);
  // Per column, the floor at row y is the max of h[y+k] − slope·k over the next
  // K rows. That max is the head of a deque of (h − slope·row) kept high-to-low,
  // swept north from a full window so the ring is already warm. Block rows fold
  // the node floors in place; nothing is stored per node.
  const K = Math.ceil(OCCLUSION_REACH / cellsPerNode);
  const slope = 0.8 * cellsPerNode;
  const bN = side;
  const idx = new Int32Array(gN + K);
  const key = new Float64Array(gN + K);

  for (let x = 0; x < gN; x++) {
    const bx = Math.floor(x / per);
    let head = 0;
    let tail = 0;
    let best = 0;
    let count = 0;
    let by = bN - 1;
    for (let y = gN - 1 + K; y >= 0; y--) {
      const far = y + K;
      while (head < tail && idx[head] > far) head++;
      if (y <= gN - 1) {
        const src = idx[head];
        const k = src - y;
        const m = ground[(src % gN) * gN + x] - 0.8 * k * cellsPerNode;
        if (m > best) best = m;
        count++;
        if (count === per) {
          const q = best > 0 ? Math.min(255, Math.ceil(best)) : 0;
          const at = by * bN + bx;
          if (q > out[at]) out[at] = q;
          by--;
          count = 0;
          best = 0;
        }
      }
      const ky = ground[(y % gN) * gN + x] - slope * y;
      while (tail > head && key[tail - 1] <= ky) tail--;
      idx[tail] = y;
      key[tail] = ky;
      tail++;
    }
  }
  return out;
}
