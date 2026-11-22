// What a bake worker holds: the decoded world, the look and the tile cache.
// bake.worker.ts wraps this in a message loop; tests call it directly.

import type { BakeWorld } from "../bake/world.ts";
import { bakeChunk, tileCache } from "../bake/chunk.ts";
import { worldLook } from "../bake/look.ts";
import { decodeWorld } from "../pack/world.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";

function bakeHost(world: BakeWorld, mask: Uint8Array): (cx: number, cy: number) => Uint32Array {
  const look = worldLook(world.n, buildPalette(MIDDAY));
  const tiles = tileCache(world, look, mask, 24);
  // Chunk coordinates arrive already wrapped.
  return (cx, cy) => bakeChunk(world, look, mask, tiles, cx, cy);
}

/** Bakes chunk (cx, cy) from an already decoded world, as bakeChunk does. */
export function createWorldBakeHost(world: BakeWorld, mask: Uint8Array): (cx: number, cy: number) => Uint32Array {
  return bakeHost(world, mask);
}

/** Decodes `bin` and returns a function that bakes chunk (cx, cy) as bakeChunk does. */
export async function createBakeHost(bin: Uint8Array, mask: Uint8Array): Promise<(cx: number, cy: number) => Uint32Array> {
  return bakeHost(await decodeWorld(bin), mask);
}
