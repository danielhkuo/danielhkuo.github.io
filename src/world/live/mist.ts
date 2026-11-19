// Mist: low banks lying on the water and the open ground, drifting slowly with the wind. The palette lays the
// mist's even veil over everything; this layer is what makes it mist and not a pale filter: long flat wisps, thicker
// at the heart, with the tree crowns, the roofs and the high ground standing clear of them.
//
// The banks are a fixed field of long streaks sliding over bake space in whole pixels. A pixel under a bank goes part
// of the way to the mist's colour, in three flat steps: a fringe drawn on every other pixel, a body, and a heart.
// Only the field's runs are walked, about a quarter of the frame, and the layer lies under the flier.

import { hash2 } from "../core/hash.ts";
import { isBuilt, isCanopy, isWater, MATERIAL as M } from "../look/materials.ts";
import { gradeRgb } from "../render/palette.ts";
import { lightKey, paletteOptions, type Air } from "../sky/air.ts";
import { rainLean } from "../sky/rain.ts";
import { modP } from "./art.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";

/** The field: 512 bake pixels by 256 rows; the world is a whole number of them round, both ways. */
const FW = 512;
const FH = 256;
/** The field's lattices: long streaks, and shorter ones that fray their ends. */
const STREAK = [128, 16] as const;
const FRAY = [32, 8] as const;
/** Of 256 levels, even in area: where the fringe, the body and the heart of a bank start in full mist. */
const FRINGE = 206;
const BODY = 220;
const HEART = 240;
/** Of 256: how far a pixel goes to the mist's colour in the fringe and body, and in the heart; and more on water. */
const THIN = 104;
const THICK = 164;
const ON_WATER = 26;
/** Bake pixels a second the banks drift. */
export const MIST_DRIFT = 2.5;
/** The mist's own colour in daylight; it takes the light and the veil like everything else. */
const MIST = 0xfff4ede6;

/** What a bank does to a material: nothing (it stands clear), lies on it, or lies thicker (water and wet ground). */
const CLEAR = 0, LAND = 1, WET = 2;
const KIND = new Uint8Array(256).fill(LAND);
KIND[M.none] = CLEAR;
for (let m = 0; m < 256; m++) {
  if (isCanopy[m] === 1 || isBuilt[m] === 1) KIND[m] = CLEAR;
  if (isWater[m] === 1) KIND[m] = WET;
}
// The heights stand over the mist, and so do hedges and walls.
for (const m of [
  M.snow, M.snowLate, M.rockHard, M.rockSed, M.rockLime, M.rockSlate, M.cliffHard, M.cliffSed, M.cliffLime, M.cliffSlate,
  M.scree, M.screeSlate, M.screeStone, M.alpineCool, M.alpineMid, M.alpineWarm, M.boulder, M.hedge, M.hedgeCrown, M.wall,
  M.yew,
]) KIND[m] = CLEAR;
for (const m of [M.marsh, M.reeds, M.saltmarsh, M.saltCreek]) KIND[m] = WET;

/** Smooth value noise on a lattice of cw × ch that wraps round the field; 0–1. */
function lattice(x: number, y: number, cw: number, ch: number, seed: number): number {
  const nx = FW / cw, ny = FH / ch;
  const gx = x / cw, gy = y / ch;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = gx - ix, fy = gy - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const x1 = (ix + 1) % nx, y1 = (iy + 1) % ny;
  const a = hash2(ix, iy, seed) & 1023, b = hash2(x1, iy, seed) & 1023;
  const c = hash2(ix, y1, seed) & 1023, d = hash2(x1, y1, seed) & 1023;
  const top = a + (b - a) * u, bottom = c + (d - c) * u;
  return (top + (bottom - top) * v) / 1023;
}

/**
 * The indices of `keys` in ascending order, ties by index: a stable two-pass radix sort. The field's values are
 * non-negative floats, whose bits order as their values do, so this is the order a comparison sort would give, at a
 * small part of its cost (the page builds the field while it loads).
 */
function rankOrder(keys: Uint32Array): Uint32Array {
  const n = keys.length;
  let from = new Uint32Array(n), to = new Uint32Array(n);
  for (let i = 0; i < n; i++) from[i] = i;
  const count = new Uint32Array(65537);
  for (let shift = 0; shift < 32; shift += 16) {
    count.fill(0);
    for (let i = 0; i < n; i++) count[((keys[from[i]] >>> shift) & 0xffff) + 1]++;
    for (let b = 0; b < 65536; b++) count[b + 1] += count[b];
    for (let i = 0; i < n; i++) to[count[(keys[from[i]] >>> shift) & 0xffff]++] = from[i];
    [from, to] = [to, from];
  }
  return from;
}

/** The banks, levelled so each value 0–255 covers the same area. */
export function mistField(seed: number): Uint8Array {
  const raw = new Float32Array(FW * FH);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    raw[y * FW + x] = lattice(x, y, STREAK[0], STREAK[1], seed ^ 0x3157) + 0.45 * lattice(x, y, FRAY[0], FRAY[1], seed ^ 0x6d2b);
  }
  const order = rankOrder(new Uint32Array(raw.buffer));
  const out = new Uint8Array(FW * FH);
  for (let k = 0; k < order.length; k++) out[order[k]] = Math.floor((k * 256) / order.length);
  return out;
}

/** The runs of each row of the field at `floor` or more, as [start, end) pairs, row r's from at[r] to at[r + 1]. */
function runsOf(field: Uint8Array, floor: number): { at: Int32Array; runs: Int32Array } {
  const at = new Int32Array(FH + 1);
  const list: number[] = [];
  for (let r = 0; r < FH; r++) {
    at[r] = list.length;
    for (let x = 0; x < FW; ) {
      if (field[r * FW + x] < floor) { x++; continue; }
      const start = x;
      while (x < FW && field[r * FW + x] >= floor) x++;
      list.push(start, x);
    }
  }
  at[FH] = list.length;
  return { at, runs: Int32Array.from(list) };
}

/** The mist's banks. `seed` is the world's. Draws nothing when no mist lies. */
export function mistLayer(seed: number): LiveLayer {
  const field = mistField(seed);
  const { at: runAt, runs } = runsOf(field, FRINGE);
  const lean = rainLean(seed);
  let key = -1, colour = MIST;
  const colourIn = (air: Air): number => {
    const k = lightKey(air, 96, 16);
    if (k !== key) {
      key = k;
      colour = gradeRgb(MIST, paletteOptions(air));
    }
    return colour;
  };
  return {
    name: "mist",
    draw(f: LiveFrame): void {
      const air = f.air;
      if (!air || air.mist <= 0) return;
      const { out, bake, t } = f;
      const w = f.rect.w, h = f.rect.h, rx = Math.floor(f.rect.x), ry = Math.floor(f.rect.y);
      const amount = air.mist > 1 ? 1 : air.mist;
      // Thin mist has smaller banks as well as fainter ones: the levels a bank needs rise as the mist thins.
      const rise = Math.round((255 - FRINGE) * 0.6 * (1 - amount));
      const fringe = FRINGE + rise, body = BODY + rise, heart = HEART + (rise >> 1);
      const c = colourIn(air);
      const cRB = c & 0xff00ff, cG = c & 0x00ff00;
      const thin = Math.round(THIN * amount), thick = Math.round(THICK * amount), wet = Math.round(ON_WATER * amount);
      const shift = Math.floor(t * MIST_DRIFT) * lean;
      const g0 = modP(rx - shift, FW);
      const levels = field, starts = runAt, spans = runs, kindOf = KIND;
      for (let py = 0; py < h; py++) {
        const by = ry + py;
        const fieldRow = by & (FH - 1);
        const row = fieldRow * FW;
        const line = py * w;
        // Each run, and its copy a field further on, against the frame's span of the field [g0, g0 + w).
        for (let q = starts[fieldRow], qEnd = starts[fieldRow + 1]; q < qEnd; q += 2) {
          for (let copy = 0; spans[q] + copy - g0 < w; copy += FW) {
            const lo = spans[q] + copy - g0, hi = spans[q + 1] + copy - g0;
            const px0 = lo < 0 ? 0 : lo, px1 = hi > w ? w : hi;
            for (let px = px0, i = line + px0, g = row + px0 + g0 - copy; px < px1; px++, i++, g++) {
              const level = levels[g];
              if (level < fringe) continue;
              const kind = kindOf[bake[i] & 255];
              if (kind === CLEAR) continue;
              // The fringe is a checker fixed to the land, so it does not crawl as the bank drifts.
              if (level < body && ((rx + px + by) & 1) === 0) continue;
              const a = (level >= heart ? thick : thin) + (kind === WET ? wet : 0);
              const dst = out[i], inv = 256 - a;
              const rb = (((dst & 0xff00ff) * inv + cRB * a) >>> 8) & 0xff00ff;
              const gg = (((dst & 0x00ff00) * inv + cG * a) >>> 8) & 0x00ff00;
              out[i] = (0xff000000 | rb | gg) >>> 0;
            }
          }
        }
      }
    },
  };
}
