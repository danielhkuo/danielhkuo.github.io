// The compositor: copies baked chunks through the palette into the frame,
// out = PAL[(material << 8) | light], in row segments per chunk.

import { hash2 } from "../core/hash.ts";
import type { Palette } from "../look/contract.ts";

export const CHUNK = 256;

/** A window of bake space, in bake pixels. */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Returns chunk (cx, cy)'s 256² bake pixels, or null while it is not baked. Indices are unwrapped. */
export type ChunkSource = (cx: number, cy: number) => Uint32Array | null;

/** Minimal live water: sparse glints that drift with `time`. */
export interface LiveWater {
  isWater: Uint8Array;
  mask: Uint8Array;
  /** Seconds. */
  time: number;
}

/** Packed RGBA drawn where no chunk is baked yet: bare paper. */
export const PAPER = 0xffd2e8f0;

/** The paper's own colour (the palette's PAPER at noon), as r, g, b. */
const CREAM: readonly [number, number, number] = [0xf0, 0xe8, 0xd2];
/** Of 256: how far the tooth of the paper shows through the paint at its highest, and how far pigment darkens its hollows. */
export const GRAIN_SHOW = 30;
export const GRAIN_SETTLE = 24;

/** Value noise 0–255 on a lattice of `cell` × `cellY` pixels that repeats every 256. */
function cloud(x: number, y: number, cell: number, cellY: number, seed: number): number {
  const lx = Math.floor(x / cell), ly = Math.floor(y / cellY);
  const fx = x / cell - lx, fy = y / cellY - ly;
  const px = 256 / cell, py = 256 / cellY;
  const at = (i: number, j: number): number => hash2(((i % px) + px) % px, ((j % py) + py) % py, seed) & 255;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = at(lx, ly) + (at(lx + 1, ly) - at(lx, ly)) * sx, bottom = at(lx, ly + 1) + (at(lx + 1, ly + 1) - at(lx, ly + 1)) * sx;
  return top + (bottom - top) * sy;
}

const GRAINS = new WeakMap<Uint8Array, Int8Array>();

/**
 * The sheet's grain, −127…127 per pixel of a 256² tile: broad unevenness in the sizing, fibres that lie along the
 * sheet, and the fine tooth (the blue-noise mask). Above zero the paper stands proud and shows through the paint.
 */
export function grainTile(mask: Uint8Array): Int8Array {
  const hit = GRAINS.get(mask);
  if (hit) return hit;
  const out = new Int8Array(65536);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const broad = cloud(x, y, 32, 32, 0x9a11) - 127.5;
    const fibre = cloud(x, y, 16, 4, 0x9a12) - 127.5;
    const mottle = cloud(x, y, 4, 4, 0x9a13) - 127.5;
    const tooth = mask[((y + 61) & 255) * 256 + ((x + 113) & 255)] - 127.5;
    const g = 0.5 * broad + 0.55 * fibre + 0.45 * mottle + 0.4 * tooth;
    out[y * 256 + x] = g < -127 ? -127 : g > 127 ? 127 : Math.round(g);
  }
  GRAINS.set(mask, out);
  return out;
}

/**
 * Paper grain over the whole frame, land and sea alike: where the sheet's tooth stands proud the cream of the paper
 * shows through the paint, and in its hollows the pigment settles a little darker. Indexed by bake pixel, so the
 * grain is fixed in the world and does not swim.
 */
export function paperGrain(out: Uint32Array, view: ViewRect, mask: Uint8Array): void {
  const { x: vx, y: vy, w, h } = view;
  const grain = grainTile(mask);
  for (let r = 0; r < h; r++) {
    const grow = ((vy + r) & 255) * 256;
    for (let c = 0; c < w; c++) {
      const g = grain[grow + ((vx + c) & 255)];
      if (g === 0) continue;
      const v = out[r * w + c];
      let R = v & 255, G = (v >>> 8) & 255, B = (v >>> 16) & 255;
      if (g > 0) {
        const k = (g * GRAIN_SHOW) >> 7;
        R += ((CREAM[0] - R) * k) >> 8;
        G += ((CREAM[1] - G) * k) >> 8;
        B += ((CREAM[2] - B) * k) >> 8;
      } else {
        // Settled pigment: darker, and a touch warmer than a plain multiply.
        const k = 256 + ((g * GRAIN_SETTLE) >> 7);
        R = (R * (k + 2)) >> 8;
        G = (G * k) >> 8;
        B = (B * (k - 2)) >> 8;
      }
      out[r * w + c] = ((v & 0xff000000) | (B << 16) | (G << 8) | R) >>> 0;
    }
  }
}

/** Packed RGBA for bake pixel (bx, by) where no chunk is baked yet (the haze). */
export type Fallback = (bx: number, by: number) => number;

/** When `bakeOut` is given, it receives the bake pixel under each output pixel (0 where `fallback` or paper shows). */
export function compose(
  chunks: ChunkSource, palette: Palette, view: ViewRect, out: Uint32Array, live?: LiveWater, fallback?: Fallback, bakeOut?: Uint32Array,
): void {
  void bakeOut;
  const { x: vx, y: vy, w, h } = view;
  const cx0 = Math.floor(vx / CHUNK), cx1 = Math.floor((vx + w - 1) / CHUNK);
  const cy0 = Math.floor(vy / CHUNK), cy1 = Math.floor((vy + h - 1) / CHUNK);
  const drift = live ? Math.floor(live.time * 6) : 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    const r0 = Math.max(vy, cy * CHUNK), r1 = Math.min(vy + h, (cy + 1) * CHUNK);
    for (let cx = cx0; cx <= cx1; cx++) {
      const c0 = Math.max(vx, cx * CHUNK), c1 = Math.min(vx + w, (cx + 1) * CHUNK);
      const px = chunks(cx, cy);
      for (let r = r0; r < r1; r++) {
        let o = (r - vy) * w + (c0 - vx);
        if (!px) {
          if (fallback) for (let c = c0; c < c1; c++) out[o++] = fallback(c, r);
          else for (let c = c0; c < c1; c++) out[o++] = PAPER;
          continue;
        }
        let i = (r - cy * CHUNK) * CHUNK + (c0 - cx * CHUNK);
        if (!live) {
          for (let c = c0; c < c1; c++) {
            const v = px[i++];
            out[o++] = palette[((v & 255) << 8) | ((v >>> 8) & 255)];
          }
          continue;
        }
        const mrow = (r & 255) * 256;
        for (let c = c0; c < c1; c++) {
          const v = px[i++];
          const m = v & 255, light = (v >>> 8) & 255;
          // A glint: the water's lightest tone, on the few pixels the drifting mask picks.
          if (live.isWater[m] === 1 && (light & 15) > 2 && live.mask[mrow + ((c + drift) & 255)] > 251) out[o++] = palette[(m << 8) | (light & 0xf0) | 1];
          else out[o++] = palette[(m << 8) | light];
        }
      }
    }
  }
}
