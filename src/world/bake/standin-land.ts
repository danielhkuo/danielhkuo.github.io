// STAND-INS for generator stages that are not built yet. Everything in this
// file is throwaway: it exists so the bake has believable land to draw until
// gen/coast.ts lands, and each
// function is replaced by passing the real stage's output to buildBakeWorld.

import { fbm } from "../core/noise.ts";
import { wrapIndex } from "../core/torus.ts";

/** Chamfer (3–4) distance in nodes from every node to the nearest node where `src` is set, capped. */
function chamfer(src: Uint8Array, n: number, cap: number): Float32Array {
  const big = cap * 3;
  const dist = new Int32Array(n * n).fill(big);
  for (let i = 0; i < dist.length; i++) if (src[i]) dist[i] = 0;
  // Two laps of each pass carry distances round the torus.
  for (let lap = 0; lap < 2; lap++) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      dist[i] = Math.min(dist[i], dist[wrapIndex(x - 1, y, n)] + 3, dist[wrapIndex(x, y - 1, n)] + 3, dist[wrapIndex(x - 1, y - 1, n)] + 4, dist[wrapIndex(x + 1, y - 1, n)] + 4);
    }
    for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      dist[i] = Math.min(dist[i], dist[wrapIndex(x + 1, y, n)] + 3, dist[wrapIndex(x, y + 1, n)] + 3, dist[wrapIndex(x + 1, y + 1, n)] + 4, dist[wrapIndex(x - 1, y + 1, n)] + 4);
    }
  }
  const out = new Float32Array(n * n);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(cap, dist[i] / 3);
  return out;
}

/**
 * STAND-IN for S6's bathymetry: the sea bed shelves away from the shore.
 * Land keeps the generator's ground. (S3 drowning is left to the generator:
 * rivers already end at this coast.)
 */
export function standinSeaBed(g: ArrayLike<number>, isSea: Uint8Array, gN: number): Float32Array {
  const land = new Uint8Array(gN * gN);
  for (let i = 0; i < land.length; i++) if (!isSea[i]) land[i] = 1;
  const off = chamfer(land, gN, 60);
  const out = new Float32Array(gN * gN);
  for (let i = 0; i < out.length; i++) out[i] = land[i] ? Math.max(g[i], 0.01) : -Math.min(24, 0.3 + 0.48 * (off[i] - 0.5));
  return out;
}

/**
 * STAND-IN for S6's shore classes. Beaches are the minority: only sheltered,
 * low shores. Everything else is rocky, or a cliff under high ground.
 */
export function standinShore(ground: Float32Array, waterKind: Uint8Array, exposure: Float32Array, gN: number): Uint8Array {
  const shore = new Uint8Array(gN * gN), cN = gN / 2;
  for (let y = 0; y < gN; y++) for (let x = 0; x < gN; x++) {
    const i = y * gN + x;
    if (waterKind[i] !== 0) continue;
    let nearSea = false, high = ground[i];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const j = wrapIndex(x + dx, y + dy, gN);
      if (waterKind[j] === 1) nearSea = true;
      else if (ground[j] > high) high = ground[j];
    }
    if (!nearSea) continue;
    const e = exposure[(y >> 1) * cN + (x >> 1)];
    shore[i] = high > 14 ? 3 : e < 0.3 && high < 4 ? 1 : 2;
  }
  return shore;
}

/** STAND-IN for S6's coastal exposure on C: noise. */
export function standinExposure(cN: number, seed: number): Float32Array {
  const exposure = new Float32Array(cN * cN);
  for (let y = 0; y < cN; y++) for (let x = 0; x < cN; x++) {
    const v = 0.5 + 0.7 * fbm((x * 4) / cN, (y * 4) / cN, 4, 2, 0.5, seed ^ 0x3333);
    exposure[y * cN + x] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return exposure;
}
