// Void-and-cluster blue noise (Ulichney 1993) on a torus.
// Energy is a Gaussian with σ = 1.5, truncated at radius 6, wrapped so the
// mask has no seam. A 10% prototype is relaxed, then ranks are painted by
// peeling tightest clusters and filling largest voids.

import { rngFor } from "./rng.ts";

export const BLUE_SEED = 1;

const RADIUS = 6;
const RADIUS2 = RADIUS * RADIUS;

/**
 * exp(x) for x <= 0. Halve until the argument is in [-1, 0], sum a Taylor
 * polynomial, then square back. Ordering of the kernel depends only on this,
 * and Math.exp is not available here.
 */
function expSeries(x: number): number {
  let halves = 0;
  let r = x;
  while (r < -1) {
    r = r * 0.5;
    halves = halves + 1;
  }
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 40; k++) {
    term = (term * r) / k;
    sum = sum + term;
  }
  for (let i = 0; i < halves; i++) sum = sum * sum;
  return sum;
}

function buildKernel(): { dx: Int8Array; dy: Int8Array; w: Float64Array } {
  const weight = new Float64Array(RADIUS2 + 1);
  for (let r2 = 0; r2 <= RADIUS2; r2++) weight[r2] = expSeries((-r2) / 4.5);
  const dx: number[] = [];
  const dy: number[] = [];
  const w: number[] = [];
  for (let y = -RADIUS; y <= RADIUS; y++) {
    for (let x = -RADIUS; x <= RADIUS; x++) {
      const r2 = x * x + y * y;
      if (r2 > RADIUS2) continue;
      dx.push(x);
      dy.push(y);
      w.push(weight[r2]);
    }
  }
  return { dx: Int8Array.from(dx), dy: Int8Array.from(dy), w: Float64Array.from(w) };
}

const KERNEL = buildKernel();
const KDX = KERNEL.dx;
const KDY = KERNEL.dy;
const KW = KERNEL.w;

interface Field {
  size: number;
  mask: Uint8Array;
  energy: Float64Array;
  /** Per-row maximum energy among ones, and its lowest cell index (-1 if none). */
  blockMax: Float64Array;
  blockMaxI: Int32Array;
  /** Per-row minimum energy among zeros, and its lowest cell index (-1 if none). */
  blockMin: Float64Array;
  blockMinI: Int32Array;
}

function makeField(size: number): Field {
  const n = size * size;
  return {
    size,
    mask: new Uint8Array(n),
    energy: new Float64Array(n),
    blockMax: new Float64Array(size),
    blockMaxI: new Int32Array(size),
    blockMin: new Float64Array(size),
    blockMinI: new Int32Array(size),
  };
}

function addKernel(f: Field, i: number, sign: number): void {
  const size = f.size;
  const m = size - 1;
  const energy = f.energy;
  const x = i & m;
  const y = (i / size) | 0;
  const dx = KDX;
  const dy = KDY;
  const w = KW;
  for (let k = 0; k < dx.length; k++) {
    const xx = (x + dx[k]) & m;
    const yy = (y + dy[k]) & m;
    energy[yy * size + xx] += sign * w[k];
  }
}

/** Lowest index wins ties, because the scan is increasing and replaces only on a strict improvement. */
function rescanRow(f: Field, y: number): void {
  const energy = f.energy;
  const mask = f.mask;
  const size = f.size;
  const start = y * size;
  const end = start + size;
  let maxE = -1;
  let maxI = -1;
  let minE = Infinity;
  let minI = -1;
  for (let i = start; i < end; i++) {
    const e = energy[i];
    if (mask[i]) {
      if (e > maxE) {
        maxE = e;
        maxI = i;
      }
    } else if (e < minE) {
      minE = e;
      minI = i;
    }
  }
  f.blockMax[y] = maxE;
  f.blockMaxI[y] = maxI;
  f.blockMin[y] = minE;
  f.blockMinI[y] = minI;
}

function rescanAll(f: Field): void {
  for (let y = 0; y < f.size; y++) rescanRow(f, y);
}

function rescanTouched(f: Field, i: number): void {
  const size = f.size;
  const y = (i / size) | 0;
  const m = size - 1;
  for (let o = -RADIUS; o <= RADIUS; o++) rescanRow(f, (y + o) & m);
}

function tightest(f: Field): number {
  const blockMax = f.blockMax;
  const blockMaxI = f.blockMaxI;
  let bestE = -1;
  let bestI = -1;
  for (let y = 0; y < f.size; y++) {
    const i = blockMaxI[y];
    if (i < 0) continue;
    const e = blockMax[y];
    if (e > bestE) {
      bestE = e;
      bestI = i;
    }
  }
  return bestI;
}

function largestVoid(f: Field): number {
  const blockMin = f.blockMin;
  const blockMinI = f.blockMinI;
  let bestE = Infinity;
  let bestI = -1;
  for (let y = 0; y < f.size; y++) {
    const i = blockMinI[y];
    if (i < 0) continue;
    const e = blockMin[y];
    if (e < bestE) {
      bestE = e;
      bestI = i;
    }
  }
  return bestI;
}

function turn(f: Field, i: number, on: number): void {
  addKernel(f, i, on ? 1 : -1);
  f.mask[i] = on;
  rescanTouched(f, i);
}

/** Ranks 0 … size² − 1, each exactly once; size is a power of two. */
export function voidAndCluster(size: number, seed: number): Uint16Array {
  const n = size * size;
  const ones = Math.floor(0.1 * n);
  const rng = rngFor(seed, "bluenoise");
  const f = makeField(size);

  const pick = new Uint32Array(n);
  for (let i = 0; i < n; i++) pick[i] = i;
  for (let i = 0; i < ones; i++) {
    const j = i + rng.int(n - i);
    const t = pick[i];
    pick[i] = pick[j];
    pick[j] = t;
    f.mask[pick[i]] = 1;
  }
  for (let i = 0; i < ones; i++) addKernel(f, pick[i], 1);
  rescanAll(f);

  // Move the tightest cluster into the largest void until the swap is a no-op.
  for (let guard = 0; guard < n; guard++) {
    const c = tightest(f);
    turn(f, c, 0);
    const v = largestVoid(f);
    turn(f, v, 1);
    if (c === v) break;
  }

  const protoMask = f.mask.slice();
  const protoEnergy = f.energy.slice();
  const ranks = new Uint16Array(n);

  for (let rank = ones - 1; rank >= 0; rank--) {
    const c = tightest(f);
    ranks[c] = rank;
    turn(f, c, 0);
  }

  f.mask.set(protoMask);
  f.energy.set(protoEnergy);
  rescanAll(f);

  for (let rank = ones; rank < n; rank++) {
    const v = largestVoid(f);
    ranks[v] = rank;
    turn(f, v, 1);
  }

  return ranks;
}

/** One byte per cell: rank >> (31 − clz32(ranks.length) − 8). */
export function ranksToU8(ranks: Uint16Array): Uint8Array {
  const shift = 31 - Math.clz32(ranks.length) - 8;
  const out = new Uint8Array(ranks.length);
  for (let i = 0; i < ranks.length; i++) out[i] = ranks[i] >> shift;
  return out;
}
