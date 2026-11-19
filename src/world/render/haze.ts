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

const CREAM: readonly [number, number, number] = [0xf0, 0xe8, 0xd2];

/**
 * The wash for one overview pixel: material by height, tone by a north-west light on the slope. `over` is the
 * climate's own wash for the pixel (look/haze-wash.ts), or 0 for the temperate land's, by height.
 */
function wash(palette: Palette, h: number, nw: number, over: number): number {
  const mat = over !== 0 ? over : h <= 0 ? M.sea : h <= 1.5 ? M.sand : h <= 45 ? M.pastureMid : h <= 85 ? M.moorMid : M.snow;
  if (mat === M.sea || mat === M.seaClear) return palette[(mat << 8) | 8];
  // Ice on the sea is flat: one tone.
  if (h <= 0) return palette[(mat << 8) | 9];
  // Ground rising toward the south-east faces the sun.
  const lit = Math.round((h - nw) * 0.12);
  const tone = 9 + (lit < -3 ? -3 : lit > 4 ? 4 : lit);
  return palette[(mat << 8) | tone];
}

function fade(c: number): [number, number, number] {
  const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
  return [r + (((CREAM[0] - r) * HAZE_FADE) >> 8), g + (((CREAM[1] - g) * HAZE_FADE) >> 8), b + (((CREAM[2] - b) * HAZE_FADE) >> 8)];
}

/**
 * Packed RGBA for bake pixel (bx, by), from one height sample per HAZE_CELLS cell (row-major, (n / HAZE_CELLS)²).
 * The north-west sample shades the slope. The flight data's means and the core's overview both feed this.
 */
export function hazeFromSamples(samples: ArrayLike<number>, n: number, palette: Palette, washes?: ArrayLike<number>): (bx: number, by: number) => number {
  const oN = n / HAZE_CELLS;
  const rgb = new Uint8Array(oN * oN * 3);
  for (let oy = 0; oy < oN; oy++) for (let ox = 0; ox < oN; ox++) {
    const xw = (ox - 1 + oN) % oN, yw = (oy - 1 + oN) % oN;
    const h = samples[oy * oN + ox];
    const nw = samples[yw * oN + xw];
    const [r, g, b] = fade(wash(palette, h, nw, washes ? washes[oy * oN + ox] : 0));
    const o = (oy * oN + ox) * 3;
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
    const a = (y0 * oN + x0) * 3, b = (y0 * oN + x1) * 3, c = (y1 * oN + x0) * 3, d = (y1 * oN + x1) * 3;
    let out = 0xff000000;
    for (let k = 0; k < 3; k++) {
      const top = rgb[a + k] + (rgb[b + k] - rgb[a + k]) * tx;
      const bottom = rgb[c + k] + (rgb[d + k] - rgb[c + k]) * tx;
      out |= Math.round(top + (bottom - top) * ty) << (8 * k);
    }
    return out >>> 0;
  };
}

/** Returns packed RGBA for bake pixel (bx, by), anywhere on the torus. */
export function hazeOf(data: FlightData, palette: Palette): (bx: number, by: number) => number {
  const { n, gN, ground } = data;
  const per = HAZE_CELLS / (n / gN);
  const oN = n / HAZE_CELLS;
  const samples = new Float64Array(oN * oN);
  const area = per * per;
  for (let oy = 0; oy < oN; oy++) for (let ox = 0; ox < oN; ox++) {
    // The mean of the G nodes under this pixel.
    let h = 0;
    const x0 = ox * per, y0 = oy * per;
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) h += ground[(y0 + j) * gN + x0 + i];
    samples[oy * oN + ox] = h / area;
  }
  return hazeFromSamples(samples, n, palette);
}
