// STAND-INS for generator stages that are not built yet. Everything in this
// file is throwaway: it exists so the bake has believable land to draw until
// gen/erode.ts, gen/hydro.ts, gen/coast.ts and gen/climate.ts land, and each
// function is replaced by passing the real stage's output to buildBakeWorld.

import { fbm } from "../core/noise.ts";
import { NB8_DX, NB8_DY, wrapIndex } from "../core/torus.ts";
import { accumulate, priorityFlood, receivers } from "../gen/flood.ts";
import type { ClimateInput, HydroInput } from "./world.ts";

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

/**
 * STAND-IN for S7: lakes where the flood stands ≥ 1.5 deep over ≥ 8 nodes,
 * channels from drainage area, HAND. Fills the smaller pits in `ground`.
 */
export function standinHydro(ground: Float32Array, gN: number, n: number): HydroInput {
  const nn = gN * gN;
  const h = new Float64Array(nn);
  const waterKind = new Uint8Array(nn);
  const isSea = new Uint8Array(nn);
  for (let i = 0; i < nn; i++) {
    h[i] = ground[i];
    if (ground[i] <= 0) { isSea[i] = 1; waterKind[i] = 1; }
  }
  const eps = 1e-4;
  const { filled, order } = priorityFlood(h, gN, isSea, eps);

  // Lakes: connected pieces of deep standing water.
  const waterLevel = new Float32Array(nn);
  const seen = new Uint8Array(nn);
  const stack = new Int32Array(nn);
  const piece: number[] = [];
  for (let s = 0; s < nn; s++) {
    if (seen[s] || isSea[s] || filled[s] - h[s] < 1.5) continue;
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    piece.length = 0;
    let level = Infinity;
    while (sp > 0) {
      const i = stack[--sp];
      piece.push(i);
      if (filled[i] < level) level = filled[i];
      const x = i % gN, y = (i - x) / gN;
      for (let q = 0; q < 8; q++) {
        const j = wrapIndex(x + NB8_DX[q], y + NB8_DY[q], gN);
        if (seen[j] || isSea[j] || filled[j] - h[j] < 0.3) continue;
        seen[j] = 1;
        stack[sp++] = j;
      }
    }
    if (piece.length < 8) continue;
    for (const i of piece) { waterKind[i] = 2; waterLevel[i] = level; }
  }
  for (let i = 0; i < nn; i++) if (waterKind[i] === 0 && filled[i] > ground[i]) ground[i] = filled[i];

  const { rcv } = receivers(filled, gN, isSea, null);
  const area = accumulate(order, rcv, isSea, null);
  const riverWidth = new Uint8Array(nn);
  const riverTo = new Uint8Array(nn).fill(255);
  const riverRun = new Float32Array(nn);
  const hand = new Float32Array(nn);
  const drain = new Float64Array(nn);
  const boost = 6400 / n;
  for (let q = 0; q < order.length; q++) {
    const i = order[q];
    if (waterKind[i] !== 0) { drain[i] = waterKind[i] === 2 ? waterLevel[i] : 0; continue; }
    const r = rcv[i];
    if (area[i] >= 64) {
      const w = Math.round(Math.sqrt((area[i] * boost) / 1000));
      riverWidth[i] = w < 1 ? 1 : w > 6 ? 6 : w;
      const x = i % gN, y = (i - x) / gN;
      for (let d = 0; d < 8; d++) {
        if (wrapIndex(x + NB8_DX[d], y + NB8_DY[d], gN) === r) { riverTo[i] = d; break; }
      }
      const step = riverTo[i] & 1 ? 4 * Math.SQRT2 : 4;
      riverRun[i] = riverRun[r] + step;
      drain[i] = filled[i];
    } else {
      drain[i] = drain[r];
    }
    hand[i] = Math.max(0, filled[i] - drain[i]);
  }
  return { waterLevel, waterKind, riverWidth, riverTo, riverRun, hand };
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
