import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "../pack/codec.ts";
import type { Manifest } from "../pack/manifest.ts";
import { encodeTiled } from "../pack/regions.ts";
import { fieldWorld } from "../testing/bakefix.ts";
import { LOAD_FAILED, loadWorld, WorldLoadError } from "./load.ts";

const ID = "abcdef012345";

async function site() {
  const w = fieldWorld(1280, (x, y) => 20 + ((x + y) % 50));
  const occlusion = { block: 16, data: new Uint8Array((1280 / 16) ** 2).fill(7) };
  const tiled = await encodeTiled(w, { regionCells: 640, occlusion });
  const manifest: Manifest = {
    format: 2, worldId: ID, n: 1280, seed: 7, regionCells: 640,
    core: { bytes: tiled.core.bin.length, sha256: await sha256(tiled.core.bin) },
    regions: await Promise.all(tiled.regions.map(async (r) => ({ rx: r.rx, ry: r.ry, bytes: r.bin.length, sha256: await sha256(r.bin) }))),
    block: 16, sites: [], start: { x: 1, y: 2, dx: 0, dy: -1 },
  };
  const files = new Map<string, Uint8Array | string>([
    ["/world/current.json", JSON.stringify({ worldId: ID })],
    [`/world/${ID}/manifest.json`, JSON.stringify(manifest)],
    [`/world/${ID}/core.bin`, tiled.core.bin],
  ]);
  for (const r of tiled.regions) files.set(`/world/${ID}/regions/${r.rx}-${r.ry}.bin`, r.bin);
  return { w, tiled, manifest, files };
}

function fetcher(files: Map<string, Uint8Array | string>, log: string[] = []) {
  return async (url: string): Promise<Response> => {
    log.push(url);
    const body = files.get(url);
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body as BodyInit, { status: 200 });
  };
}

test("a good world loads: the manifest and the decoded core, fetching only the core", async () => {
  const { manifest, files } = await site();
  const log: string[] = [];
  const got = await loadWorld(fetcher(files, log), "/world");
  assert.deepEqual(got.manifest, manifest);
  assert.equal(got.coreUrl, `/world/${ID}/core.bin`);
  assert.equal(got.regionUrl(1, 0), `/world/${ID}/regions/1-0.bin`);
  assert.equal(got.core.world.n, 1280);
  assert.equal(got.core.block, 16);
  assert.equal(got.core.regionCells, 640);
  assert.deepEqual(log, ["/world/current.json", `/world/${ID}/manifest.json`, `/world/${ID}/core.bin`]);
});

test("a region is fetched on demand and checked against the manifest", async () => {
  const { tiled, files } = await site();
  const log: string[] = [];
  const got = await loadWorld(fetcher(files, log), "/world");
  const bin = await got.fetchRegion(1, 1);
  assert.deepEqual(bin, tiled.regions.find((r) => r.rx === 1 && r.ry === 1)!.bin);
  assert.equal(log.at(-1), `/world/${ID}/regions/1-1.bin`);
});

test("a damaged or missing region is refused with the load error", async () => {
  const { files } = await site();
  const key = `/world/${ID}/regions/0-1.bin`;
  const bad = (files.get(key) as Uint8Array).slice();
  bad[bad.length >> 1] ^= 0x5a;
  files.set(key, bad);
  const got = await loadWorld(fetcher(files), "/world");
  await assert.rejects(got.fetchRegion(0, 1), WorldLoadError);
  files.delete(`/world/${ID}/regions/1-0.bin`);
  await assert.rejects(got.fetchRegion(1, 0), WorldLoadError);
});

test("a missing world is one clear error", async () => {
  const { files } = await site();
  files.delete("/world/current.json");
  await assert.rejects(loadWorld(fetcher(files), "/world"), (e: unknown) => e instanceof WorldLoadError && e.message === LOAD_FAILED);
});

test("a stale id, a truncated core, an old-format manifest or bad JSON are refused", async () => {
  const stale = await site();
  stale.files.set("/world/current.json", JSON.stringify({ worldId: "000000000000" }));
  await assert.rejects(loadWorld(fetcher(stale.files), "/world"), WorldLoadError);

  const cut = await site();
  const core = cut.files.get(`/world/${ID}/core.bin`) as Uint8Array;
  cut.files.set(`/world/${ID}/core.bin`, core.subarray(0, core.length - 10));
  await assert.rejects(loadWorld(fetcher(cut.files), "/world"), WorldLoadError);

  const old = await site();
  old.files.set(`/world/${ID}/manifest.json`, JSON.stringify({ ...old.manifest, format: 1 }));
  await assert.rejects(loadWorld(fetcher(old.files), "/world"), WorldLoadError);

  const junk = await site();
  junk.files.set(`/world/${ID}/manifest.json`, "{ not json");
  await assert.rejects(loadWorld(fetcher(junk.files), "/world"), WorldLoadError);
});

test("a network failure is the same error", async () => {
  await assert.rejects(loadWorld(async () => { throw new TypeError("offline"); }, "/world"), WorldLoadError);
});

test("a core damaged without changing its length is refused", async () => {
  const { files } = await site();
  const key = `/world/${ID}/core.bin`;
  const bad = (files.get(key) as Uint8Array).slice();
  bad[bad.length >> 1] ^= 0x5a;
  files.set(key, bad);
  await assert.rejects(loadWorld(fetcher(files), "/world"), WorldLoadError);
});
