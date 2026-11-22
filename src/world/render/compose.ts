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

/** The paper's own colour at noon, packed RGBA: the cream that shows through where the tooth stands proud. */
export const CREAM = 0xffd2e8f0;
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
 * What the grain does to a channel, as lookup tables: three of 256 (red, green, blue) for each distinct effect, and
 * for each grain value g (at g + 128) where its tables start.
 *
 * Where the tooth stands proud (g > 0), with k = (g · GRAIN_SHOW) >> 7, the cream shows through:
 * c + (((cream − c) · k) >> 8). In a hollow (g < 0), with k = 256 + ((g · GRAIN_SETTLE) >> 7), the pigment settles
 * darker and a touch warmer than a plain multiply: red keeps k + 2, green k, blue k − 2 of 256. At g = 0 nothing
 * changes. Grain values with the same k share their tables: some 55 of them, 42 kB.
 */
function grainTables(cream: number): { lut: Uint8Array; start: Int32Array } {
  const start = new Int32Array(256);
  const keys = new Map<string, number>();
  const effects: ((c: number, ch: number) => number)[] = [];
  const paper = [cream & 255, (cream >>> 8) & 255, (cream >>> 16) & 255];
  for (let g = -128; g < 128; g++) {
    let key = "none";
    let effect = (c: number, ch: number): number => c + 0 * ch;
    if (g > 0) {
      const k = (g * GRAIN_SHOW) >> 7;
      key = `show ${k}`;
      effect = (c, ch) => c + (((paper[ch] - c) * k) >> 8);
    } else if (g < 0) {
      const k = 256 + ((g * GRAIN_SETTLE) >> 7);
      key = `settle ${k}`;
      // Settled pigment: darker, and a touch warmer than a plain multiply.
      effect = (c, ch) => (c * (ch === 0 ? k + 2 : ch === 1 ? k : k - 2)) >> 8;
    }
    let at = keys.get(key);
    if (at === undefined) {
      at = effects.length * 768;
      keys.set(key, at);
      effects.push(effect);
    }
    start[g + 128] = at;
  }
  const lut = new Uint8Array(effects.length * 768);
  for (let e = 0; e < effects.length; e++) for (let ch = 0; ch < 3; ch++) for (let c = 0; c < 256; c++) lut[e * 768 + ch * 256 + c] = effects[e](c, ch);
  return { lut, start };
}
/** The grain's tables for each paper colour asked for lately: the light moves the paper's colour a step at a time. */
const GRAINS_BY_CREAM = new Map<number, { lut: Uint8Array; start: Int32Array }>();
function grainFor(cream: number): { lut: Uint8Array; start: Int32Array } {
  let hit = GRAINS_BY_CREAM.get(cream);
  if (!hit) {
    hit = grainTables(cream);
    if (GRAINS_BY_CREAM.size >= 8) GRAINS_BY_CREAM.delete(GRAINS_BY_CREAM.keys().next().value!);
    GRAINS_BY_CREAM.set(cream, hit);
  }
  return hit;
}
const GRAIN = grainFor(CREAM);
const GRAIN_AT = new WeakMap<Uint8Array, Uint16Array>();

/** For each pixel of the sheet's 256² tile, where its grain's tables start in GRAIN.lut. */
function grainAt(mask: Uint8Array): Uint16Array {
  const hit = GRAIN_AT.get(mask);
  if (hit) return hit;
  const grain = grainTile(mask);
  const at = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) at[i] = GRAIN.start[grain[i] + 128];
  GRAIN_AT.set(mask, at);
  return at;
}

/**
 * Paper grain over the whole frame, land and sea alike: where the sheet's tooth stands proud the cream of the paper
 * shows through the paint, and in its hollows the pigment settles a little darker. Indexed by bake pixel, so the
 * grain is fixed in the world and does not swim.
 */
export function paperGrain(out: Uint32Array, view: ViewRect, mask: Uint8Array, cream = CREAM): void {
  const { x: vx, y: vy, w, h } = view;
  const at = grainAt(mask);
  // Every paper colour's tables are laid out alike (the effects depend on the grain alone), so one index serves all.
  const lut = grainFor(cream).lut;
  // Three table reads a pixel (see grainTables), with no branch: the grain's sign is noise, so a branch on it would
  // mispredict on every other pixel.
  for (let r = 0, o = 0; r < h; r++) {
    const grow = ((vy + r) & 255) << 8;
    for (let c = 0, gx = vx & 255; c < w; c++, o++, gx = (gx + 1) & 255) {
      const t = at[grow | gx];
      const v = out[o];
      out[o] = (v & 0xff000000) | (lut[t + 512 + ((v >>> 16) & 255)] << 16) | (lut[t + 256 + ((v >>> 8) & 255)] << 8) | lut[t + (v & 255)];
    }
  }
}

/** Packed RGBA for bake pixel (bx, by) where no chunk is baked yet (the haze). */
export type Fallback = (bx: number, by: number) => number;

/**
 * Composes only frame pixels [x0, x1) × [y0, y1) of `view` (frame coordinates, clipped to the frame), exactly as compose
 * does without live water; the rest of `out` and `bakeOut` is left as it is. Each chunk under the area is asked for
 * once, rows of chunks top to bottom and each row left to right. Returns whether every one of them was there.
 */
export function composeArea(
  chunks: ChunkSource, palette: Palette, view: ViewRect, out: Uint32Array, x0: number, y0: number, x1: number, y1: number,
  fallback?: Fallback, bakeOut?: Uint32Array,
): boolean {
  const { x: vx, y: vy, w, h } = view;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > w) x1 = w;
  if (y1 > h) y1 = h;
  if (x0 >= x1 || y0 >= y1) return true;
  const ax0 = vx + x0, ax1 = vx + x1, ay0 = vy + y0, ay1 = vy + y1;
  const cx0 = Math.floor(ax0 / CHUNK), cx1 = Math.floor((ax1 - 1) / CHUNK);
  const cy0 = Math.floor(ay0 / CHUNK), cy1 = Math.floor((ay1 - 1) / CHUNK);
  let whole = true;
  for (let cy = cy0; cy <= cy1; cy++) {
    const r0 = Math.max(ay0, cy * CHUNK), r1 = Math.min(ay1, (cy + 1) * CHUNK);
    for (let cx = cx0; cx <= cx1; cx++) {
      const c0 = Math.max(ax0, cx * CHUNK), c1 = Math.min(ax1, (cx + 1) * CHUNK);
      const px = chunks(cx, cy);
      if (!px) {
        whole = false;
        for (let r = r0; r < r1; r++) {
          let o = (r - vy) * w + (c0 - vx);
          if (fallback) for (let c = c0; c < c1; c++) {
            if (bakeOut) bakeOut[o] = 0;
            out[o++] = fallback(c, r);
          }
          else for (let c = c0; c < c1; c++) {
            if (bakeOut) bakeOut[o] = 0;
            out[o++] = PAPER;
          }
        }
        continue;
      }
      const span = c1 - c0;
      for (let r = r0; r < r1; r++) {
        let o = (r - vy) * w + (c0 - vx);
        let i = (r - cy * CHUNK) * CHUNK + (c0 - cx * CHUNK);
        const end = i + span;
        if (bakeOut) {
          for (; i < end; i++, o++) {
            const v = px[i];
            bakeOut[o] = v;
            out[o] = palette[((v & 255) << 8) | ((v >>> 8) & 255)];
          }
        } else {
          for (; i < end; i++, o++) {
            const v = px[i];
            out[o] = palette[((v & 255) << 8) | ((v >>> 8) & 255)];
          }
        }
      }
    }
  }
  return whole;
}

/** When `bakeOut` is given, it receives the bake pixel under each output pixel (0 where `fallback` or paper shows). */
export function compose(
  chunks: ChunkSource, palette: Palette, view: ViewRect, out: Uint32Array, live?: LiveWater, fallback?: Fallback, bakeOut?: Uint32Array,
): void {
  if (!live) {
    composeArea(chunks, palette, view, out, 0, 0, view.w, view.h, fallback, bakeOut);
    return;
  }
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
          if (fallback) for (let c = c0; c < c1; c++) {
            if (bakeOut) bakeOut[o] = 0;
            out[o++] = fallback(c, r);
          }
          else for (let c = c0; c < c1; c++) {
            if (bakeOut) bakeOut[o] = 0;
            out[o++] = PAPER;
          }
          continue;
        }
        let i = (r - cy * CHUNK) * CHUNK + (c0 - cx * CHUNK);
        if (!live) {
          for (let c = c0; c < c1; c++) {
            const v = px[i++];
            if (bakeOut) bakeOut[o] = v;
            out[o++] = palette[((v & 255) << 8) | ((v >>> 8) & 255)];
          }
          continue;
        }
        const mrow = (r & 255) * 256;
        for (let c = c0; c < c1; c++) {
          const v = px[i++];
          if (bakeOut) bakeOut[o] = v;
          const m = v & 255, light = (v >>> 8) & 255;
          // A glint: the water's lightest tone, on the few pixels the drifting mask picks.
          if (live.isWater[m] === 1 && (light & 15) > 2 && live.mask[mrow + ((c + drift) & 255)] > 251) out[o++] = palette[(m << 8) | (light & 0xf0) | 1];
          else out[o++] = palette[(m << 8) | light];
        }
      }
    }
  }
}
