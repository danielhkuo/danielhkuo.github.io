// The compositor: copies baked chunks through the palette into the frame,
// out = PAL[(material << 8) | light], in row segments per chunk.

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

/**
 * Paper grain: darkens each pixel by 0–3 levels from the blue-noise mask,
 * indexed by bake pixel so the grain is fixed in the world and does not swim.
 */
export function paperGrain(out: Uint32Array, view: ViewRect, mask: Uint8Array): void {
  const { x: vx, y: vy, w, h } = view;
  for (let r = 0; r < h; r++) {
    const mrow = ((vy + r + 61) & 255) * 256;
    for (let c = 0; c < w; c++) {
      const g = mask[mrow + ((vx + c + 113) & 255)] >> 6;
      if (g === 0) continue;
      const v = out[r * w + c];
      const R = (v & 255) - g, G = ((v >>> 8) & 255) - g, B = ((v >>> 16) & 255) - g - 1;
      out[r * w + c] = ((v & 0xff000000) | ((B < 0 ? 0 : B) << 16) | ((G < 0 ? 0 : G) << 8) | (R < 0 ? 0 : R)) >>> 0;
    }
  }
}

export function compose(chunks: ChunkSource, palette: Palette, view: ViewRect, out: Uint32Array, live?: LiveWater): void {
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
          for (let c = c0; c < c1; c++) out[o++] = PAPER;
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
