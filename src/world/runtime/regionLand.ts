// The land the page flies over, for a world shipped in regions (pack/regions.ts): ground heights near the flier
// from decoded regions, the core's overview elsewhere, the occlusion floor and the haze from the core. It stands in
// for FlightData, which held the whole ground.

import { upsampleGround } from "../bake/cells.ts";
import { wrap } from "../core/torus.ts";
import type { Palette } from "../look/contract.ts";
import { decodeRegion, type Core, type RegionGrids } from "../pack/regions.ts";
import { hazeFromSamples } from "../render/haze.ts";

export interface RegionLand {
  n: number;
  /** Ground height at cell (x, y), 0 at or below the sea: exact (as the whole world's) where its regions are loaded, the core's overview elsewhere. */
  groundHeight(x: number, y: number): number;
  /** The occlusion floor under cell (x, y), from the core. */
  occlusionFloor(x: number, y: number): number;
  /** The haze for unbaked chunks, from the core's overview: packed RGBA at bake pixel (bx, by), anywhere on the torus. */
  haze(palette: Palette): (bx: number, by: number) => number;
  /**
   * Fetches and decodes the regions within `reach` cells of (x, y) on the torus that are not loaded or in flight,
   * nearest first; resolves when all of them are loaded. A failed fetch rejects; the region can be wanted again.
   */
  want(x: number, y: number, reach: number): Promise<void>;
  /** Regions decoded and held. */
  loaded(): number;
}

export interface RegionLandOptions {
  /** Decoded regions kept, most recently wanted first; default 16. */
  capacity?: number;
}

export function createRegionLand(core: Core, fetchRegion: (rx: number, ry: number) => Promise<Uint8Array>, opts: RegionLandOptions = {}): RegionLand {
  const n = core.world.n;
  const gN = core.world.gN;
  const side = core.side;
  const regionCells = core.regionCells;
  const gS = regionCells / 4;
  const capacity = opts.capacity ?? 16;
  const oN = n / 8;
  // Oldest first, so the most recently wanted region is last.
  const cache = new Map<number, RegionGrids>();
  const inflight = new Map<number, Promise<RegionGrids>>();
  const scratch = new Float32Array(16);
  const sample = new Float32Array(1);

  const keyOf = (rx: number, ry: number): number => ry * side + rx;

  const remember = (key: number, grids: RegionGrids): void => {
    cache.delete(key);
    cache.set(key, grids);
  };

  const trim = (): void => {
    while (cache.size > capacity) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  /** Distance from (x, y) to the nearest cell of the region, on the torus. */
  const regionDist = (rx: number, ry: number, x: number, y: number): number => {
    const axis = (lo: number, p: number): number => {
      const m = ((p - lo) % n + n) % n;
      return m < regionCells ? 0 : Math.min(m - (regionCells - 1), n - m);
    };
    return Math.hypot(axis(rx * regionCells, x), axis(ry * regionCells, y));
  };

  const load = (rx: number, ry: number): Promise<RegionGrids> => {
    const key = keyOf(rx, ry);
    const held = cache.get(key);
    if (held) return Promise.resolve(held);
    const pending = inflight.get(key);
    if (pending) return pending;
    // Only the ground is read here; the stamps are for the bake workers, and decoding them would cost the page.
    const job = fetchRegion(rx, ry).then((bin) => decodeRegion(bin, core, { stamps: false }));
    // The callback runs after `tracked` is assigned: a rejection must leave the region free to fetch again.
    const tracked: Promise<RegionGrids> = job.finally(() => {
      if (inflight.get(key) === tracked) inflight.delete(key);
    });
    inflight.set(key, tracked);
    return tracked;
  };

  const overviewAt = (x: number, y: number): number => {
    const ox = wrap(Math.floor(x / 8), oN);
    const oy = wrap(Math.floor(y / 8), oN);
    return core.overview[oy * oN + ox];
  };

  return {
    n,
    groundHeight(x, y) {
      const cx = Math.floor(x), cy = Math.floor(y);
      const jx = Math.floor((cx + 0.5) / 4 - 0.5);
      const jy = Math.floor((cy + 0.5) / 4 - 0.5);
      for (let row = 0; row < 4; row++) {
        const gy = wrap(jy - 1 + row, gN);
        const ry = Math.floor(gy / gS);
        const ly = gy - ry * gS;
        for (let col = 0; col < 4; col++) {
          const gx = wrap(jx - 1 + col, gN);
          const rx = Math.floor(gx / gS);
          const reg = cache.get(keyOf(rx, ry));
          if (!reg) return overviewAt(x, y);
          scratch[row * 4 + col] = reg.ground[ly * gS + (gx - rx * gS)];
        }
      }
      // The 4×4 nodes, in stencil order, so the windowed upsample matches the whole grid.
      upsampleGround(scratch, gN, cx, cy, 1, 1, sample, { x0: jx - 1, y0: jy - 1, w: 4, h: 4 });
      const e = sample[0];
      return e < 0 ? 0 : e;
    },
    occlusionFloor(x, y) {
      const block = core.block;
      if (block === 0) return 0;
      const bN = n / block;
      return core.occlusion[wrap(Math.floor(y / block), bN) * bN + wrap(Math.floor(x / block), bN)];
    },
    haze(palette) {
      return hazeFromSamples(core.overview, n, palette);
    },
    async want(x, y, reach) {
      const list: { rx: number; ry: number; key: number; d: number }[] = [];
      for (let ry = 0; ry < side; ry++) for (let rx = 0; rx < side; rx++) {
        const d = regionDist(rx, ry, x, y);
        if (d <= reach) list.push({ rx, ry, key: keyOf(rx, ry), d });
      }
      list.sort((a, b) => a.d - b.d);
      const got = new Map<number, RegionGrids>();
      let failure: unknown;
      const settled = await Promise.allSettled(list.map(async (r) => {
        const g = await load(r.rx, r.ry);
        return { key: r.key, g };
      }));
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        if (s.status === "fulfilled") got.set(s.value.key, s.value.g);
        else if (failure === undefined) failure = s.reason;
      }
      // Farthest first, so the nearest stay when the cache trims.
      for (let i = list.length - 1; i >= 0; i--) {
        const g = got.get(list[i].key);
        if (g) remember(list[i].key, g);
      }
      trim();
      if (failure !== undefined) throw failure;
    },
    loaded() {
      return cache.size;
    },
  };
}
