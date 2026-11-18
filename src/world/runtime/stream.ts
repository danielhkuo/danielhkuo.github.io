// The streaming view: the WorldView the flight page draws through. Chunks are
// baked by the worker pool; this view decides which ones it wants and how
// urgently, keeps the baked ones in a small cache, and draws the haze wherever a
// chunk has not arrived yet.

import { upsampleGround } from "../bake/cells.ts";
import { CHUNK, CHUNK_ROWS } from "../bake/chunk.ts";
import { wrap } from "../core/torus.ts";
import type { Palette } from "../look/contract.ts";
import type { Manifest } from "../pack/manifest.ts";
import type { FlightData } from "../pack/world.ts";
import { compose, paperGrain, type ViewRect } from "../render/compose.ts";
import { hazeOf } from "../render/haze.ts";
import { runLayers, type Flier, type LiveLayer } from "../live/live.ts";
import type { BakePool, ChunkWant } from "./pool.ts";
import type { Site, WorldView } from "./view.ts";

/** Chunks kept by default (8.4 MB). */
export const STREAM_CACHE = 32;
/** Seconds of travel ahead that are baked before they are needed. */
export const LOOKAHEAD = 6;

export interface StreamOptions {
  width: number;
  height: number;
  cacheChunks?: number;
  lookahead?: number;
  sites?: Manifest["sites"];
  /** Lay the paper grain over the frame (default true). */
  paper?: boolean;
  /** Live layers, run in order after compositing and before the paper grain (see live/live.ts). */
  layers?: readonly LiveLayer[];
  /** Hears a live layer that failed; it is skipped from then on. */
  onLayerError?: (name: string, message: string) => void;
}

export interface StreamView extends WorldView {
  /**
   * Re-plans which chunks to bake for a flier moving at (vx, vy) cells a second, and passes the list to the pool.
   * Priorities, lowest first: chunks under the view (below 1); chunks the view will reach within `lookahead` seconds
   * (1 + the seconds until it reaches them); a one-chunk ring around the view (2 + lookahead). Baked chunks are never
   * wanted again while cached.
   */
  update(vx: number, vy: number): void;
  /** Every chunk under the view is baked. */
  ready(): boolean;
  /** Chunks held in the cache. */
  cached(): number;
  /** The bake pixel under each pixel of the last frame (width × height; 0 where haze showed). Live layers read it. */
  bakeFrame(): Uint32Array;
  /** Draws the frame; `flier`, when given, is handed to the live layers. */
  frame(out: Uint32Array, time?: number, flier?: Flier): void;
}

/** n must be a multiple of 320, so the bake wraps on whole chunks both ways. */
export function createStreamView(data: FlightData, pool: BakePool, palette: Palette, mask: Uint8Array, opts: StreamOptions): StreamView {
  const n = data.n;
  if (n % 320 !== 0) throw new Error("n must be a multiple of 320");
  const width = opts.width, height = opts.height;
  const capacity = opts.cacheChunks ?? STREAM_CACHE;
  const lookahead = opts.lookahead ?? LOOKAHEAD;
  // Bake space is  n × 0.8·n  pixels; both axes then span a whole number of chunks.
  const periodX = n / CHUNK;
  const periodY = n / 320;
  const cache = new Map<string, Uint32Array>();
  let received = 0;
  const rect: ViewRect = { x: -(width >> 1), y: -(height >> 1), w: width, h: height };
  const haze = hazeOf(data, palette);
  const groundSample = new Float32Array(1);
  const sites: Site[] = (opts.sites ?? []).map((s) => ({ x: s.x, y: s.y, type: s.type, project: null }));
  const bakeBuffer = new Uint32Array(width * height);
  const disabled = new Set<string>();

  const keyOf = (cx: number, cy: number): string => `${wrap(cx, periodX)},${wrap(cy, periodY)}`;

  /** Remember a baked chunk and count it as just used. Drops the least recently used past `capacity`. */
  const store = (cx: number, cy: number, px: Uint32Array): void => {
    const key = keyOf(cx, cy);
    cache.delete(key);
    cache.set(key, px);
    received++;
    while (cache.size > capacity) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };
  pool.onBaked = store;

  /** Cached pixels for an unwrapped chunk, or null. A hit counts as a use. */
  const read = (cx: number, cy: number): Uint32Array | null => {
    const key = keyOf(cx, cy);
    const hit = cache.get(key);
    if (!hit) return null;
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  };

  const eachChunk = (x: number, y: number, w: number, h: number, fn: (cx: number, cy: number) => void): void => {
    const cx0 = Math.floor(x / CHUNK), cx1 = Math.floor((x + w - 1) / CHUNK);
    const cy0 = Math.floor(y / CHUNK), cy1 = Math.floor((y + h - 1) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) fn(cx, cy);
  };

  return {
    setCamera(x, y) {
      rect.x = Math.floor(x) - (width >> 1);
      rect.y = Math.floor(0.8 * y) - (height >> 1);
    },
    frame(out, t, flier) {
      compose(read, palette, rect, out, undefined, haze, bakeBuffer);
      runLayers(
        opts.layers ?? [],
        { out, bake: bakeBuffer, rect, t: t ?? 0, palette, n, bakeVersion: received, flier },
        disabled,
        opts.onLayerError,
      );
      if (opts.paper !== false) paperGrain(out, rect, mask);
    },
    depthAt(px, py) {
      const bx = rect.x + Math.floor(px), by = rect.y + Math.floor(py);
      const cx = Math.floor(bx / CHUNK), cy = Math.floor(by / CHUNK);
      const hit = read(cx, cy);
      if (!hit) return by / 0.8;
      const v = hit[(by - cy * CHUNK) * CHUNK + (bx - cx * CHUNK)];
      return cy * CHUNK_ROWS + (v >>> 16) / 8;
    },
    groundHeight(x, y) {
      upsampleGround(data.ground, data.gN, Math.floor(x), Math.floor(y), 1, 1, groundSample);
      const e = groundSample[0];
      return e < 0 ? 0 : e;
    },
    occlusionFloor(x, y) {
      const block = data.block;
      if (block === 0) return 0;
      const bN = n / block;
      return data.occlusion[wrap(Math.floor(y / block), bN) * bN + wrap(Math.floor(x / block), bN)];
    },
    sites() {
      return sites;
    },
    bakeFrame() {
      return bakeBuffer;
    },
    rect() {
      return { ...rect };
    },
    stats() {
      return { chunks: received, bakeMs: pool.stats().bakeMs };
    },
    update(vx, vy) {
      const list: ChunkWant[] = [];
      const best = new Map<string, ChunkWant>();
      // One entry per wrapped chunk, keeping the lowest priority. Cached chunks are never asked for.
      const consider = (cx: number, cy: number, priority: number): void => {
        const wx = wrap(cx, periodX), wy = wrap(cy, periodY);
        const key = `${wx},${wy}`;
        if (cache.has(key)) return;
        const prev = best.get(key);
        if (prev) {
          if (priority < prev.priority) prev.priority = priority;
          return;
        }
        const want: ChunkWant = { cx: wx, cy: wy, priority };
        best.set(key, want);
        list.push(want);
      };

      const cx0 = Math.floor(rect.x / CHUNK), cx1 = Math.floor((rect.x + width - 1) / CHUNK);
      const cy0 = Math.floor(rect.y / CHUNK), cy1 = Math.floor((rect.y + height - 1) / CHUNK);
      const rcx = rect.x + width / 2, rcy = rect.y + height / 2;
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const dx = ((cx + 0.5) * CHUNK - rcx) / CHUNK, dy = ((cy + 0.5) * CHUNK - rcy) / CHUNK;
        const d = Math.sqrt(dx * dx + dy * dy);
        consider(cx, cy, d / (d + 1));
      }

      // Bake space moves (vx, 0.8·vy) pixels a second. Sample the rect every quarter second it will occupy.
      if (vx !== 0 || vy !== 0) {
        for (let i = 1; ; i++) {
          const t = i / 4;
          if (t > lookahead) break;
          eachChunk(rect.x + vx * t, rect.y + 0.8 * vy * t, width, height, (cx, cy) => consider(cx, cy, 1 + t));
        }
      }

      const around = 2 + lookahead;
      for (let cy = cy0 - 1; cy <= cy1 + 1; cy++) for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) consider(cx, cy, around);
      pool.want(list);
    },
    ready() {
      let ok = true;
      eachChunk(rect.x, rect.y, width, height, (cx, cy) => {
        if (!cache.has(keyOf(cx, cy))) ok = false;
      });
      return ok;
    },
    cached() {
      return cache.size;
    },
  };
}
