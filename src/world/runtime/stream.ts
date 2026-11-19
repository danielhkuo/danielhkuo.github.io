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
import { composeArea, CREAM, paperGrain, type ViewRect } from "../render/compose.ts";
import { hazeOf } from "../render/haze.ts";
import { runLayers, type Flier, type LiveLayer } from "../live/live.ts";
import type { Air } from "../sky/air.ts";
import type { BakePool, ChunkWant } from "./pool.ts";
import type { RegionLand } from "./regionLand.ts";
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
  /**
   * Keep the last frame's land and, after a short slide, compose only the strips it exposed (default true). False
   * composes the whole view every frame: the plain path the tests hold the kept land to.
   */
  slideLand?: boolean;
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
  /**
   * Draws the land through `palette` from the next frame on, with `cream` (packed RGBA, the paper in the same light)
   * showing through the grain and under the haze, and hands `air` to the live layers. A new palette composes the whole
   * view again; the same one changes nothing.
   */
  setLight(palette: Palette, cream: number, air?: Air): void;
  /**
   * Makes the frame width × height from the next one on, kept on the same camera point. The chunks stay cached; the
   * next frame composes the whole view afresh.
   */
  resize(width: number, height: number): void;
}

function isRegionLand(data: FlightData | RegionLand): data is RegionLand {
  return "want" in data;
}

/** n must be a multiple of 320, so the bake wraps on whole chunks both ways. */
export function createStreamView(data: FlightData | RegionLand, pool: BakePool, initial: Palette, mask: Uint8Array, opts: StreamOptions): StreamView {
  const n = data.n;
  if (n % 320 !== 0) throw new Error("n must be a multiple of 320");
  let width = opts.width, height = opts.height;
  const capacity = opts.cacheChunks ?? STREAM_CACHE;
  const lookahead = opts.lookahead ?? LOOKAHEAD;
  // Bake space is  n × 0.8·n  pixels; both axes then span a whole number of chunks.
  const periodX = n / CHUNK;
  const periodY = n / 320;
  const cache = new Map<string, Uint32Array>();
  let received = 0;
  const rect: ViewRect = { x: -(width >> 1), y: -(height >> 1), w: width, h: height };
  let palette = initial;
  let cream = CREAM;
  let air: Air | undefined;
  const hazeFor = (p: Palette, c: number): ((bx: number, by: number) => number) => (isRegionLand(data) ? data.haze(p, c) : hazeOf(data, p, c));
  let haze = hazeFor(palette, cream);
  const groundSample = new Float32Array(1);
  const sites: Site[] = (opts.sites ?? []).map((s) => ({ x: s.x, y: s.y, type: s.type, project: null }));
  let bakeBuffer = new Uint32Array(width * height);
  // The land of the last frame, composed (palette colours, before the live layers), with bakeBuffer to match. A frame
  // whose rect slid less than its own size slides both and composes only the strips it exposed. It holds while the
  // chunks are the ones it was composed from (no chunk arrived or left since: `received`) and it showed no haze.
  let land = new Uint32Array(width * height);
  let landX = 0, landY = 0;
  let landVersion = -1;
  let landWhole = false;
  const slideLand = opts.slideLand !== false;
  const disabled = new Set<string>();
  /** depthAt's last chunk found (unwrapped coordinates). */
  let depthCx = NaN, depthCy = NaN;
  let depthHit: Uint32Array | null = null;

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

  /** Cached pixels for an unwrapped chunk, or null, without counting it as a use. */
  const peek = (cx: number, cy: number): Uint32Array | null => cache.get(keyOf(cx, cy)) ?? null;

  /**
   * bakeSpace's last few chunks looked up (unwrapped coordinates; null where none was baked), round robin. A layer
   * reading round all four sides of the frame goes from chunk to chunk; these spare it building a key each time. They
   * hold while no chunk has arrived or left since (`received`).
   */
  const SPACE_SLOTS = 4;
  const spaceCx = new Float64Array(SPACE_SLOTS).fill(NaN), spaceCy = new Float64Array(SPACE_SLOTS).fill(NaN);
  const spaceHit: (Uint32Array | null)[] = new Array<Uint32Array | null>(SPACE_SLOTS).fill(null);
  let spaceAt = -1, spaceNext = 0;
  /**
   * The bake pixel at bake-space (bx, by), whole numbers, from the cache (0 where the chunk is not baked): what the
   * live layers read past the frame's edges. Never counted as a use, so the cache keeps and drops what it did before.
   */
  const bakeSpace = (bx: number, by: number): number => {
    const cx = Math.floor(bx / CHUNK), cy = Math.floor(by / CHUNK);
    if (spaceAt !== received) {
      spaceCx.fill(NaN);
      spaceAt = received;
    }
    let hit: Uint32Array | null = null, s = 0;
    for (; s < SPACE_SLOTS; s++) {
      if (spaceCx[s] === cx && spaceCy[s] === cy) {
        hit = spaceHit[s];
        break;
      }
    }
    if (s === SPACE_SLOTS) {
      hit = peek(cx, cy);
      s = spaceNext;
      spaceNext = (spaceNext + 1) % SPACE_SLOTS;
      spaceCx[s] = cx;
      spaceCy[s] = cy;
      spaceHit[s] = hit;
    }
    return hit === null ? 0 : hit[(by - cy * CHUNK) * CHUNK + (bx - cx * CHUNK)];
  };

  const eachChunk = (x: number, y: number, w: number, h: number, fn: (cx: number, cy: number) => void): void => {
    const cx0 = Math.floor(x / CHUNK), cx1 = Math.floor((x + w - 1) / CHUNK);
    const cy0 = Math.floor(y / CHUNK), cy1 = Math.floor((y + h - 1) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) fn(cx, cy);
  };

  /** Composes the view's land into `land` and bakeBuffer: only the strips a short slide exposed, when it can. */
  const composeLand = (): void => {
    // Every chunk under the view counts as used, in the order a whole compose asks for them, so the cache keeps and
    // drops the same chunks however little is composed.
    const cx0 = Math.floor(rect.x / CHUNK), cx1 = Math.floor((rect.x + width - 1) / CHUNK);
    const cy0 = Math.floor(rect.y / CHUNK), cy1 = Math.floor((rect.y + height - 1) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) read(cx, cy);
    const dx = rect.x - landX, dy = rect.y - landY;
    if (slideLand && landWhole && landVersion === received && dx > -width && dx < width && dy > -height && dy < height) {
      if (dx !== 0 || dy !== 0) {
        // Pixel (c, r) takes the old (c + dx, r + dy). Moving the whole buffer by dy rows and dx pixels does that for
        // every pixel whose old place was on the frame; the rest wrapped round a row edge, and are composed again.
        const d = dy * width + dx, size = width * height;
        if (d > 0) {
          land.copyWithin(0, d, size);
          bakeBuffer.copyWithin(0, d, size);
        } else {
          land.copyWithin(-d, 0, size + d);
          bakeBuffer.copyWithin(-d, 0, size + d);
        }
        const ry0 = dy > 0 ? height - dy : 0, ry1 = dy > 0 ? height : -dy;
        let whole = composeArea(peek, palette, rect, land, 0, ry0, width, ry1, haze, bakeBuffer);
        if (dx !== 0) {
          // The columns the slide exposed, on the rows the strip above did not cover.
          const cx0s = dx > 0 ? width - dx : 0, cx1s = dx > 0 ? width : -dx;
          const ky0 = dy > 0 ? 0 : -dy, ky1 = dy > 0 ? height - dy : height;
          whole = composeArea(peek, palette, rect, land, cx0s, ky0, cx1s, ky1, haze, bakeBuffer) && whole;
        }
        landWhole = whole;
      }
    } else {
      landWhole = composeArea(peek, palette, rect, land, 0, 0, width, height, haze, bakeBuffer);
    }
    landX = rect.x;
    landY = rect.y;
    landVersion = received;
  };

  return {
    setCamera(x, y) {
      rect.x = Math.floor(x) - (width >> 1);
      rect.y = Math.floor(0.8 * y) - (height >> 1);
    },
    frame(out, t, flier) {
      composeLand();
      out.set(land);
      runLayers(
        opts.layers ?? [],
        { out, bake: bakeBuffer, rect, t: t ?? 0, palette, n, bakeVersion: received, flier, bakeSpace, air },
        disabled,
        opts.onLayerError,
      );
      if (opts.paper !== false) paperGrain(out, rect, mask, cream);
    },
    setLight(p, c, a) {
      air = a;
      if (p === palette && c === cream) return;
      palette = p;
      cream = c;
      haze = hazeFor(p, c);
      // The kept land was composed through the old palette: compose the whole view again.
      landWhole = false;
    },
    depthAt(px, py) {
      // The frame just drawn holds the bake pixel under each of its pixels: read it there while the view and the chunks
      // are as they were then (a 0 may be haze, so it is looked up in the chunk as before).
      if (landVersion === received && rect.x === landX && rect.y === landY && (px | 0) === px && (py | 0) === py && px >= 0 && py >= 0 && px < width && py < height) {
        const v = bakeBuffer[py * width + px];
        if (v !== 0) return Math.floor((rect.y + py) / CHUNK) * CHUNK_ROWS + (v >>> 16) / 8;
      }
      const bx = rect.x + Math.floor(px), by = rect.y + Math.floor(py);
      const cx = Math.floor(bx / CHUNK), cy = Math.floor(by / CHUNK);
      // Sprites ask for thousands of pixels a frame, mostly in one chunk. Reuse the last chunk found rather than build a
      // key and reorder the cache each time. A baked chunk never changes, so the memo stays right even once evicted.
      let hit: Uint32Array | null;
      if (cx === depthCx && cy === depthCy) hit = depthHit;
      else {
        hit = read(cx, cy);
        if (hit) {
          depthCx = cx;
          depthCy = cy;
          depthHit = hit;
        }
      }
      if (!hit) return by / 0.8;
      const v = hit[(by - cy * CHUNK) * CHUNK + (bx - cx * CHUNK)];
      return cy * CHUNK_ROWS + (v >>> 16) / 8;
    },
    groundHeight(x, y) {
      if (isRegionLand(data)) return data.groundHeight(x, y);
      upsampleGround(data.ground, data.gN, Math.floor(x), Math.floor(y), 1, 1, groundSample);
      const e = groundSample[0];
      return e < 0 ? 0 : e;
    },
    occlusionFloor(x, y) {
      if (isRegionLand(data)) return data.occlusionFloor(x, y);
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
    resize(w, h) {
      if (w === width && h === height) return;
      // The camera's point stays where it was: rect.x and rect.y are its corner, so move them by half the change.
      rect.x += (width >> 1) - (w >> 1);
      rect.y += (height >> 1) - (h >> 1);
      width = w;
      height = h;
      rect.w = w;
      rect.h = h;
      bakeBuffer = new Uint32Array(w * h);
      land = new Uint32Array(w * h);
      landWhole = false;
      landVersion = -1;
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
      if (isRegionLand(data)) {
        const worldX = rect.x + width / 2;
        const worldY = (rect.y + height / 2) / 0.8;
        // The view, the spline past its edge, and where the flier will be within `lookahead` seconds.
        const reach = Math.hypot(width / 2, (height / 2) / 0.8) + Math.hypot(vx, vy) * lookahead + 16;
        void data.want(worldX, worldY, reach).catch(() => {
          // Asked again next update; the haze stands in until the regions arrive.
        });
      }
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
