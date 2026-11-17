// S5 Talus: thermal erosion. Material slides downhill until no slope exceeds
// its rock's angle of repose; what lands accumulates in a debris layer.

import { NB8_DIST, NB8_DX, NB8_DY, wrapIndex } from "../core/torus.ts";
import { accumulate, priorityFlood, receivers } from "./flood.ts";

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

export interface ScreeParams {
  /** Ground steeper than this (height per cell, down its fall line) sheds rock. */
  shed: number;
  /** Units shed per unit of slope over `shed`, in all. */
  rate: number;
  /** Debris comes to rest on ground gentler than this, and its piles stand no steeper. */
  repose: number;
  /** A stream draining more than this (cells²) carries off what reaches it: nothing is laid in its bed. */
  wash: number;
  /** The shedding is done in this many falls; the ground is re-read between them, so a pile turns the next fall aside. */
  passes: number;
  /** Sweeps that settle the piles after each fall. */
  sweeps: number;
}

/**
 * Rockfall. Steep ground sheds a little rock, which runs down the fall line and stops at the foot of the slope: the
 * first node gentle enough to hold it. Faces drop it in aprons, gullies gather it into cones, and a pile that stands
 * too steep slumps to repose. Nothing is laid in the sea or in a hollow that will hold a lake, and a pile never dams
 * the ground behind it: every node drains afterwards as it did before.
 *
 * @param cellsPerNode node spacing in cells (4 on G); slopes are height per cell.
 */
export function scree(h: Float64Array, n: number, isSea: Uint8Array, cellsPerNode: number, sp: ScreeParams, eps: number): TalusResult {
  const size = n * n;
  const out = new Float64Array(h);
  const debris = new Float64Array(size);
  if (sp.passes <= 0 || sp.rate <= 0) return { h: out, debris };

  // Hollows that hold water before any rock falls are left alone.
  const before = priorityFlood(out, n, isSea, eps).filled;
  const lake = new Uint8Array(size);
  for (let i = 0; i < size; i++) if (before[i] > out[i] + 1e-3) lake[i] = 1;

  const carry = new Float64Array(size);
  const donor = new Float64Array(size);
  const share = sp.rate / sp.passes;
  const wash = sp.wash / (cellsPerNode * cellsPerNode);
  const allow = new Float64Array(8);
  for (let k = 0; k < 8; k++) allow[k] = sp.repose * cellsPerNode * NB8_DIST[k];

  for (let pass = 0; pass < sp.passes; pass++) {
    const { order } = priorityFlood(out, n, isSea, eps);
    const { rcv, dist } = receivers(out, n, isSea, null);
    const area = accumulate(order, rcv, isSea, null);
    carry.fill(0);
    donor.fill(Infinity);
    // From the summits down: every node is visited after all that drain to it.
    for (let p = size - 1; p >= 0; p--) {
      const i = order[p];
      if (isSea[i] !== 0 || lake[i] !== 0) continue;
      const r = rcv[i];
      const drop = out[i] - out[r];
      if (drop <= 0) continue;
      const slope = drop / (dist[i] * cellsPerNode);
      let load = carry[i];
      if (slope > sp.shed) {
        const cut = Math.min(share * (slope - sp.shed), 0.25 * drop);
        out[i] -= cut;
        debris[i] = Math.max(0, debris[i] - cut);
        load += cut;
      } else if (load > 0 && area[i] > wash) {
        load = 0;
      } else if (slope < sp.repose && load > 0) {
        // The foot: fill to just under the lowest ground that drains here, and send the rest on.
        const room = Math.min(load, donor[i] - eps - out[i]);
        if (room > 0) {
          out[i] += room;
          debris[i] += room;
          load -= room;
        }
      }
      if (load > 0) carry[r] += load;
      if (out[i] < donor[r]) donor[r] = out[i];
    }
    settle(out, debris, n, allow, sp.sweeps, isSea, lake);
  }

  // A slump can leave a hollow a node or two wide; level it with the debris round it.
  const after = priorityFlood(out, n, isSea, eps).filled;
  for (let i = 0; i < size; i++) {
    if (isSea[i] !== 0 || lake[i] !== 0) continue;
    const lift = after[i] - out[i];
    if (lift > 0) {
      out[i] = after[i];
      debris[i] += lift;
    }
  }
  return { h: out, debris };
}

/**
 * Debris standing steeper than repose slides to the neighbour it overhangs most, half the excess at a time; bedrock
 * stays. What slides into the sea or a lake is gone.
 */
function settle(h: Float64Array, debris: Float64Array, n: number, allow: Float64Array, sweeps: number, isSea: Uint8Array, lake: Uint8Array): void {
  const size = n * n;
  let active = new Int32Array(1024), count = 0;
  for (let i = 0; i < size; i++) {
    if (debris[i] <= 0) continue;
    if (count === active.length) {
      const grown = new Int32Array(count * 2);
      grown.set(active);
      active = grown;
    }
    active[count++] = i;
  }
  for (let s = 0; s < sweeps; s++) {
    let moved = false;
    const end = count;
    // Alternate the direction of travel so the piles do not lean with the scan.
    for (let q = 0; q < end; q++) {
      const i = active[s % 2 === 0 ? q : end - 1 - q];
      const pile = debris[i];
      if (pile <= 0) continue;
      const x = i % n, y = (i - x) / n;
      let best = 0, bestJ = -1;
      for (let k = 0; k < 8; k++) {
        const j = wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n);
        const excess = h[i] - h[j] - allow[k];
        if (excess > best) {
          best = excess;
          bestJ = j;
        }
      }
      if (bestJ < 0) continue;
      const m = Math.min(pile, 0.5 * best);
      h[i] -= m;
      debris[i] = pile - m;
      moved = true;
      if (isSea[bestJ] !== 0 || lake[bestJ] !== 0) continue;
      if (debris[bestJ] <= 0) {
        if (count === active.length) {
          const grown = new Int32Array(count * 2);
          grown.set(active);
          active = grown;
        }
        active[count++] = bestJ;
      }
      h[bestJ] += m;
      debris[bestJ] += m;
    }
    if (!moved) break;
  }
}
