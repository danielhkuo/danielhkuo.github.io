// S5 Talus: thermal erosion. Material slides downhill until no slope exceeds
// its rock's angle of repose; what lands accumulates in a debris layer.

import { NB8_DIST, NB8_DX, NB8_DY } from "../core/torus.ts";

export interface TalusResult {
  h: Float64Array;
  /** Material deposited on each node, ≥ 0; scree is later drawn where it is thick. */
  debris: Float64Array;
}

/**
 * @param cellsPerNode node spacing in cells (4 on G); repose is height per cell.
 * @param repose angle of repose per rock class [hard, medium, soft], e.g. [1.8, 1.0, 0.6].
 */
export function talus(
  h: Float64Array,
  n: number,
  rock: Uint8Array,
  repose: readonly [number, number, number],
  cellsPerNode: number,
  sweeps: number,
): TalusResult {
  const size = n * n;
  const debris = new Float64Array(size);
  let curr = new Float64Array(size);
  curr.set(h);
  let next = new Float64Array(size);

  // Allowed drop to neighbour k for rock class r: repose · cellsPerNode · distance.
  const allow = new Float64Array(24);
  for (let r = 0; r < 3; r++) {
    const scale = repose[r] * cellsPerNode;
    const row = r * 8;
    for (let k = 0; k < 8; k++) allow[row + k] = scale * NB8_DIST[k];
  }

  // Coordinate c ∈ [−1, n] → wrapped index, looked up as wrap[c + 1].
  const wrap = new Int32Array(n + 2);
  wrap[0] = n - 1;
  wrap[n + 1] = 0;
  for (let i = 0; i < n; i++) wrap[i + 1] = i;

  const ex = new Float64Array(8);
  const nb = new Int32Array(8);

  for (let s = 0; s < sweeps; s++) {
    next.set(curr);
    let moved = false;
    for (let y = 0; y < n; y++) {
      const row = y * n;
      for (let x = 0; x < n; x++) {
        const i = row + x;
        const hi = curr[i];
        const base = rock[i] * 8;
        let maxE = 0;
        let total = 0;
        for (let k = 0; k < 8; k++) {
          const j = wrap[y + NB8_DY[k] + 1] * n + wrap[x + NB8_DX[k] + 1];
          const excess = hi - curr[j] - allow[base + k];
          if (excess > 0) {
            ex[k] = excess;
            nb[k] = j;
            total += excess;
            if (excess > maxE) maxE = excess;
          } else {
            ex[k] = 0;
          }
        }
        if (maxE > 0) {
          // Half the largest excess, shared in proportion to each excess (Musgrave 1989).
          const portion = (0.5 * maxE) / total;
          for (let k = 0; k < 8; k++) {
            const e = ex[k];
            if (e > 0) {
              const share = e * portion;
              next[i] -= share;
              const j = nb[k];
              next[j] += share;
              debris[j] += share;
              moved = true;
            }
          }
        }
      }
    }
    if (!moved) break;
    const swap = curr;
    curr = next;
    next = swap;
  }

  return { h: curr, debris };
}
