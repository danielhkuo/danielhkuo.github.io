import assert from "node:assert/strict";
import { test } from "node:test";
import { bakeChunk, tileCache, type TileSource } from "../bake/chunk.ts";
import { worldLook } from "../bake/look.ts";
import { encodeTiled } from "../pack/regions.ts";
import { decodeWorld, encodeWorld } from "../pack/world.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { generatedWorld, loadMask } from "../testing/bakefix.ts";
import { createBakeHost } from "./bakeHost.ts";
import { createTiledBakeHost, tilesForChunk } from "./tiledHost.ts";

const mask = loadMask();

async function tiledWorld(regionCells: number) {
  const w = generatedWorld();
  const tiled = await encodeTiled(w, { regionCells });
  const files = new Map(tiled.regions.map((r) => [`${r.rx},${r.ry}`, r.bin]));
  const fetched: string[] = [];
  const fetchRegion = async (rx: number, ry: number): Promise<Uint8Array> => {
    const key = `${rx},${ry}`;
    fetched.push(key);
    const bin = files.get(key);
    if (!bin) throw new Error(`no region ${key}`);
    return bin;
  };
  return { tiled, fetchRegion, fetched };
}

test("tilesForChunk lists every tile bakeChunk reads, each once, wrapped", () => {
  const w = generatedWorld(), look = worldLook(w.n, buildPalette(MIDDAY));
  const whole = tileCache(w, look, mask, 40);
  const nT = w.n / 256;
  for (let cy = 0; cy < w.n / 320; cy++) for (let cx = 0; cx < nT; cx++) {
    const asked = new Set<string>();
    const spy: TileSource = (tx, ty) => {
      asked.add(`${((tx % nT) + nT) % nT},${((ty % nT) + nT) % nT}`);
      return whole(tx, ty);
    };
    bakeChunk(w, look, mask, spy, cx, cy);
    const listed = tilesForChunk(w.n, cx, cy).map((t) => `${t.tx},${t.ty}`);
    assert.equal(new Set(listed).size, listed.length, "each tile once");
    for (const t of listed) {
      const [tx, ty] = t.split(",").map(Number);
      assert.ok(tx >= 0 && tx < nT && ty >= 0 && ty < nT, `wrapped: ${t}`);
    }
    for (const t of asked) assert.ok(listed.includes(t), `chunk ${cx},${cy} reads tile ${t}, not listed`);
  }
});

test("the tiled host bakes the same bytes as the whole-world host, for every chunk", async () => {
  const { tiled, fetchRegion } = await tiledWorld(320);
  const { bin } = await encodeWorld(generatedWorld());
  const whole = await createBakeHost(bin, mask);
  const host = await createTiledBakeHost(tiled.core.bin, fetchRegion, mask);
  const w = await decodeWorld(bin);
  for (let cy = 0; cy < w.n / 320; cy++) for (let cx = 0; cx < w.n / 256; cx++) {
    assert.deepEqual(await host(cx, cy), whole(cx, cy), `chunk ${cx},${cy}`);
  }
});

test("each region is fetched once while it stays cached, and only regions a chunk needs", async () => {
  const { tiled, fetchRegion, fetched } = await tiledWorld(320);
  const host = await createTiledBakeHost(tiled.core.bin, fetchRegion, mask, { regionCapacity: 16 });
  await host(1, 1);
  const first = fetched.length;
  assert.ok(first > 0 && first < 16, `one chunk needs a few regions, fetched ${first}`);
  await host(1, 1);
  await host(2, 1);
  assert.equal(new Set(fetched).size, fetched.length, "no region fetched twice while there is room");
});

test("with a small region cache the host still bakes correctly, fetching again what it dropped", async () => {
  const { tiled, fetchRegion, fetched } = await tiledWorld(320);
  const { bin } = await encodeWorld(generatedWorld());
  const whole = await createBakeHost(bin, mask);
  const host = await createTiledBakeHost(tiled.core.bin, fetchRegion, mask, { regionCapacity: 6 });
  for (const [cx, cy] of [[0, 0], [3, 2], [0, 0], [4, 3], [1, 1]]) {
    assert.deepEqual(await host(cx, cy), whole(cx, cy), `chunk ${cx},${cy}`);
  }
  assert.ok(new Set(fetched).size < fetched.length, "dropped regions were fetched again");
});

test("chunks asked for at once share their region fetches", async () => {
  const { tiled, fetchRegion, fetched } = await tiledWorld(320);
  const host = await createTiledBakeHost(tiled.core.bin, fetchRegion, mask, { regionCapacity: 16 });
  await Promise.all([host(1, 1), host(1, 1), host(2, 1)]);
  assert.equal(new Set(fetched).size, fetched.length, "a region in flight is not fetched again");
});

test("a failed region fetch rejects that chunk, and a later ask retries", async () => {
  const { tiled, fetchRegion } = await tiledWorld(320);
  let fail = true;
  const flaky = async (rx: number, ry: number): Promise<Uint8Array> => {
    if (fail) throw new Error("offline");
    return fetchRegion(rx, ry);
  };
  const host = await createTiledBakeHost(tiled.core.bin, flaky, mask);
  await assert.rejects(host(1, 1));
  fail = false;
  const px = await host(1, 1);
  assert.equal(px.length, 256 * 256);
});
