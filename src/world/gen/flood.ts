// Priority-Flood (Barnes 2014, +ε), steepest-descent receivers and drainage
// accumulation on the torus.

import { MinHeap } from "../core/heap.ts";
import { rngFor } from "../core/rng.ts";
import { NB8_DIST, NB8_DX, NB8_DY, wrapIndex } from "../core/torus.ts";

export interface Jitter {
  amp: number;
  /** Per-node offsets in node units, in [−amp, amp]. */
  jx: Float32Array;
  jy: Float32Array;
}

export function makeJitter(n: number, amp: number, seed: number): Jitter {
  const count = n * n;
  const jx = new Float32Array(count);
  const jy = new Float32Array(count);
  if (amp !== 0) {
    const rng = rngFor(seed, "jitter");
    for (let i = 0; i < count; i++) {
      jx[i] = rng.range(-amp, amp);
      jy[i] = rng.range(-amp, amp);
    }
  }
  return { amp, jx, jy };
}

/** Fills pits so every land node drains to the sea; `order` is all n² nodes in pop order. */
export function priorityFlood(h: Float64Array, n: number, isSea: Uint8Array, eps: number): { filled: Float64Array; order: Uint32Array } {
  const nn = n * n;
  const filled = new Float64Array(h);
  const visited = new Uint8Array(nn);
  const order = new Uint32Array(nn);
  const heap = new MinHeap(nn);

  let sea = 0;
  let minI = 0;
  for (let i = 0; i < nn; i++) {
    if (h[i] < h[minI]) minI = i;
    if (isSea[i]) {
      visited[i] = 1;
      heap.push(h[i], i);
      sea++;
    }
  }
  // No coastline: the global minimum (lowest index on ties) is the outlet.
  if (sea === 0 && nn > 0) {
    visited[minI] = 1;
    heap.push(h[minI], minI);
  }

  let p = 0;
  while (heap.size > 0) {
    const i = heap.pop();
    order[p++] = i;
    const x = i % n;
    const y = (i - x) / n;
    const spill = filled[i] + eps;
    for (let k = 0; k < 8; k++) {
      const j = wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n);
      if (visited[j]) continue;
      visited[j] = 1;
      const fj = Math.max(h[j], spill);
      filled[j] = fj;
      heap.push(fj, j);
    }
  }

  return { filled, order };
}

/** Steepest descent among the 8 wrapped neighbours; ties go to the lowest node index; sea nodes point at themselves. */
export function receivers(f: Float64Array, n: number, isSea: Uint8Array, jitter: Jitter | null): { rcv: Int32Array; dist: Float64Array } {
  const nn = n * n;
  const rcv = new Int32Array(nn);
  const dist = new Float64Array(nn);
  const jx = jitter ? jitter.jx : null;
  const jy = jitter ? jitter.jy : null;

  for (let i = 0; i < nn; i++) {
    if (isSea[i]) {
      rcv[i] = i;
      continue;
    }
    const x = i % n;
    const y = (i - x) / n;
    const fi = f[i];
    let bestS = 0;
    let bestJ = -1;
    let bestD = 0;
    let lowH = Infinity;
    let lowJ = -1;
    let lowD = 0;

    for (let k = 0; k < 8; k++) {
      const dx = NB8_DX[k];
      const dy = NB8_DY[k];
      const j = wrapIndex(x + dx, y + dy, n);
      let d: number;
      if (jx && jy) {
        const ox = dx + jx[j] - jx[i];
        const oy = dy + jy[j] - jy[i];
        d = Math.sqrt(ox * ox + oy * oy);
      } else {
        d = NB8_DIST[k];
      }
      const s = (fi - f[j]) / d;
      if (s > bestS || (s === bestS && j < bestJ)) {
        bestS = s;
        bestJ = j;
        bestD = d;
      }
      const hj = f[j];
      if (hj < lowH || (hj === lowH && j < lowJ)) {
        lowH = hj;
        lowJ = j;
        lowD = d;
      }
    }

    if (bestJ >= 0) {
      rcv[i] = bestJ;
      dist[i] = bestD;
    } else {
      rcv[i] = lowJ;
      dist[i] = lowD;
    }
  }

  return { rcv, dist };
}

/** Drainage area: land starts at rain[i] (or 1), sea at 0, summed down the reversed order. */
export function accumulate(order: Uint32Array, rcv: Int32Array, isSea: Uint8Array, rain: Float64Array | null): Float64Array {
  const nn = isSea.length;
  const area = new Float64Array(nn);
  for (let i = 0; i < nn; i++) {
    if (!isSea[i]) area[i] = rain ? rain[i] : 1;
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    if (!isSea[i]) area[rcv[i]] += area[i];
  }
  return area;
}
