// What a bake worker holds for a world shipped in regions (pack/regions.ts): the decoded core, a small cache of
// decoded regions, and a tile cache that bakes each tile from a window cut from those regions (bake/window.ts).
// It bakes the same bytes as bakeHost.ts does from the whole world.

import { bakeChunk, CHUNK, type TileSource } from "../bake/chunk.ts";
import { buildTile, TILE } from "../bake/cells.ts";
import { worldLook } from "../bake/look.ts";
import { windowTileSource, tileWindows } from "../bake/window.ts";
import { HMAX, RIVER_BUCKET } from "../bake/world.ts";
import { wrap } from "../core/torus.ts";
import { RIVER_PIECE_REACH } from "../bake/lines.ts";
import { cutFromRegions, decodeCore, decodeRegion, regionsFor, type RegionGrids } from "../pack/regions.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";

// bakeWindow paints this far outside the chunk (chunk.ts). Not exported there.
const MX = 16;
const MT = 32;
const MB = 32;
// drawLines reads this many world rows past the paint, and a segment is emitted whole (lines.ts).
const LINE = 4;

/** The tiles bakeChunk reads for chunk (cx, cy): wrapped into [0, n / 256), each once. */
export function tilesForChunk(n: number, cx: number, cy: number): { tx: number; ty: number }[] {
  const span = chunkSpan(cx, cy);
  const txs = indicesCovering(span.minX, span.maxX, n, TILE);
  const tys = indicesCovering(span.minY, span.maxY, n, TILE);
  const nT = n / TILE;
  const seen = new Set<number>();
  const out: { tx: number; ty: number }[] = [];
  for (let i = 0; i < tys.length; i++) {
    for (let j = 0; j < txs.length; j++) {
      const key = tys[i] * nT + txs[j];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tx: txs[j], ty: tys[i] });
    }
  }
  return out;
}

export interface TiledHostOptions {
  /** Decoded regions kept (most recently used); default 12. */
  regionCapacity?: number;
  /** Tiles kept; default 24. */
  tileCapacity?: number;
}

/**
 * Decodes the core and returns a function that bakes chunk (cx, cy) as bakeChunk does on the whole world. Before
 * baking it fetches (once, sharing fetches already in flight) and decodes every region the chunk's tiles need. A failed
 * fetch rejects that chunk only; a later ask tries again.
 */
export async function createTiledBakeHost(
  coreBin: Uint8Array,
  fetchRegion: (rx: number, ry: number) => Promise<Uint8Array>,
  mask: Uint8Array,
  opts: TiledHostOptions = {},
): Promise<(cx: number, cy: number) => Promise<Uint32Array>> {
  const core = await decodeCore(coreBin);
  const look = worldLook(core.world.n, buildPalette(MIDDAY));
  const regionCapacity = opts.regionCapacity ?? 12;
  const tileCapacity = opts.tileCapacity ?? 24;
  const n = core.world.n;
  const side = core.side;
  const regions = new Map<number, RegionGrids>();
  const flying = new Map<number, Promise<RegionGrids>>();
  const blanks = new Map<number, RegionGrids>();

  const keyOf = (rx: number, ry: number): number => ry * side + rx;

  const remember = (key: number, grids: RegionGrids): void => {
    regions.delete(key);
    regions.set(key, grids);
    while (regions.size > regionCapacity) {
      const oldest = regions.keys().next();
      if (oldest.done) break;
      regions.delete(oldest.value);
    }
  };

  const load = (rx: number, ry: number): Promise<RegionGrids> => {
    const key = keyOf(rx, ry);
    const hit = regions.get(key);
    if (hit) {
      regions.delete(key);
      regions.set(key, hit);
      return Promise.resolve(hit);
    }
    const pending = flying.get(key);
    if (pending) return pending;
    const job = fetchRegion(rx, ry).then((bin) => decodeRegion(bin, core)).then((grids) => {
      remember(key, grids);
      return grids;
    });
    flying.set(key, job);
    // Drop the promise when it settles, including a rejection, so a later ask fetches again.
    void job.then(() => {
      if (flying.get(key) === job) flying.delete(key);
    }, () => {
      if (flying.get(key) === job) flying.delete(key);
    });
    return job;
  };

  const ensure = async (need: { rx: number; ry: number }[]): Promise<void> => {
    const want = new Set(need.map((r) => keyOf(r.rx, r.ry)));
    for (let pass = 0; pass < need.length + 2; pass++) {
      const missing: { rx: number; ry: number }[] = [];
      for (let i = 0; i < need.length; i++) {
        const r = need[i];
        const key = keyOf(r.rx, r.ry);
        const hit = regions.get(key);
        if (hit) {
          regions.delete(key);
          regions.set(key, hit);
        } else missing.push(r);
      }
      if (missing.length === 0) return;
      let held = 0;
      for (const k of regions.keys()) if (want.has(k)) held++;
      // A set larger than the cache cannot all sit resident. Bake with what fits; the cut fills the rest empty.
      if (held >= regionCapacity) return;
      await Promise.all(missing.map((r) => load(r.rx, r.ry)));
    }
  };

  const regionAt = (rx: number, ry: number): RegionGrids => {
    const key = keyOf(rx, ry);
    const hit = regions.get(key);
    if (hit) return hit;
    const blank = blanks.get(key);
    if (blank) return blank;
    const gS = core.regionCells / 4;
    const cS = core.regionCells / 8;
    const g2 = gS * gS;
    const c2 = cS * cS;
    const empty: RegionGrids = {
      rx, ry,
      ground: new Float32Array(g2),
      base: core.world.base ? new Float32Array(g2) : undefined,
      conform: core.world.conform ? new Float32Array(g2) : undefined,
      waterLevel: new Float32Array(g2),
      waterKind: new Uint8Array(g2),
      hand: new Float32Array(g2),
      shore: new Uint8Array(g2),
      moisture: new Float32Array(c2),
      wind: new Float32Array(c2),
      exposure: new Float32Array(c2),
      debris: new Float32Array(c2),
      rock: new Uint8Array(c2),
      regions: new Float32Array(c2 * 6),
      // A stand-in is temperate: the plateau's own value, so nothing of another climate shows before the region loads.
      temp: core.world.temp ? new Float32Array(c2).fill(0.5) : undefined,
      arid: core.world.arid ? new Float32Array(c2) : undefined,
      stamps: core.world.stamps ? { index: new Uint32Array(0), list: [] } : undefined,
    };
    blanks.set(key, empty);
    return empty;
  };

  // Tiles built while every region of the window was real. Same MRU rule as windowTileSource. A hit stays valid
  // after those regions leave the region cache: the tile holds baked cells. A tile built against an empty stand-in
  // is kept only for the bake in progress (`open`), so a later chunk can rebuild it once the region is loaded.
  const kept = new Map<number, ReturnType<typeof buildTile>>();
  let open = new Map<number, ReturnType<typeof buildTile>>();
  const baked = windowTileSource(core.world, (g, c) => cutFromRegions(core, (rx, ry) => {
    const hit = regions.get(keyOf(rx, ry));
    if (!hit) throw new Error("missing region");
    return hit;
  }, g, c), look, mask, tileCapacity);

  const tiles: TileSource = (tx, ty) => {
    const nT = n / TILE;
    const wx = wrap(tx, nT);
    const wy = wrap(ty, nT);
    const key = wy * nT + wx;
    const hit = kept.get(key);
    if (hit) {
      kept.delete(key);
      kept.set(key, hit);
      return hit;
    }
    const again = open.get(key);
    if (again) return again;
    const { g, c } = tileWindows(core.world, wx, wy);
    const need = regionsFor(core, g, c);
    let complete = true;
    for (let i = 0; i < need.length; i++) {
      if (!regions.has(keyOf(need[i].rx, need[i].ry))) { complete = false; break; }
    }
    if (complete) {
      const tile = baked(wx, wy);
      kept.delete(key);
      kept.set(key, tile);
      while (kept.size > tileCapacity) {
        const oldest = kept.keys().next();
        if (oldest.done) break;
        kept.delete(oldest.value);
      }
      return tile;
    }
    const tile = buildTile(cutFromRegions(core, regionAt, g, c), look, mask, wx, wy);
    open.set(key, tile);
    return tile;
  };

  const regionsForChunk = (cx: number, cy: number): { rx: number; ry: number }[] => {
    const span = chunkSpan(cx, cy);
    const foot = new Set<number>();
    const rxs = indicesCovering(span.minX, span.maxX, n, core.regionCells);
    const rys = indicesCovering(span.minY, span.maxY, n, core.regionCells);
    for (let y = 0; y < rys.length; y++) for (let x = 0; x < rxs.length; x++) foot.add(rys[y] * side + rxs[x]);
    const out: { rx: number; ry: number }[] = [];
    const seen = new Set<number>();
    const list = tilesForChunk(n, cx, cy);
    for (let i = 0; i < list.length; i++) {
      const { g, c } = tileWindows(core.world, list[i].tx, list[i].ty);
      const got = regionsFor(core, g, c);
      for (let k = 0; k < got.length; k++) {
        const id = keyOf(got[k].rx, got[k].ry);
        if (!foot.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(got[k]);
      }
    }
    for (const id of foot) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ rx: id % side, ry: Math.floor(id / side) });
    }
    return out;
  };

  return async (cx, cy) => {
    await ensure(regionsForChunk(cx, cy));
    open = new Map();
    return bakeChunk(core.world, look, mask, tiles, cx, cy);
  };
}

/** Cells bakeChunk samples for chunk (cx, cy), in world coordinates (they may lie outside [0, n)). */
function chunkSpan(cx: number, cy: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const x0 = cx * CHUNK - MX;
  const r0 = cy * CHUNK - MT;
  const w = CHUNK + 2 * MX;
  const h = CHUNK + MT + MB;
  const yFirst = Math.ceil((5 * r0) / 4);
  const yLast = Math.ceil((5 * (r0 + h + HMAX)) / 4) - 1;
  // drawLines' window is [yFirst - LINE, yLast + 1 + LINE), then a whole segment may stick out of its buckets.
  const y0 = yFirst - LINE;
  const y1 = yLast + 1 + LINE;
  const by0 = Math.floor((y0 - RIVER_PIECE_REACH) / RIVER_BUCKET);
  const by1 = Math.floor((y1 + RIVER_PIECE_REACH) / RIVER_BUCKET);
  return {
    minX: x0,
    maxX: x0 + w - 1,
    minY: by0 * RIVER_BUCKET - RIVER_PIECE_REACH,
    maxY: (by1 + 1) * RIVER_BUCKET - 1 + RIVER_PIECE_REACH,
  };
}

/** Wrapped indices of `size` covering [min, max], each once, in walk order. */
function indicesCovering(min: number, max: number, n: number, size: number): number[] {
  const nT = n / size;
  if (max - min + 1 >= n) {
    const all: number[] = [];
    for (let t = 0; t < nT; t++) all.push(t);
    return all;
  }
  const out: number[] = [];
  const seen = new Set<number>();
  for (let v = min; v <= max;) {
    const w = wrap(v, n);
    const t = Math.floor(w / size);
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
    const step = (t + 1) * size - w;
    v += step > 0 ? step : size;
  }
  return out;
}
