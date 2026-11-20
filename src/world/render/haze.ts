// The haze: what the view shows where a chunk is not baked yet. A soft overview
// of the land at one pixel per 8 cells, in the palette's own washes faded toward
// the paper, as if seen through morning mist. It keeps the screen from ever going
// blank while the workers catch up.

import type { Palette } from "../look/contract.ts";
import { MATERIAL as M } from "../look/materials.ts";
import type { FlightData } from "../pack/world.ts";

/** Cells per overview pixel. */
export const HAZE_CELLS = 8;
/** Of 256: how far the washes fade toward the paper. */
export const HAZE_FADE = 115;
/** Bake rows per world row. */
const KY = 0.8;

/** The paper's own colour at noon, packed: what the washes fade toward unless the light says otherwise. */
export const CREAM_RGBA = 0xffd2e8f0;

/**
 * The overview's washes: sea, sand, pasture, moor and snow, the temperate land's by height; then the climates' own
 * (look/haze-wash.ts). Each sample is one of them at one tone, `kind << 4 | tone`, so there may be sixteen at most.
 */
const WASHES = [M.sea, M.sand, M.pastureMid, M.moorMid, M.snow, M.seaClear, M.packIce, M.tundraMid, M.spruceMid, M.steppeMid, M.sageMid, M.desertSand, M.savannaMid, M.jungleMid];

/** The kind of each material that is a wash, or −1. */
export const WASH_KIND: Int8Array = (() => {
  const k = new Int8Array(256).fill(-1);
  WASHES.forEach((m, i) => { k[m] = i; });
  return k;
})();

/**
 * The wash of one overview sample, `kind << 4 | tone`: material by height, or the climate's own (`over`, 0 for none),
 * and tone by a north-west light on the slope.
 */
function washOf(h: number, nw: number, over: number): number {
  const kind = over !== 0 && WASH_KIND[over] >= 0 ? WASH_KIND[over] : h <= 0 ? 0 : h <= 1.5 ? 1 : h <= 45 ? 2 : h <= 85 ? 3 : 4;
  const mat = WASHES[kind];
  if (mat === M.sea || mat === M.seaClear) return (kind << 4) | 8;
  // Ice on the sea is flat: one tone.
  if (h <= 0) return (kind << 4) | 9;
  // Ground rising toward the south-east faces the sun.
  const lit = Math.round((h - nw) * 0.12);
  return (kind << 4) | (9 + (lit < -3 ? -3 : lit > 4 ? 4 : lit));
}

function fade(c: number, cream: number): [number, number, number] {
  const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
  const cr = cream & 255, cg = (cream >>> 8) & 255, cb = (cream >>> 16) & 255;
  return [r + (((cr - r) * HAZE_FADE) >> 8), g + (((cg - g) * HAZE_FADE) >> 8), b + (((cb - b) * HAZE_FADE) >> 8)];
}

/** Each sample's wash, worked out once per sample grid (and climate plane): a new palette only recolours the few washes. */
const WASH_OF = new WeakMap<object, { over: ArrayLike<number> | undefined; out: Uint8Array }>();

function washesOf(samples: ArrayLike<number>, oN: number, over?: ArrayLike<number>): Uint8Array {
  const hit = WASH_OF.get(samples as object);
  if (hit && hit.over === over) return hit.out;
  const out = new Uint8Array(oN * oN);
  for (let oy = 0; oy < oN; oy++) for (let ox = 0; ox < oN; ox++) {
    const xw = (ox - 1 + oN) % oN, yw = (oy - 1 + oN) % oN, i = oy * oN + ox;
    out[i] = washOf(samples[i], samples[yw * oN + xw], over ? over[i] : 0);
  }
  WASH_OF.set(samples as object, { over, out });
  return out;
}

/**
 * Packed RGBA for bake pixel (bx, by), from one height sample per HAZE_CELLS cell (row-major, (n / HAZE_CELLS)²).
 * The north-west sample shades the slope. The flight data's means and the core's overview both feed this. The washes
 * fade toward `cream`, the paper in the palette's light. `over`, one per sample, is the climates' own wash where the
 * land is not temperate (a core's overviewWash), 0 to leave a sample to its height.
 */
export function hazeFromSamples(samples: ArrayLike<number>, n: number, palette: Palette, cream = CREAM_RGBA, over?: ArrayLike<number>): (bx: number, by: number) => number {
  const oN = n / HAZE_CELLS;
  const wash = washesOf(samples, oN, over);
  // The faded colour of every wash, three channels each.
  const rgb = new Uint8Array(WASHES.length * 16 * 3);
  for (let kind = 0; kind < WASHES.length; kind++) for (let tone = 0; tone < 16; tone++) {
    const [r, g, b] = fade(palette[(WASHES[kind] << 8) | tone], cream);
    const o = ((kind << 4) | tone) * 3;
    rgb[o] = r;
    rgb[o + 1] = g;
    rgb[o + 2] = b;
  }
  return (bx, by) => {
    // Pixel centres sit at the middle of each 8-cell block; blend the four around (bx, by).
    const fx = bx / HAZE_CELLS - 0.5, fy = by / KY / HAZE_CELLS - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const x0 = ((ix % oN) + oN) % oN, y0 = ((iy % oN) + oN) % oN;
    const x1 = (x0 + 1) % oN, y1 = (y0 + 1) % oN;
    const a = wash[y0 * oN + x0] * 3, b = wash[y0 * oN + x1] * 3, c = wash[y1 * oN + x0] * 3, d = wash[y1 * oN + x1] * 3;
    let out = 0xff000000;
    for (let k = 0; k < 3; k++) {
      const top = rgb[a + k] + (rgb[b + k] - rgb[a + k]) * tx;
      const bottom = rgb[c + k] + (rgb[d + k] - rgb[c + k]) * tx;
      out |= Math.round(top + (bottom - top) * ty) << (8 * k);
    }
    return out >>> 0;
  };
}

/** The mean heights hazeOf samples, per ground grid: worked out once, however often the palette changes. */
const MEANS = new WeakMap<object, Float64Array>();

/** Returns packed RGBA for bake pixel (bx, by), anywhere on the torus. */
export function hazeOf(data: FlightData, palette: Palette, cream = CREAM_RGBA): (bx: number, by: number) => number {
  const { n, gN, ground } = data;
  const oN = n / HAZE_CELLS;
  let samples = MEANS.get(ground);
  if (!samples) {
    const per = HAZE_CELLS / (n / gN);
    const area = per * per;
    samples = new Float64Array(oN * oN);
    for (let oy = 0; oy < oN; oy++) for (let ox = 0; ox < oN; ox++) {
      // The mean of the G nodes under this pixel.
      let h = 0;
      const x0 = ox * per, y0 = oy * per;
      for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) h += ground[(y0 + j) * gN + x0 + i];
      samples[oy * oN + ox] = h / area;
    }
    MEANS.set(ground, samples);
  }
  return hazeFromSamples(samples, n, palette, cream);
}
