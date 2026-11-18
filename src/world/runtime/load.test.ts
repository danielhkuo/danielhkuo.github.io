import assert from "node:assert/strict";
import { test } from "node:test";
import type { Manifest } from "../pack/manifest.ts";
import { encodeWorld } from "../pack/world.ts";
import { fieldWorld } from "../testing/bakefix.ts";
import { LOAD_FAILED, loadWorld, WorldLoadError } from "./load.ts";

const ID = "abcdef012345";

async function site() {
  const w = fieldWorld(1280, (x, y) => 20 + ((x + y) % 50));
  const occlusion = { block: 16, data: new Uint8Array((1280 / 16) ** 2).fill(7) };
  const { bin, sections } = await encodeWorld(w, { occlusion });
  const manifest: Manifest = {
    format: 1, worldId: ID, n: 1280, seed: 7, bytes: bin.length, sections, block: 16, sites: [], start: { x: 1, y: 2, dx: 0, dy: -1 },
  };
  const files = new Map<string, Uint8Array | string>([
    ["/world/current.json", JSON.stringify({ worldId: ID })],
    [`/world/${ID}/manifest.json`, JSON.stringify(manifest)],
    [`/world/${ID}/world.bin`, bin],
  ]);
  return { w, bin, manifest, files };
}

function fetcher(files: Map<string, Uint8Array | string>, log: string[] = []) {
  return async (url: string): Promise<Response> => {
    log.push(url);
    const body = files.get(url);
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body as BodyInit, { status: 200 });
  };
}

test("a good world loads: the manifest, the address of its file, and the flight data", async () => {
  const { w, manifest, files } = await site();
  const log: string[] = [];
  const got = await loadWorld(fetcher(files, log), "/world");
  assert.deepEqual(got.manifest, manifest);
  assert.equal(got.binUrl, `/world/${ID}/world.bin`);
  assert.equal(got.data.n, 1280);
  assert.equal(got.data.block, 16);
  assert.equal(got.data.ground.length, w.ground.length);
  assert.deepEqual(log, ["/world/current.json", `/world/${ID}/manifest.json`, `/world/${ID}/world.bin`]);
});

test("a missing world is one clear error", async () => {
  const { files } = await site();
  files.delete("/world/current.json");
  await assert.rejects(loadWorld(fetcher(files), "/world"), (e: unknown) => e instanceof WorldLoadError && e.message === LOAD_FAILED);
});

test("a stale id, a truncated file or bad JSON are refused", async () => {
  const stale = await site();
  stale.files.set("/world/current.json", JSON.stringify({ worldId: "000000000000" }));
  await assert.rejects(loadWorld(fetcher(stale.files), "/world"), WorldLoadError);

  const cut = await site();
  cut.files.set(`/world/${ID}/world.bin`, cut.bin.subarray(0, cut.bin.length - 10));
  await assert.rejects(loadWorld(fetcher(cut.files), "/world"), WorldLoadError);

  const junk = await site();
  junk.files.set(`/world/${ID}/manifest.json`, "{ not json");
  await assert.rejects(loadWorld(fetcher(junk.files), "/world"), WorldLoadError);
});

test("a network failure is the same error", async () => {
  await assert.rejects(loadWorld(async () => { throw new TypeError("offline"); }, "/world"), WorldLoadError);
});
