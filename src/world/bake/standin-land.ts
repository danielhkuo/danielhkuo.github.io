// STAND-INS for generator stages that are not built yet. Everything in this
// file is throwaway: it exists so the bake has believable land to draw until
// gen/drown.ts, gen/coast.ts and gen/climate.ts land, and each
// function is replaced by passing the real stage's output to buildBakeWorld.

import { fbm } from "../core/noise.ts";
import { wrapIndex } from "../core/torus.ts";
import type { ClimateInput } from "./world.ts";

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
 * STAND-IN for S3 and S6: drowns eroded heights on G by 3 units and shelves
 * the sea bed away from the shore. Returns ground heights on G.
 */
export function standinDrown(g: ArrayLike<number>, gN: number): Float32Array {
  const land = new Uint8Array(gN * gN);
  for (let i = 0; i < land.length; i++) if (g[i] - 3 > 0) land[i] = 1;
  const off = chamfer(land, gN, 60);
  const out = new Float32Array(gN * gN);
  for (let i = 0; i < out.length; i++) out[i] = land[i] ? g[i] - 3 : -Math.min(24, 0.3 + 0.48 * (off[i] - 0.5));
  return out;
}

/** STAND-IN for S6's shore classes: by the relief standing within two nodes of the sea. */
export function standinShore(ground: Float32Array, waterKind: Uint8Array, gN: number): Uint8Array {
  const shore = new Uint8Array(gN * gN);
  for (let y = 0; y < gN; y++) for (let x = 0; x < gN; x++) {
    const i = y * gN + x;
    if (waterKind[i] !== 0) continue;
    let nearSea = false, high = ground[i];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const j = wrapIndex(x + dx, y + dy, gN);
      if (waterKind[j] === 1) nearSea = true;
      else if (ground[j] > high) high = ground[j];
    }
    if (nearSea) shore[i] = high > 14 ? 3 : high > 6 ? 2 : 1;
  }
  return shore;
}

/** STAND-IN for S8's fields: noise, with wetter valley floors and windier heights. */
export function standinClimate(ground: Float32Array, hand: Float32Array, gN: number, cN: number, seed: number): ClimateInput {
  const moisture = new Float32Array(cN * cN), wind = new Float32Array(cN * cN);
  const exposure = new Float32Array(cN * cN), debris = new Float32Array(cN * cN);
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  for (let y = 0; y < cN; y++) for (let x = 0; x < cN; x++) {
    const i = y * cN + x;
    const g = wrapIndex(2 * x, 2 * y, gN);
    const e = Math.max(0, ground[g]);
    const a = fbm((x * 6) / cN, (y * 6) / cN, 6, 3, 0.5, seed ^ 0x1111);
    const b = fbm((x * 5) / cN, (y * 5) / cN, 5, 3, 0.5, seed ^ 0x2222);
    const c = fbm((x * 4) / cN, (y * 4) / cN, 4, 2, 0.5, seed ^ 0x3333);
    moisture[i] = clamp01(0.55 + 0.45 * a - hand[g] / 120 + (hand[g] < 6 ? 0.1 : 0));
    wind[i] = clamp01(0.2 + e / 140 + 0.35 * b);
    exposure[i] = clamp01(0.5 + 0.7 * c);
    debris[i] = 0;
  }
  return { moisture, wind, exposure, debris };
}
