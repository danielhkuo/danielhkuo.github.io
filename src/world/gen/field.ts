// Shared field helpers for the stages after erosion: plan fields carried from
// C to G, drainage on a surface, and nearest-source distances on the torus.

import { torusDelta, wrap, wrapIndex } from "../core/torus.ts";
import { accumulate, priorityFlood, receivers } from "./flood.ts";
import { ARCHETYPE_COUNT } from "./params.ts";
import type { Plan } from "./plan.ts";

/** Region weights on a grid f times finer than the plan's, bilinear; six planes, archetype-major. */
export function regionsOn(plan: Plan, f: number): Float32Array {
  const cN = plan.n;
  const n = cN * f;
  const cc = cN * cN;
  const nn = n * n;
  const out = new Float32Array(ARCHETYPE_COUNT * nn);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / f - 0.5;
    const jy = Math.floor(v);
    const ty = v - jy;
    const y0 = wrap(jy, cN) * cN;
    const y1 = wrap(jy + 1, cN) * cN;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / f - 0.5;
      const jx = Math.floor(u);
      const tx = u - jx;
      const x0 = wrap(jx, cN);
      const x1 = wrap(jx + 1, cN);
      const i = y * n + x;
      for (let a = 0; a < ARCHETYPE_COUNT; a++) {
        const o = a * cc;
        const top = plan.regions[o + y0 + x0] + tx * (plan.regions[o + y0 + x1] - plan.regions[o + y0 + x0]);
        const bot = plan.regions[o + y1 + x0] + tx * (plan.regions[o + y1 + x1] - plan.regions[o + y1 + x0]);
        out[a * nn + i] = top + ty * (bot - top);
      }
    }
  }
  return out;
}

/** Rock class on a grid f times finer than the plan's: each fine node takes its coarse node's rock. */
export function rockOn(plan: Plan, f: number): Uint8Array {
  const cN = plan.n;
  const n = cN * f;
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    const row = Math.floor(y / f) * cN;
    for (let x = 0; x < n; x++) out[y * n + x] = plan.rock[row + Math.floor(x / f)];
  }
  return out;
}

export interface Drainage {
  /** The surface with pits filled. */
  filled: Float64Array;
  order: Uint32Array;
  rcv: Int32Array;
  /** Drainage area in nodes. */
  area: Float64Array;
}

export function drainage(h: Float64Array, n: number, isSea: Uint8Array, eps: number): Drainage {
  const { filled, order } = priorityFlood(h, n, isSea, eps);
  const { rcv } = receivers(filled, n, isSea, null);
  const area = accumulate(order, rcv, isSea, null);
  return { filled, order, rcv, area };
}

export interface Nearest {
  /** Distance in nodes to the nearest source; Infinity when there is no source. */
  dist: Float32Array;
  /** Index of that source; −1 when there is none. */
  src: Int32Array;
}

/**
 * Nearest source node for every node: source indices are swept across the
 * grid (forward then backward, two laps so they cross the wrap) and each node
 * keeps the carried source that is closest by exact torus distance. Ties go
 * to the lower source index.
 */
export function nearestSource(n: number, isSource: Uint8Array): Nearest {
  const nn = n * n;
  const dist = new Float32Array(nn).fill(Infinity);
  const src = new Int32Array(nn).fill(-1);
  for (let i = 0; i < nn; i++) {
    if (isSource[i]) {
      dist[i] = 0;
      src[i] = i;
    }
  }
  const relax = (i: number, x: number, y: number, j: number): void => {
    const s = src[j];
    if (s < 0 || s === src[i]) return;
    const sx = s % n;
    const dx = torusDelta(sx, x, n);
    const dy = torusDelta((s - sx) / n, y, n);
    const d = Math.fround(Math.sqrt(dx * dx + dy * dy));
    if (d < dist[i] || (d === dist[i] && s < src[i])) {
      dist[i] = d;
      src[i] = s;
    }
  };
  for (let lap = 0; lap < 2; lap++) {
    for (let y = 0; y < n; y++) {
      const yN = wrap(y - 1, n) * n;
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (dist[i] === 0) continue;
        const xW = wrap(x - 1, n);
        const xE = wrap(x + 1, n);
        relax(i, x, y, y * n + xW);
        relax(i, x, y, yN + xW);
        relax(i, x, y, yN + x);
        relax(i, x, y, yN + xE);
      }
      for (let x = n - 1; x >= 0; x--) {
        const i = y * n + x;
        if (dist[i] !== 0) relax(i, x, y, y * n + wrap(x + 1, n));
      }
    }
    for (let y = n - 1; y >= 0; y--) {
      const yS = wrap(y + 1, n) * n;
      for (let x = n - 1; x >= 0; x--) {
        const i = y * n + x;
        if (dist[i] === 0) continue;
        const xW = wrap(x - 1, n);
        const xE = wrap(x + 1, n);
        relax(i, x, y, y * n + xE);
        relax(i, x, y, yS + xE);
        relax(i, x, y, yS + x);
        relax(i, x, y, yS + xW);
      }
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (dist[i] !== 0) relax(i, x, y, y * n + wrap(x - 1, n));
      }
    }
  }
  return { dist, src };
}

/** Separable box blur of radius r nodes on the torus, `passes` times. */
export function boxBlur(a: Float32Array, n: number, r: number, passes: number): Float32Array {
  let src = new Float32Array(a);
  let dst = new Float32Array(a.length);
  const w = 2 * r + 1;
  for (let pass = 0; pass < passes * 2; pass++) {
    const horizontal = pass % 2 === 0;
    for (let line = 0; line < n; line++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += horizontal ? src[line * n + wrap(k, n)] : src[wrap(k, n) * n + line];
      for (let t = 0; t < n; t++) {
        if (horizontal) {
          dst[line * n + t] = sum / w;
          sum += src[line * n + wrap(t + r + 1, n)] - src[line * n + wrap(t - r, n)];
        } else {
          dst[t * n + line] = sum / w;
          sum += src[wrap(t + r + 1, n) * n + line] - src[wrap(t - r, n) * n + line];
        }
      }
    }
    const swap = src;
    src = dst;
    dst = swap;
  }
  return src;
}

/** Wrapped node index of the node whose centre is nearest (x, y) cells. */
export function nodeAt(x: number, y: number, cellsPerNode: number, n: number): number {
  return wrapIndex(Math.floor(x / cellsPerNode), Math.floor(y / cellsPerNode), n);
}
