import assert from "node:assert/strict";
import { test } from "node:test";
import { bakeChunk, tileCache } from "../bake/chunk.ts";
import { worldLook } from "../bake/look.ts";
import { decodeWorld, encodeWorld } from "../pack/world.ts";
import { buildPalette } from "../render/palette.ts";
import { generatedWorld, loadMask } from "../testing/bakefix.ts";
import { createBakeHost } from "./bakeHost.ts";

test("the host bakes the same bytes as bakeChunk on the decoded world", async () => {
  const mask = loadMask();
  const { bin } = await encodeWorld(generatedWorld());
  const host = await createBakeHost(bin, mask);
  const world = await decodeWorld(bin);
  const look = worldLook(world.n, buildPalette({ time: 0.5, season: 0.25, overcast: 0 }));
  const tiles = tileCache(world, look, mask, 24);
  for (const [cx, cy] of [[1, 1], [0, 3], [1, 2]]) {
    assert.deepEqual(host(cx, cy), bakeChunk(world, look, mask, tiles, cx, cy), `chunk ${cx},${cy}`);
  }
});
