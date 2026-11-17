// Periodic gradient noise with rotated octaves. Every octave tiles exactly:
// octave k samples at M^k·p with the integer matrix M = [[2, 1], [−1, 2]].

import { hash2 } from "./hash.ts";
import { wrap } from "./torus.ts";

/** 16 unit gradients; gradient k is (cos k·22.5°, sin k·22.5°), as literals. */
export const GRADIENTS: Float64Array = new Float64Array([
  1, 0,
  0.9238795325112867, 0.3826834323650898,
  0.7071067811865476, 0.7071067811865476,
  0.3826834323650898, 0.9238795325112867,
  0, 1,
  -0.3826834323650898, 0.9238795325112867,
  -0.7071067811865476, 0.7071067811865476,
  -0.9238795325112867, 0.3826834323650898,
  -1, 0,
  -0.9238795325112867, -0.3826834323650898,
  -0.7071067811865476, -0.7071067811865476,
  -0.3826834323650898, -0.9238795325112867,
  0, -1,
  0.3826834323650898, -0.9238795325112867,
  0.7071067811865476, -0.7071067811865476,
  0.9238795325112867, -0.3826834323650898,
]);

/** Quintic fade 6t⁵ − 15t⁴ + 10t³, zero derivative at 0 and 1. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Corner gradient dotted with the offset from that corner to (x, y). */
function corner(ix: number, iy: number, dx: number, dy: number, fx: number, fy: number, period: number, seed: number): number {
  const i = hash2(wrap(ix + dx, period), wrap(iy + dy, period), seed) & 15;
  return GRADIENTS[i * 2] * (fx - dx) + GRADIENTS[i * 2 + 1] * (fy - dy);
}

/** Gradient noise on a lattice of `period` units that wraps; range [−1, 1]. */
export function gradNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fade(fx);
  const v = fade(fy);
  const n00 = corner(ix, iy, 0, 0, fx, fy, period, seed);
  const n10 = corner(ix, iy, 1, 0, fx, fy, period, seed);
  const n01 = corner(ix, iy, 0, 1, fx, fy, period, seed);
  const n11 = corner(ix, iy, 1, 1, fx, fy, period, seed);
  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return (nx0 + v * (nx1 - nx0)) * Math.SQRT2;
}

/** M^k in row-major order [a, b, c, d] for M = [[2, 1], [−1, 2]]. */
export function octaveMatrixPower(k: number): [number, number, number, number] {
  let a = 1;
  let b = 0;
  let c = 0;
  let d = 1;
  for (let i = 0; i < k; i++) {
    const na = 2 * a + c;
    const nb = 2 * b + d;
    const nc = -a + 2 * c;
    const nd = -b + 2 * d;
    a = na;
    b = nb;
    c = nc;
    d = nd;
  }
  return [a, b, c, d];
}

function octaveSum(x: number, y: number, period: number, octaves: number, gain: number, seed: number, ridge: boolean): number {
  let sum = 0;
  let weightSum = 0;
  let weight = 1;
  for (let k = 0; k < octaves; k++) {
    const [a, b, c, d] = octaveMatrixPower(k);
    const seedK = (seed + Math.imul(k, 0x9e3779b9)) >>> 0;
    const n = gradNoise(a * x + b * y, c * x + d * y, period, seedK);
    sum += (ridge ? 1 - Math.abs(n) : n) * weight;
    weightSum += weight;
    weight *= gain;
  }
  return sum / weightSum;
}

/** Normalised sum of octaves; range [−1, 1]. */
export function fbm(x: number, y: number, period: number, octaves: number, gain: number, seed: number): number {
  return octaveSum(x, y, period, octaves, gain, seed, false);
}

/** Normalised sum of 1 − |octave|; range [0, 1]. */
export function ridgedFbm(x: number, y: number, period: number, octaves: number, gain: number, seed: number): number {
  return octaveSum(x, y, period, octaves, gain, seed, true);
}
