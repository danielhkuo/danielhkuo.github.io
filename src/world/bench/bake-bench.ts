// The bake bench: one 256 × 256 pixel chunk, doing the real per-cell workload
// of the design's section 5.5 so its timing can gate the architecture.

import type { BenchField } from "./field.ts";

export const TILE = 256;
export const CHUNK = 256;

/** Material ids written to the low byte of each bake pixel. */
export const MAT = {
  water: 1, sand: 2, snow: 3, rock: 4, scree: 5, alpine: 6, heath: 7, forest: 8, conifer: 9,
  farmland: 10, marsh: 11, meadow: 12, scrub: 13, cliff: 14,
} as const;

export interface BenchStats {
  tilesBuilt: number;
  cellsUpsampled: number;
  coverEvals: number;
  crownsStamped: number;
  lambertEvals: number;
  shadowCells: number;
  pixelsPainted: number;
  inkTests: number;
}

export interface BenchChunk {
  /** 65536 bake pixels: material | (tone | shadow << 4 | ink << 6) << 8 | depth << 16. */
  pixels: Uint32Array;
  stats: BenchStats;
}

/** Cell tiles are cached under `ty * 4096 + tx`. */
export type TileCache = Map<number, unknown>;

interface Tile {
  surface: Float32Array;
  material: Uint8Array;
  light: Uint8Array;
  shadow: Uint8Array;
  slope: Float32Array;
  canopy: Uint8Array;
}

const APRON = 64;
const HALO = 11;
const PAD_N = APRON + HALO;
const PAD_W = APRON + HALO;
const PAD_S = HALO;
const PAD_E = HALO;
const SURF_W = TILE + PAD_W + PAD_E;
const SURF_H = TILE + PAD_N + PAD_S;

const LX = -0.32102;
const LY = -0.32102;
const LZ = 0.89101;
const TWO_SQRT2 = 2 * Math.SQRT2;

const RULE_OX = [13, 29, 47, 67, 89, 107, 139, 157, 181, 197];
const RULE_OY = [7, 43, 61, 83, 101, 127, 149, 173, 191, 211];
const SCATTER_OX = 233;
const SCATTER_OY = 71;

function wrap(i: number, n: number): number {
  const m = i % n;
  return m < 0 ? m + n : m;
}

function bsplineWeights(f: number): [number, number, number, number] {
  const f2 = f * f;
  const f3 = f2 * f;
  return [
    (1 - 3 * f + 3 * f2 - f3) / 6,
    (4 - 6 * f2 + 3 * f3) / 6,
    (1 + 3 * f + 3 * f2 - 3 * f3) / 6,
    f3 / 6,
  ];
}

/** Periodic separable cubic B-spline. Fine cell i sits at node coordinate (i + 0.5) / 4 − 0.5. */
function upsample(
  src: Float32Array,
  gN: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  out: Float32Array,
): void {
  const v0 = (y0 + 0.5) / 4 - 0.5;
  const v1 = (y0 + h - 1 + 0.5) / 4 - 0.5;
  const gyMin = Math.floor(v0) - 1;
  const gyMax = Math.floor(v1) + 2;
  const gyCount = gyMax - gyMin + 1;
  const tmp = new Float32Array(gyCount * w);

  for (let gy = gyMin; gy <= gyMax; gy++) {
    const srcRow = wrap(gy, gN) * gN;
    const dstRow = (gy - gyMin) * w;
    for (let x = 0; x < w; x++) {
      const u = (x0 + x + 0.5) / 4 - 0.5;
      const k = Math.floor(u);
      const f = u - k;
      const [w0, w1, w2, w3] = bsplineWeights(f);
      const i0 = wrap(k - 1, gN);
      const i1 = wrap(k, gN);
      const i2 = wrap(k + 1, gN);
      const i3 = wrap(k + 2, gN);
      tmp[dstRow + x] = w0 * src[srcRow + i0] + w1 * src[srcRow + i1] + w2 * src[srcRow + i2] + w3 * src[srcRow + i3];
    }
  }

  for (let y = 0; y < h; y++) {
    const v = (y0 + y + 0.5) / 4 - 0.5;
    const k = Math.floor(v);
    const f = v - k;
    const [w0, w1, w2, w3] = bsplineWeights(f);
    const r0 = (k - 1 - gyMin) * w;
    const r1 = (k - gyMin) * w;
    const r2 = (k + 1 - gyMin) * w;
    const r3 = (k + 2 - gyMin) * w;
    const dst = y * w;
    for (let x = 0; x < w; x++) {
      out[dst + x] = w0 * tmp[r0 + x] + w1 * tmp[r1 + x] + w2 * tmp[r2 + x] + w3 * tmp[r3 + x];
    }
  }
}

function bilinear(data: Uint8Array, base: number, n: number, u: number, v: number): number {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const row0 = base + wrap(y0, n) * n;
  const row1 = base + wrap(y1, n) * n;
  const v00 = data[row0 + wrap(x0, n)];
  const v10 = data[row0 + wrap(x1, n)];
  const v01 = data[row1 + wrap(x0, n)];
  const v11 = data[row1 + wrap(x1, n)];
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}

function jitter(mask: Uint8Array, x: number, y: number, rule: number, edge: number): number {
  const b = mask[((y + RULE_OY[rule]) & 255) * 256 + ((x + RULE_OX[rule]) & 255)];
  return (b / 255 - 0.5) * edge;
}

function coverMaterial(
  mask: Uint8Array,
  x: number,
  y: number,
  e: number,
  s: number,
  northness: number,
  hand: number,
  moisture: number,
  wind: number,
  coast: number,
  debris: number,
  rock: number,
  region: number,
): number {
  if (e <= 0) return MAT.water;
  const cold = e / 100 + 0.1 * northness;
  const M = moisture / 255;
  const X = wind / 255;
  const E = coast / 255;
  const D = debris / 255;

  {
    const j = jitter(mask, x, y, 0, 0.3);
    if (e < 1.5 + j && E < 0.35 + j && s < 0.15 + j) return MAT.sand;
  }
  {
    const j = jitter(mask, x, y, 1, 0.04);
    if (cold > 0.82 + j && s < 1.1 + j) return MAT.snow;
  }
  {
    const j = jitter(mask, x, y, 2, 0.2);
    if (s > 1.7 + j || (s > 0.9 + j && rock === 0)) return MAT.rock;
  }
  {
    const j = jitter(mask, x, y, 3, 0.1);
    if (D > 0.75 + j && s >= 0.45 + j && s < 1.2 + j) return MAT.scree;
  }
  {
    const j = jitter(mask, x, y, 4, 0.05);
    if ((region === 1 || region === 3) && cold > 0.55 + j && s < 0.5 + j) return MAT.alpine;
  }
  {
    const j = jitter(mask, x, y, 5, 0.08);
    if (X > 0.55 + j || (hand > 30 + j && region === 2)) return MAT.heath;
  }
  {
    const j = jitter(mask, x, y, 6, 0.06);
    if (
      hand > 2 + j && hand < 30 + j &&
      s > 0.08 + j && s < 0.8 + j &&
      M > 0.4 + j && X < 0.5 + j && cold < 0.6 + j
    ) {
      return cold > 0.45 + j ? MAT.conifer : MAT.forest;
    }
  }
  {
    const j = jitter(mask, x, y, 7, 0.04);
    if (s < 0.14 + j && hand < 25 + j && region === 0) return MAT.farmland;
  }
  {
    const j = jitter(mask, x, y, 8, 0);
    if (hand < 1 + j && s < 0.02 + j) return MAT.marsh;
  }
  {
    const j = jitter(mask, x, y, 9, 0.05);
    if (M < 0.3 + j) return MAT.scrub;
  }
  return MAT.meadow;
}

function cellHash(x: number, y: number): number {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ Math.imul(y, 0xc2b2ae35), 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

function boxBlur(src: Float32Array, w: number, h: number, dst: Float32Array): void {
  const radius = 8;
  const tmp = new Float32Array(w * h);
  const prefix = new Float32Array(Math.max(w, h) + 1);
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    prefix[0] = 0;
    for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + src[row + x];
    for (let x = 0; x < w; x++) {
      const a = x - radius;
      const b = x + radius;
      if (a >= 0 && b < w) tmp[row + x] = (prefix[b + 1] - prefix[a]) / win;
      else {
        const lo = a < 0 ? 0 : a;
        const hi = b >= w ? w - 1 : b;
        tmp[row + x] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
      }
    }
  }
  for (let x = 0; x < w; x++) {
    prefix[0] = 0;
    for (let y = 0; y < h; y++) prefix[y + 1] = prefix[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const a = y - radius;
      const b = y + radius;
      const i = y * w + x;
      if (a >= 0 && b < h) dst[i] = (prefix[b + 1] - prefix[a]) / win;
      else {
        const lo = a < 0 ? 0 : a;
        const hi = b >= h ? h - 1 : b;
        dst[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
      }
    }
  }
}

function buildTile(field: BenchField, tx: number, ty: number, mask: Uint8Array, stats: BenchStats): Tile {
  const gN = field.gN;
  const cN = field.cN;
  const cCount = cN * cN;
  const originX = tx * TILE;
  const originY = ty * TILE;
  const heightW = SURF_W + 2;
  const heightH = SURF_H + 2;
  const hx0 = originX - PAD_W - 1;
  const hy0 = originY - PAD_N - 1;
  const fine = new Float32Array(heightW * heightH);
  upsample(field.heights, gN, hx0, hy0, heightW, heightH, fine);
  stats.cellsUpsampled += heightW * heightH;

  const count = SURF_W * SURF_H;
  const ground = new Float32Array(count);
  const slope = new Float32Array(count);
  const material = new Uint8Array(count);
  const fields = field.fields;

  for (let sy = 0; sy < SURF_H; sy++) {
    const wy = originY - PAD_N + sy;
    const iy = sy + 1;
    for (let sx = 0; sx < SURF_W; sx++) {
      const wx = originX - PAD_W + sx;
      const ix = sx + 1;
      const i = sy * SURF_W + sx;
      const h = fine[iy * heightW + ix];
      const dx = (fine[iy * heightW + ix + 1] - fine[iy * heightW + ix - 1]) * 0.5;
      const dy = (fine[(iy + 1) * heightW + ix] - fine[(iy - 1) * heightW + ix]) * 0.5;
      const s = Math.sqrt(dx * dx + dy * dy);
      const northness = dy / Math.max(s, 1e-6);
      ground[i] = h;
      slope[i] = s;

      const gu = (wx + 0.5) / 4 - 0.5;
      const gv = (wy + 0.5) / 4 - 0.5;
      const hand = bilinear(field.hand, 0, gN, gu, gv);
      const cu = (wx + 0.5) / 8 - 0.5;
      const cv = (wy + 0.5) / 8 - 0.5;
      const moisture = bilinear(fields, 0, cN, cu, cv);
      const wind = bilinear(fields, cCount, cN, cu, cv);
      const coast = bilinear(fields, 2 * cCount, cN, cu, cv);
      const debris = bilinear(fields, 3 * cCount, cN, cu, cv);
      const rock = bilinear(fields, 4 * cCount, cN, cu, cv);
      const region = bilinear(fields, 5 * cCount, cN, cu, cv);
      material[i] = coverMaterial(mask, wx, wy, h, s, northness, hand, moisture, wind, coast, debris, rock, region);
      stats.coverEvals++;
    }
  }

  const canopy = new Float32Array(count);
  canopy.fill(Number.NEGATIVE_INFINITY);
  const canopyMat = new Uint8Array(count);
  for (let sy = 0; sy < SURF_H; sy++) {
    const wy = originY - PAD_N + sy;
    for (let sx = 0; sx < SURF_W; sx++) {
      const i = sy * SURF_W + sx;
      const mat = material[i];
      let limit = 0;
      let crownMat = 0;
      let broad = false;
      if (mat === MAT.forest) {
        limit = 0.2 * 256;
        crownMat = MAT.forest;
        broad = true;
      } else if (mat === MAT.conifer) {
        limit = 0.22 * 256;
        crownMat = MAT.conifer;
      } else if (mat === MAT.meadow) {
        limit = 0.02 * 256;
        crownMat = MAT.forest;
        broad = true;
      } else {
        continue;
      }
      const wx = originX - PAD_W + sx;
      const byte = mask[((wy + SCATTER_OY) & 255) * 256 + ((wx + SCATTER_OX) & 255)];
      if (byte >= limit) continue;
      const r = 1.5 + 0.5 * (cellHash(wx, wy) & 3);
      const r2 = r * r;
      const crownH = broad ? 0.6 * 2 * r + 1.5 : 1.5 * 2 * r;
      const base = ground[i];
      const rad = Math.floor(r);
      for (let oy = -rad; oy <= rad; oy++) {
        const tyy = sy + oy;
        if (tyy < 0 || tyy >= SURF_H) continue;
        for (let ox = -rad; ox <= rad; ox++) {
          const d2 = ox * ox + oy * oy;
          if (d2 > r2) continue;
          const txx = sx + ox;
          if (txx < 0 || txx >= SURF_W) continue;
          const ti = tyy * SURF_W + txx;
          const height = base + crownH * (1 - d2 / r2);
          if (height > canopy[ti]) {
            canopy[ti] = height;
            canopyMat[ti] = crownMat;
          }
        }
      }
      stats.crownsStamped++;
    }
  }

  const surface = new Float32Array(count);
  const canopyFlag = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (canopy[i] > ground[i]) {
      surface[i] = canopy[i];
      material[i] = canopyMat[i];
      canopyFlag[i] = 1;
    } else {
      surface[i] = ground[i];
    }
  }

  const blurred = new Float32Array(count);
  boxBlur(surface, SURF_W, SURF_H, blurred);

  const light = new Uint8Array(count);
  for (let y = 0; y < SURF_H; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y + 1 < SURF_H ? y + 1 : SURF_H - 1;
    for (let x = 0; x < SURF_W; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x + 1 < SURF_W ? x + 1 : SURF_W - 1;
      const i = y * SURF_W + x;
      const dhdx = (surface[y * SURF_W + xp] - surface[y * SURF_W + xm]) * 0.5;
      const dhdy = (surface[yp * SURF_W + x] - surface[ym * SURF_W + x]) * 0.5;
      const inv = 1 / Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1);
      const ndotl = (-dhdx * LX - dhdy * LY + LZ) * inv;
      const relief = surface[i] - blurred[i];
      let lit = 0.6 * Math.max(0, ndotl) + 0.4 * (0.5 + 0.05 * relief);
      if (lit < 0) lit = 0;
      else if (lit > 1) lit = 1;
      lit = 0.5 + (lit - 0.5) * (1 + ground[i] / 260);
      if (lit < 0) lit = 0;
      else if (lit > 1) lit = 1;
      let byte = Math.round(lit * 255);
      if (byte < 0) byte = 0;
      else if (byte > 255) byte = 255;
      light[i] = byte;
      stats.lambertEvals++;
    }
  }

  const shadow = new Uint8Array(count);
  const running = new Float64Array(SURF_W + SURF_H);
  running.fill(Number.NEGATIVE_INFINITY);
  for (let y = 0; y < SURF_H; y++) {
    for (let x = 0; x < SURF_W; x++) {
      const d = x - y + (SURF_H - 1);
      const i = y * SURF_W + x;
      let m = running[d];
      if (x > 0 && y > 0) m = Math.max(m - TWO_SQRT2, surface[(y - 1) * SURF_W + (x - 1)]);
      const drop = m - surface[i];
      if (drop > 0) shadow[i] = drop < 4 ? 1 : drop < 12 ? 2 : 3;
      running[d] = m;
      stats.shadowCells++;
    }
  }

  const tile: Tile = {
    surface: new Float32Array(TILE * TILE),
    material: new Uint8Array(TILE * TILE),
    light: new Uint8Array(TILE * TILE),
    shadow: new Uint8Array(TILE * TILE),
    slope: new Float32Array(TILE * TILE),
    canopy: new Uint8Array(TILE * TILE),
  };
  for (let y = 0; y < TILE; y++) {
    const srcRow = (y + PAD_N) * SURF_W + PAD_W;
    const dstRow = y * TILE;
    for (let x = 0; x < TILE; x++) {
      const s = srcRow + x;
      const d = dstRow + x;
      tile.surface[d] = surface[s];
      tile.material[d] = material[s];
      tile.light[d] = light[s];
      tile.shadow[d] = shadow[s];
      tile.slope[d] = slope[s];
      tile.canopy[d] = canopyFlag[s];
    }
  }
  return tile;
}

function takeTile(
  field: BenchField,
  tx: number,
  ty: number,
  cache: TileCache | null,
  mask: Uint8Array,
  stats: BenchStats,
  local: Map<number, Tile>,
): Tile {
  const nT = field.nCells / TILE;
  const key = wrap(ty, nT) * 4096 + wrap(tx, nT);
  const seen = local.get(key);
  if (seen) return seen;
  if (cache) {
    const hit = cache.get(key) as Tile | undefined;
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      local.set(key, hit);
      return hit;
    }
  }
  const tile = buildTile(field, wrap(tx, nT), wrap(ty, nT), mask, stats);
  stats.tilesBuilt++;
  local.set(key, tile);
  if (cache) {
    cache.set(key, tile);
    if (cache.size > 24) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return tile;
}

export function bakeBenchChunk(
  field: BenchField,
  cx: number,
  cy: number,
  cache: TileCache | null,
  mask: Uint8Array,
): BenchChunk {
  const stats: BenchStats = {
    tilesBuilt: 0,
    cellsUpsampled: 0,
    coverEvals: 0,
    crownsStamped: 0,
    lambertEvals: 0,
    shadowCells: 0,
    pixelsPainted: 0,
    inkTests: 0,
  };
  const local = new Map<number, Tile>();
  const nCells = field.nCells;
  const x0 = cx * CHUNK;
  const y0 = cy * 320;
  const r0 = cy * CHUNK;
  const yLast = y0 + 519;
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(yLast / TILE); ty++) {
    takeTile(field, cx, ty, cache, mask, stats, local);
  }

  const pixels = new Uint32Array(CHUNK * CHUNK);
  const pixMat = new Uint8Array(CHUNK * CHUNK);
  const pixLight = new Uint8Array(CHUNK * CHUNK);
  const pixShadow = new Uint8Array(CHUNK * CHUNK);
  const pixDepth = new Uint16Array(CHUNK * CHUNK);
  const pixY = new Int32Array(CHUNK * CHUNK);
  const pixH = new Float32Array(CHUNK * CHUNK);
  const pixCanopy = new Uint8Array(CHUNK * CHUNK);

  for (let col = 0; col < CHUNK; col++) {
    const x = x0 + col;
    let top = CHUNK;
    for (let y = yLast; y >= y0 && top > 0; y--) {
      const wx = wrap(x, nCells);
      const wy = wrap(y, nCells);
      const tile = takeTile(field, Math.floor(wx / TILE), Math.floor(wy / TILE), cache, mask, stats, local);
      const ti = (wy - Math.floor(wy / TILE) * TILE) * TILE + (wx - Math.floor(wx / TILE) * TILE);
      const mat = tile.material[ti];
      const drawH = mat === MAT.water ? 0 : tile.surface[ti];
      const t = Math.floor((4 * y) / 5) - r0 - Math.round(drawH);
      if (t < top) {
        const rowStart = t > 0 ? t : 0;
        for (let row = rowStart; row < top; row++) {
          const pi = row * CHUNK + col;
          const wall = row !== t;
          pixMat[pi] = wall && tile.slope[ti] >= 2 ? MAT.cliff : mat;
          pixLight[pi] = tile.light[ti];
          pixShadow[pi] = tile.shadow[ti];
          pixDepth[pi] = (y - y0) * 8;
          pixY[pi] = y;
          pixH[pi] = drawH;
          pixCanopy[pi] = tile.canopy[ti];
          stats.pixelsPainted++;
        }
        top = rowStart;
      }
    }
  }

  const ink = new Uint8Array(CHUNK * CHUNK);
  for (let col = 0; col < CHUNK; col++) {
    for (let row = 1; row < CHUNK; row++) {
      stats.inkTests++;
      const near = row * CHUNK + col;
      const far = near - CHUNK;
      if (pixMat[near] === MAT.water) continue;
      if (pixCanopy[near] && pixCanopy[far]) continue;
      const hidden = pixY[near] - pixY[far] - 1;
      const drop = pixH[near] - pixH[far];
      if (hidden >= 3 && drop >= 3) ink[near] = hidden >= 10 ? 2 : 1;
    }
  }

  for (let row = 0; row < CHUNK; row++) {
    for (let col = 0; col < CHUNK; col++) {
      const pi = row * CHUNK + col;
      if (ink[pi] === 0 && pixMat[pi] === MAT.cliff) {
        const mv = mask[((r0 + row) & 255) * 256 + ((x0 + col) & 255)];
        if (mv < 64 && ((col + row) & 3) === 0) ink[pi] = 1;
      }
      const mv = mask[((r0 + row) & 255) * 256 + ((x0 + col) & 255)];
      let tone = Math.floor(pixLight[pi] / 16 + mv / 256 - 0.5);
      if (tone < 0) tone = 0;
      else if (tone > 15) tone = 15;
      const toneByte = tone | (pixShadow[pi] << 4) | (ink[pi] << 6);
      pixels[pi] = (pixMat[pi] | (toneByte << 8) | (pixDepth[pi] << 16)) >>> 0;
    }
  }

  return { pixels, stats };
}
