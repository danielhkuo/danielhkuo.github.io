// The world view: the one module the dragon, flight model and menus plug
// into (design 5.9). This version bakes synchronously into an in-memory chunk
// cache; workers and streaming replace the cache later without changing the
// interface.

import { bakeChunk, CHUNK, CHUNK_ROWS, tileCache, type TileSource } from "../bake/chunk.ts";
import { groundAt, type Look } from "../bake/cells.ts";
import type { BakeWorld } from "../bake/world.ts";
import { wrap } from "../core/torus.ts";
import { compose, type LiveWater, type ViewRect } from "../render/compose.ts";

export interface Site {
  x: number;
  y: number;
  type: string;
  project: string | null;
}

export interface WorldView {
  /** Centres the view on world cell (x, y) at sea level. */
  setCamera(x: number, y: number): void;
  /** Draws the current view; `out` holds width × height packed RGBA. */
  frame(out: Uint32Array, time?: number): void;
  /** World row (fractional, unwrapped) of the land drawn at view pixel (px, py): larger is nearer the viewer. */
  depthAt(px: number, py: number): number;
  /** Height of the ground or water surface at world cell (x, y). */
  groundHeight(x: number, y: number): number;
  /** Lowest altitude at which a flier over (x, y) is not hidden by terrain to its south. Stub: 0. */
  occlusionFloor(x: number, y: number): number;
  /** Reserved sites. Stub: none until siting lands. */
  sites(): Site[];
  /** The bake-space rectangle on screen. */
  rect(): ViewRect;
  /** Chunks baked so far, and milliseconds spent baking them. */
  stats(): { chunks: number; bakeMs: number };
}

export interface ViewOptions {
  width?: number;
  height?: number;
  /** Chunks kept; 24 is 6.3 MB. */
  cacheChunks?: number;
  /** Draw drifting glints on water. */
  liveWater?: boolean;
}

export function createView(world: BakeWorld, look: Look, mask: Uint8Array, opts: ViewOptions = {}): WorldView {
  const width = opts.width ?? 400, height = opts.height ?? 225;
  const capacity = opts.cacheChunks ?? 24;
  const n = world.n;
  const tiles: TileSource = tileCache(world, look, mask, 24);
  const periodX = n / CHUNK;
  // Bake space wraps on whole chunks in y only when 0.8·n is a multiple of 256 (n a multiple of 320).
  const periodY = (n * 4) % (5 * CHUNK) === 0 ? (n * 4) / 5 / CHUNK : 0;
  const cache = new Map<string, Uint32Array>();
  let baked = 0, bakeMs = 0;
  const rect: ViewRect = { x: -(width >> 1), y: -(height >> 1), w: width, h: height };

  const chunk = (cx: number, cy: number): Uint32Array => {
    const kx = wrap(cx, periodX), ky = periodY ? wrap(cy, periodY) : cy;
    const key = `${kx},${ky}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const t0 = performance.now();
    const px = bakeChunk(world, look, mask, tiles, kx, ky);
    bakeMs += performance.now() - t0;
    baked++;
    cache.set(key, px);
    if (cache.size > capacity) cache.delete(cache.keys().next().value as string);
    return px;
  };

  return {
    setCamera(x, y) {
      rect.x = Math.floor(x) - (width >> 1);
      rect.y = Math.floor(0.8 * y) - (height >> 1);
    },
    frame(out, time = 0) {
      const live: LiveWater | undefined = opts.liveWater ? { isWater: look.isWater, mask, time } : undefined;
      compose(chunk, look.palette, rect, out, live);
    },
    depthAt(px, py) {
      const bx = rect.x + Math.floor(px), by = rect.y + Math.floor(py);
      const cx = Math.floor(bx / CHUNK), cy = Math.floor(by / CHUNK);
      const v = chunk(cx, cy)[(by - cy * CHUNK) * CHUNK + (bx - cx * CHUNK)];
      return cy * CHUNK_ROWS + (v >>> 16) / 8;
    },
    groundHeight(x, y) {
      const e = groundAt(world, x, y);
      return e < 0 ? 0 : e;
    },
    occlusionFloor() {
      return 0;
    },
    sites() {
      return [];
    },
    rect() {
      return { ...rect };
    },
    stats() {
      return { chunks: baked, bakeMs };
    },
  };
}
