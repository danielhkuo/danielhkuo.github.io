// What a bake worker holds: the decoded world, the look and the tile cache.
// bake.worker.ts wraps this in a message loop; tests call it directly.

import { bakeChunk, tileCache } from "../bake/chunk.ts";
import { worldLook } from "../bake/look.ts";
import { decodeWorld } from "../pack/world.ts";
import { buildPalette } from "../render/palette.ts";

/** Decodes `bin` and returns a function that bakes chunk (cx, cy) as bakeChunk does. */
export async function createBakeHost(bin: Uint8Array, mask: Uint8Array): Promise<(cx: number, cy: number) => Uint32Array> {
  const world = await decodeWorld(bin);
  const look = worldLook(world.n, buildPalette({ time: 0.5, season: 0.25, overcast: 0 }));
  const tiles = tileCache(world, look, mask, 24);
  // Chunk coordinates arrive already wrapped.
  return (cx, cy) => bakeChunk(world, look, mask, tiles, cx, cy);
}
