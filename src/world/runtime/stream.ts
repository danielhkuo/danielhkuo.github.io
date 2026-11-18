// The streaming view: the WorldView the flight page draws through. Chunks are
// baked by the worker pool; this view decides which ones it wants and how
// urgently, keeps the baked ones in a small cache, and draws the haze wherever a
// chunk has not arrived yet.

import type { Palette } from "../look/contract.ts";
import type { Manifest } from "../pack/manifest.ts";
import type { FlightData } from "../pack/world.ts";
import type { BakePool } from "./pool.ts";
import type { WorldView } from "./view.ts";

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
}

/** n must be a multiple of 320, so the bake wraps on whole chunks both ways. */
export function createStreamView(data: FlightData, pool: BakePool, palette: Palette, mask: Uint8Array, opts: StreamOptions): StreamView {
  void data;
  void pool;
  void palette;
  void mask;
  void opts;
  throw new Error("not implemented");
}
