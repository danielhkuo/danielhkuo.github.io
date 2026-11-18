// What a bake worker holds for a world shipped in regions (pack/regions.ts): the decoded core, a small cache of
// decoded regions, and a tile cache that bakes each tile from a window cut from those regions (bake/window.ts).
// It bakes the same bytes as bakeHost.ts does from the whole world.

/** The tiles bakeChunk reads for chunk (cx, cy): wrapped into [0, n / 256), each once. */
export function tilesForChunk(n: number, cx: number, cy: number): { tx: number; ty: number }[] {
  void n, cx, cy;
  throw new Error("not implemented");
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
  void coreBin, fetchRegion, mask, opts;
  throw new Error("not implemented");
}
