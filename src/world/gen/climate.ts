// S8 inputs: smooth climate fields on the coarse grid C, from G-grid data.

import { sortIndicesBy } from "../core/heap.ts";

/** 2 × 2 box average from G (gN²) to C ((gN/2)²). */
export function toCoarse(g: ArrayLike<number>, gN: number): Float32Array {
  const cN = gN / 2;
  const out = new Float32Array(cN * cN);
  for (let cy = 0; cy < cN; cy++) {
    for (let cx = 0; cx < cN; cx++) {
      const gx = 2 * cx;
      const gy = 2 * cy;
      const v =
        g[gy * gN + gx] +
        g[gy * gN + gx + 1] +
        g[(gy + 1) * gN + gx] +
        g[(gy + 1) * gN + gx + 1];
      out[cy * cN + cx] = v / 4;
    }
  }
  return out;
}

function blurAxisX(src: Float32Array, dst: Float32Array, n: number, radius: number): void {
  const w = 2 * radius + 1;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const x = ((k % n) + n) % n;
      sum += src[row + x];
    }
    dst[row] = sum / w;
    for (let x = 1; x < n; x++) {
      sum += src[row + (x + radius) % n] - src[row + (x - radius - 1 + n) % n];
      dst[row + x] = sum / w;
    }
  }
}

function blurAxisY(src: Float32Array, dst: Float32Array, n: number, radius: number): void {
  const w = 2 * radius + 1;
  for (let x = 0; x < n; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const y = ((k % n) + n) % n;
      sum += src[y * n + x];
    }
    dst[x] = sum / w;
    for (let y = 1; y < n; y++) {
      sum += src[((y + radius) % n) * n + x] - src[((y - radius - 1 + n) % n) * n + x];
      dst[y * n + x] = sum / w;
    }
  }
}

/** Separable box blur on an n × n torus, `radius` nodes, `passes` times (3 passes ≈ Gaussian). */
export function blurTorus(a: Float32Array, n: number, radius: number, passes: number): Float32Array {
  let cur = new Float32Array(a);
  const tmp = new Float32Array(n * n);
  for (let pass = 0; pass < passes; pass++) {
    blurAxisX(cur, tmp, n, radius);
    blurAxisY(tmp, cur, n, radius);
  }
  return cur;
}

export interface ClimateParams {
  /** Moisture blur radius, C nodes. */
  moistureRadius: number;
  /** Upwind search distance, C nodes. */
  windReach: number;
  /** Height the upwind horizon drops per C node of distance. */
  windDropPerNode: number;
  /** Height difference that spans the full exposure range. */
  windScale: number;
}

export interface Climate {
  /** 0–1: blurred rain, divided by its 95th percentile over land, clamped. */
  moisture: Float32Array;
  /** 0–1: exposure to the south-west wind; 1 over open sea. */
  wind: Float32Array;
}

function toCoarseHeight(h: Float64Array, isSea: Uint8Array, gN: number): Float32Array {
  const cN = gN / 2;
  const out = new Float32Array(cN * cN);
  for (let cy = 0; cy < cN; cy++) {
    for (let cx = 0; cx < cN; cx++) {
      let sum = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const gx = 2 * cx + dx;
          const gy = 2 * cy + dy;
          const gi = gy * gN + gx;
          sum += isSea[gi] ? 0 : h[gi];
        }
      }
      out[cy * cN + cx] = sum / 4;
    }
  }
  return out;
}

function gNodeSea(gx: number, gy: number, isSea: Uint8Array, gN: number): boolean {
  return isSea[gy * gN + gx] !== 0;
}

function cNodeAllSea(cx: number, cy: number, isSea: Uint8Array, gN: number): boolean {
  const gx = 2 * cx;
  const gy = 2 * cy;
  return (
    gNodeSea(gx, gy, isSea, gN) &&
    gNodeSea(gx + 1, gy, isSea, gN) &&
    gNodeSea(gx, gy + 1, isSea, gN) &&
    gNodeSea(gx + 1, gy + 1, isSea, gN)
  );
}

function cNodeLand(cx: number, cy: number, isSea: Uint8Array, gN: number): boolean {
  return !cNodeAllSea(cx, cy, isSea, gN);
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function percentile95Land(blurred: Float32Array, cN: number, isSea: Uint8Array, gN: number): number {
  const land: number[] = [];
  for (let cy = 0; cy < cN; cy++) {
    for (let cx = 0; cx < cN; cx++) {
      if (cNodeLand(cx, cy, isSea, gN)) {
        land.push(blurred[cy * cN + cx]);
      }
    }
  }
  const n = land.length;
  if (n === 0) return 1;
  const order = sortIndicesBy(land);
  const rank = Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1));
  const p95 = land[order[rank]];
  if (p95 <= 0) return 1;
  return p95;
}

/** h and rain on G; returns fields on C (gN / 2). */
export function climateFields(h: Float64Array, rain: Float64Array, isSea: Uint8Array, gN: number, p: ClimateParams): Climate {
  const cN = gN / 2;
  const cc = cN * cN;

  const blurred = blurTorus(toCoarse(rain, gN), cN, p.moistureRadius, 3);
  const p95 = percentile95Land(blurred, cN, isSea, gN);
  const moisture = new Float32Array(cc);
  for (let i = 0; i < cc; i++) {
    moisture[i] = clamp01(blurred[i] / p95);
  }

  const hC = toCoarseHeight(h, isSea, gN);
  const wind = new Float32Array(cc);
  for (let y = 0; y < cN; y++) {
    for (let x = 0; x < cN; x++) {
      const i = y * cN + x;
      if (cNodeAllSea(x, y, isSea, gN)) {
        wind[i] = 1;
        continue;
      }
      const h0 = hC[i];
      let u = hC[((y + 1) % cN) * cN + ((x - 1 + cN) % cN)] - p.windDropPerNode;
      const reach = p.windReach;
      for (let k = 2; k <= reach; k++) {
        const hu = hC[((y + k) % cN) * cN + ((x - k + cN) % cN)] - p.windDropPerNode * k;
        if (hu > u) u = hu;
      }
      wind[i] = clamp01(0.5 + (h0 - u) / p.windScale);
    }
  }

  return { moisture, wind };
}