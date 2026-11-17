// Cover preview: a top-down map, one pixel per cell, of cover + scatter through
// the palette. The land under it is a stand-in built from the plan (S1): height
// from uplift with noise-carved valleys, HAND from a blurred running minimum,
// moisture and wind from noise. The real generator stages replace `standIn`;
// everything after it is the look itself.

import { gradNoise } from "../core/noise.ts";
import { cover } from "../cover.ts";
import type { Plan } from "../gen/plan.ts";
import {
  LIGHT_INK_SHIFT, LIGHT_SHADOW_SHIFT, type CoverInput, type PaletteOptions,
} from "../look/contract.ts";
import { isCanopy, isWater, MATERIAL as M } from "../look/materials.ts";
import { buildPalette, FLAT_TONE } from "../render/palette.ts";
import { scatterAt, type RiverDist } from "../scatter.ts";

export interface Window {
  /** World size in cells. */
  n: number;
  /** Top-left cell and size of the view. */
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** The generator's outputs over a window plus its apron, row-major, `w` × `h`. */
export interface Fields {
  w: number;
  h: number;
  /** World cell of the array's first element. */
  x0: number;
  y0: number;
  e: Float32Array;
  slope: Float32Array;
  northness: Float32Array;
  hand: Float32Array;
  moisture: Float32Array;
  wind: Float32Array;
  exposure: Float32Array;
  debris: Float32Array;
  rock: Uint8Array;
  /** Six planes. */
  region: Float32Array;
  water: Uint8Array;
  shore: Uint8Array;
  /** Cells to the nearest land, capped; for sea and lake tone. */
  shoreDist: Float32Array;
}

/** Cells of margin round the view: blurs, shadows and crowns reach in from outside. */
export const APRON = 96;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function wrap(i: number, n: number): number {
  const m = i % n;
  return m < 0 ? m + n : m;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const acc = new Float64Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) acc[x + 1] = acc[x] + src[y * w + x];
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - r);
      const b = Math.min(w - 1, x + r);
      tmp[y * w + x] = (acc[b + 1] - acc[a]) / (b - a + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) acc[y + 1] = acc[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r);
      const b = Math.min(h - 1, y + r);
      out[y * w + x] = (acc[b + 1] - acc[a]) / (b - a + 1);
    }
  }
  return out;
}

function minFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.min(m, src[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = Infinity;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.min(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Two-pass chamfer distance (1, √2) to the nearest cell where `seed` is set, capped. */
function distanceTo(seed: Uint8Array, w: number, h: number, cap: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = seed[i] ? 0 : cap;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
      }
      d[i] = v;
    }
  }
  return d;
}

function bilinearPlan(a: ArrayLike<number>, base: number, cN: number, u: number, v: number): number {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const r0 = base + wrap(y0, cN) * cN;
  const r1 = base + wrap(y0 + 1, cN) * cN;
  const xa = wrap(x0, cN);
  const xb = wrap(x0 + 1, cN);
  const p = a[r0 + xa] + (a[r0 + xb] - a[r0 + xa]) * fx;
  const q = a[r1 + xa] + (a[r1 + xb] - a[r1 + xa]) * fx;
  return p + (q - p) * fy;
}

/** Stand-in generator fields for a window, from the plan alone. */
export function standIn(plan: Plan, win: Window, seed: number): Fields {
  const n = win.n;
  const cN = plan.n;
  const cell = n / cN;
  const nodes = cN * cN;
  const w = win.w + 2 * APRON;
  const h = win.h + 2 * APRON;
  const x0 = win.x0 - APRON;
  const y0 = win.y0 - APRON;
  const count = w * h;
  const period = (cells: number): number => Math.max(1, Math.round(n / cells));
  const noise = (x: number, y: number, cells: number, s: number): number => {
    const p = period(cells);
    return gradNoise((x * p) / n, (y * p) / n, p, seed + s);
  };

  const region = new Float32Array(6 * count);
  const rock = new Uint8Array(count);
  const water = new Uint8Array(count);
  let e: Float32Array = new Float32Array(count);
  const trunk = new Float32Array(count);
  const side = new Float32Array(count);
  const top = new Float32Array(count);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const wx = x0 + x + 0.5;
      const wy = y0 + y + 0.5;
      const u = wx / cell - 0.5;
      const v = wy / cell - 0.5;
      const uplift = bilinearPlan(plan.uplift, 0, cN, u, v) * 1000;
      for (let a = 0; a < 6; a++) region[a * count + i] = bilinearPlan(plan.regions, a * nodes, cN, u, v);
      rock[i] = plan.rock[wrap(Math.round(v), cN) * cN + wrap(Math.round(u), cN)];

      // Valleys: the zero lines of two warped noises are carved down to a flat
      // floor; between them the land rises by steep sides to rounded tops.
      const warpX = 50 * noise(wx, wy, 260, 11);
      const warpY = 50 * noise(wx, wy, 260, 12);
      trunk[i] = noise(wx + warpX, wy + warpY, 560, 1);
      side[i] = noise(wx - warpY, wy + warpX, 190, 2);
      const tv = smooth((Math.abs(trunk[i]) - 0.02) / 0.36);
      const sv = smooth((Math.abs(side[i]) - 0.02) / 0.3);
      top[i] = tv * (0.7 + 0.3 * sv);
      const rough = noise(wx, wy, 60, 3) * 0.6 + noise(wx, wy, 23, 4) * 0.3 + noise(wx, wy, 9, 5) * 0.12;
      e[i] = uplift * (0.3 + 0.7 * top[i]) + rough * (0.6 + uplift * 0.05) * (0.3 + 0.7 * top[i]) - 1.5;
    }
  }
  e = boxBlur(e, w, h, 1);

  // Water: sea below zero, rivers of even width along the valley lines,
  // ribbon lakes in lake country.
  const lineDist = (a: Float32Array, i: number, x: number, y: number): number => {
    const gx = (a[y * w + Math.min(w - 1, x + 1)] - a[y * w + Math.max(0, x - 1)]) * 0.5;
    const gy = (a[Math.min(h - 1, y + 1) * w + x] - a[Math.max(0, y - 1) * w + x]) * 0.5;
    return Math.abs(a[i]) / Math.max(1e-6, Math.sqrt(gx * gx + gy * gy));
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const wx = x0 + x + 0.5;
      const wy = y0 + y + 0.5;
      if (e[i] <= 0) {
        water[i] = 1;
        continue;
      }
      const lakes = region[3 * count + i];
      if (lakes > 0.5 && Math.abs(trunk[i]) < 0.05 && noise(wx, wy, 380, 6) > 0.12 && e[i] < 60) {
        water[i] = 2;
        continue;
      }
      if (e[i] < 0.5) continue;
      if (lineDist(trunk, i, x, y) < 1 + 1.6 * clamp01(1 - e[i] / 25) && e[i] < 70) water[i] = 3;
      else if (lineDist(side, i, x, y) < 0.8 && e[i] < 45 && Math.abs(trunk[i]) < 0.3) water[i] = 3;
    }
  }

  const slope = new Float32Array(count);
  const northness = new Float32Array(count);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      const dx = (e[y * w + xp] - e[y * w + xm]) / (xp - xm);
      const dy = (e[yp * w + x] - e[ym * w + x]) / (yp - ym);
      const s = Math.sqrt(dx * dx + dy * dy);
      slope[y * w + x] = s;
      northness[y * w + x] = dy / Math.max(s, 1e-6);
    }
  }

  // HAND: height above a blurred running minimum, zero on water.
  const land = new Float32Array(count);
  const floor = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    land[i] = water[i] === 1 ? 0 : 1;
    floor[i] = Math.max(0, e[i]);
  }
  const low = boxBlur(minFilter(floor, w, h, 56), w, h, 20);
  const landBlur = boxBlur(land, w, h, 22);
  const relief = boxBlur(e, w, h, 32);
  const steep = new Float32Array(count);
  for (let i = 0; i < count; i++) steep[i] = clamp01((slope[i] - 0.5) * 3);
  const debrisBlur = boxBlur(steep, w, h, 5);

  const hand = new Float32Array(count);
  const moisture = new Float32Array(count);
  const wind = new Float32Array(count);
  const exposure = new Float32Array(count);
  const debris = new Float32Array(count);
  const shore = new Uint8Array(count);
  const seaMask = new Uint8Array(count);
  const landMask = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    seaMask[i] = water[i] === 1 ? 1 : 0;
    landMask[i] = water[i] === 0 || water[i] === 3 ? 1 : 0;
  }
  const toSea = distanceTo(seaMask, w, h, 64);
  const shoreDist = distanceTo(landMask, w, h, 64);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const wx = x0 + x + 0.5;
      const wy = y0 + y + 0.5;
      hand[i] = water[i] !== 0 ? 0 : Math.max(0, e[i] - low[i]);
      const karst = region[4 * count + i];
      moisture[i] = clamp01(
        0.44 + 0.6 * noise(wx, wy, 340, 7) + 0.2 * noise(wx, wy, 90, 8) +
        0.2 * (1 - clamp01(hand[i] / 25)) - 0.1 * clamp01(-northness[i] * slope[i] * 3) -
        0.28 * karst + 0.08 * region[3 * count + i],
      );
      exposure[i] = clamp01(1.5 * (1 - landBlur[i]) + 0.45 * noise(wx, wy, 300, 9) + 0.05);
      wind[i] = clamp01(
        0.12 + 0.38 * top[i] * (0.55 + e[i] / 90) + 0.02 * (e[i] - relief[i]) + 0.28 * noise(wx, wy, 280, 10) +
        0.35 * exposure[i] * clamp01(1 - toSea[i] / 50),
      );
      debris[i] = clamp01(debrisBlur[i] * 1.7 + 0.2 * noise(wx, wy, 40, 13));
      if (water[i] === 0 && toSea[i] < 3.5 && e[i] < 3) {
        shore[i] = slope[i] > 0.9 ? 3 : exposure[i] < 0.5 ? (karst > 0.5 ? 4 : 1) : 2;
      }
    }
  }

  return { w, h, x0, y0, e, slope, northness, hand, moisture, wind, exposure, debris, rock, region, water, shore, shoreDist };
}

export interface Layers {
  w: number;
  h: number;
  /** Ground cover, then with crowns and rocks stamped in. */
  ground: Uint8Array;
  material: Uint8Array;
  /** Ground plus stamps. */
  surface: Float32Array;
  stamps: number;
}

/** Cover for every cell of the fields, then scatter stamped into height and material. */
export function coverAndScatter(f: Fields, mask: Uint8Array, n: number): Layers {
  const { w, h } = f;
  const count = w * h;
  const ground = new Uint8Array(count);
  const input: CoverInput = {
    x: 0, y: 0, e: 0, slope: 0, northness: 0, hand: 0, moisture: 0, wind: 0, exposure: 0, debris: 0,
    rock: 0, region: new Float32Array(6), water: 0, shore: 0,
  };
  const region = input.region as Float32Array;
  const load = (x: number, y: number): void => {
    const i = y * w + x;
    input.x = wrap(f.x0 + x, n);
    input.y = wrap(f.y0 + y, n);
    input.e = f.e[i];
    input.slope = f.slope[i];
    input.northness = f.northness[i];
    input.hand = f.hand[i];
    input.moisture = f.moisture[i];
    input.wind = f.wind[i];
    input.exposure = f.exposure[i];
    input.debris = f.debris[i];
    input.rock = f.rock[i];
    for (let a = 0; a < 6; a++) region[a] = f.region[a * count + i];
    input.water = f.water[i];
    input.shore = f.shore[i];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      load(x, y);
      ground[y * w + x] = cover(input, mask, n);
    }
  }

  // Distance to the river due north and due south of each cell.
  const north = new Float32Array(count).fill(Infinity);
  const south = new Float32Array(count).fill(Infinity);
  for (let x = 0; x < w; x++) {
    let d = Infinity;
    for (let y = 0; y < h; y++) {
      d = f.water[y * w + x] === 3 ? 0 : d + 1;
      north[y * w + x] = d;
    }
    d = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      d = f.water[y * w + x] === 3 ? 0 : d + 1;
      south[y * w + x] = d;
    }
  }

  const material = ground.slice();
  const surface = new Float32Array(count);
  for (let i = 0; i < count; i++) surface[i] = Math.max(0, f.e[i]);
  const top = surface.slice();
  const dist: RiverDist = { north: 0, south: 0 };
  let stamps = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      load(x, y);
      dist.north = north[i];
      dist.south = south[i];
      const s = scatterAt(input, ground[i], mask, dist, n);
      if (!s) continue;
      stamps++;
      const sx = s.x - input.x + x;
      const sy = s.y - input.y + y;
      const base = surface[i];
      const r2 = s.r * s.r;
      for (let ty = Math.floor(sy - s.r); ty <= Math.ceil(sy + s.r); ty++) {
        if (ty < 0 || ty >= h) continue;
        for (let tx = Math.floor(sx - s.r); tx <= Math.ceil(sx + s.r); tx++) {
          if (tx < 0 || tx >= w) continue;
          const dx = tx + 0.5 - sx;
          const dy = ty + 0.5 - sy;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const ti = ty * w + tx;
          if (isWater[ground[ti]]) continue;
          const z = base + (s.shape === 1 ? s.h * (1 - Math.sqrt(d2) / s.r) : s.h * Math.sqrt(1 - d2 / r2)) + 0.01;
          if (z > top[ti]) {
            top[ti] = z;
            material[ti] = s.mat;
          }
        }
      }
    }
  }
  return { w, h, ground, material, surface: top, stamps };
}

const SUN_X = -0.32102;
const SUN_Y = -0.32102;
const SUN_Z = 0.89101;
const FLAT_LIT = 0.6 * SUN_Z + 0.4 * 0.5;

/** Light bytes for every cell: tone from Lambert + relief, cast shadow by a diagonal sweep, a little ink. */
export function light(f: Fields, l: Layers, mask: Uint8Array): Uint8Array {
  const { w, h } = l;
  const count = w * h;
  const surface = l.surface;
  const blurred = boxBlur(surface, w, h, 8);
  const out = new Uint8Array(count);

  // Shadow ray height: running maximum along the north-west diagonal, dropping 2√2 a step.
  const ray = new Float32Array(count).fill(-Infinity);
  const drop = 2 * Math.SQRT2;
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const p = (y - 1) * w + x - 1;
      ray[y * w + x] = Math.max(surface[p], ray[p]) - drop;
    }
  }

  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const mat = l.material[i];
      const dither = (mask[(((f.y0 + y) & 255) << 8) | ((f.x0 + x) & 255)] + 0.5) / 256;
      if (isWater[mat]) {
        let tone: number;
        if (mat === M.river) tone = (f.x0 + x + 2 * (f.y0 + y)) & 15;
        else tone = Math.min(15, Math.floor((Math.max(0, f.shoreDist[i] - 1) / (mat === M.lake ? 2.2 : 3.4)) + dither));
        out[i] = tone;
        continue;
      }
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      const dhdx = (surface[y * w + xp] - surface[y * w + xm]) / (xp - xm);
      const dhdy = (surface[yp * w + x] - surface[ym * w + x]) / (yp - ym);
      const inv = 1 / Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1);
      const lambert = Math.max(0, (-dhdx * SUN_X - dhdy * SUN_Y + SUN_Z) * inv);
      const relief = clamp01(0.5 + 0.05 * (surface[i] - blurred[i]));
      let lit = 0.6 * lambert + 0.4 * relief;
      // Contrast grows with height (after Imhof).
      lit = FLAT_LIT + (lit - FLAT_LIT) * (1 + f.e[i] / 260);
      const tone = Math.max(0, Math.min(15, Math.floor(FLAT_TONE + (lit - FLAT_LIT) * 26 + dither)));

      const over = ray[i] - surface[i];
      const shadow = over > 2.5 ? 2 : over > 0.2 ? 1 : 0;

      // Ink: the south edge of a wood, and cliffed coast.
      let ink = 0;
      if (y + 1 < h) {
        const below = l.material[i + w];
        if (isCanopy[mat] && !isCanopy[below] && surface[i] - surface[i + w] >= 2.5) ink = 1;
        if (f.shore[i] === 3 && isWater[below]) ink = 2;
      }
      out[i] = tone | (shadow << LIGHT_SHADOW_SHIFT) | (ink << LIGHT_INK_SHIFT);
    }
  }
  return out;
}

export interface Preview {
  w: number;
  h: number;
  rgba: Uint8Array;
  stamps: number;
  /** Cells of each material in the view. */
  histogram: Uint32Array;
  /** The view's material and light bytes, for re-colouring under another palette. */
  material: Uint8Array;
  light: Uint8Array;
}

/** Colour a view's material and light bytes through one palette. */
export function paint(material: Uint8Array, lightBytes: Uint8Array, w: number, h: number, o: PaletteOptions): Uint8Array {
  const pal = buildPalette(o);
  const rgba = new Uint8Array(w * h * 4);
  const out = new Uint32Array(rgba.buffer);
  for (let i = 0; i < w * h; i++) out[i] = pal[(material[i] << 8) | lightBytes[i]];
  return rgba;
}

/** The whole preview for one window. */
export function renderCoverPreview(plan: Plan, win: Window, seed: number, mask: Uint8Array, o: PaletteOptions): Preview {
  const f = standIn(plan, win, seed);
  const l = coverAndScatter(f, mask, win.n);
  const lit = light(f, l, mask);
  const material = new Uint8Array(win.w * win.h);
  const lightBytes = new Uint8Array(win.w * win.h);
  const histogram = new Uint32Array(256);
  for (let y = 0; y < win.h; y++) {
    for (let x = 0; x < win.w; x++) {
      const i = (y + APRON) * f.w + x + APRON;
      material[y * win.w + x] = l.material[i];
      lightBytes[y * win.w + x] = lit[i];
      histogram[l.ground[i]]++;
    }
  }
  return { w: win.w, h: win.h, rgba: paint(material, lightBytes, win.w, win.h, o), stamps: l.stamps, histogram, material, light: lightBytes };
}

/** Nearest-neighbour enlargement, hard pixels. */
export function upscale(rgba: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const out = new Uint8Array(w * k * h * k * 4);
  const src = new Uint32Array(rgba.buffer, rgba.byteOffset, w * h);
  const dst = new Uint32Array(out.buffer);
  for (let y = 0; y < h * k; y++) {
    const sy = Math.floor(y / k) * w;
    for (let x = 0; x < w * k; x++) dst[y * w * k + x] = src[sy + Math.floor(x / k)];
  }
  return out;
}
