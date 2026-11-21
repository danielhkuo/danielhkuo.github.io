import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { indexBuilt } from "../gen/built.ts";
import { buildBakeWorld } from "../bake/world.ts";
import { buildWorld } from "../cli/build.ts";
import { occlusionFloor } from "../gen/occlusion.ts";
import { paramsFor } from "../gen/params.ts";
import { makeWorld } from "../gen/pipeline.ts";
import { generatedWorld } from "../testing/bakefix.ts";
import { readShipped } from "./shipped.ts";
import { decodeFlightData, decodeWorld, encodeWorld } from "./world.ts";

const GRIDS = ["ground", "base", "conform", "waterLevel", "waterKind", "hand", "shore", "moisture", "wind", "exposure", "debris", "rock", "regions", "temp"] as const;
const VECTORS = ["rivers", "roads", "falls", "stamps", "ponds", "bars", "built"] as const;

test("a world shipped whole (format 1, world.bin) reads as decodeWorld gives it", async () => {
  const w = generatedWorld();
  const occlusion = { block: 16, data: occlusionFloor(w.ground, w.gN, w.n / w.gN, 16) };
  const { bin, sections } = await encodeWorld(w, { occlusion });
  const root = mkdtempSync(join(tmpdir(), "shipped-1-"));
  const id = "0123456789ab";
  mkdirSync(join(root, id));
  writeFileSync(join(root, id, "world.bin"), bin);
  const manifest = { format: 1, worldId: id, n: w.n, seed: 7, bytes: bin.length, sections, block: 16, sites: [], start: { x: 1, y: 2, dx: 0, dy: -1 } };
  writeFileSync(join(root, id, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(root, "current.json"), JSON.stringify({ worldId: id }));

  const got = await readShipped(root);
  const want = await decodeWorld(bin);
  assert.equal(got.manifest.worldId, id);
  assert.equal(got.manifest.n, w.n);
  for (const k of [...GRIDS, ...VECTORS]) assert.deepEqual(got.world[k], want[k], k);
  assert.equal(got.world.gWin, undefined, "a whole world, not a window");
  const fd = await decodeFlightData(bin);
  assert.deepEqual([got.flight.n, got.flight.gN, got.flight.block], [fd.n, fd.gN, fd.block]);
  assert.deepEqual(got.flight.ground, fd.ground);
  assert.deepEqual(got.flight.occlusion, fd.occlusion);
});

test("a world shipped in regions (format 2) reads back whole, value for value", async () => {
  const n = 1280, seed = 7;
  const made = makeWorld(paramsFor(n), seed);
  const root = mkdtempSync(join(tmpdir(), "shipped-2-"));
  const manifest = await buildWorld({ n, seed, out: root, world: made, regionCells: 320 });
  const got = await readShipped(root);
  assert.equal(got.manifest.worldId, manifest.worldId);
  // The same world shipped whole, for comparison.
  const bw = buildBakeWorld({ params: paramsFor(n), seed, world: made });
  const occlusion = { block: manifest.block, data: occlusionFloor(bw.ground, bw.gN, n / bw.gN, manifest.block) };
  const whole = (await encodeWorld(bw, { occlusion })).bin;
  const want = await decodeWorld(whole);
  // Format 2 leaves the road polylines out of the built list (the bake draws roads from world.roads), so compare
  // built against the whole world's with its road polylines emptied.
  if (want.built) want.built = indexBuilt({ ...want.built.built, roads: [] }, want.n);
  for (const k of [...GRIDS, ...VECTORS]) assert.deepEqual(got.world[k], want[k], k);
  assert.equal(got.world.gWin, undefined, "a whole world, not a window");
  const fd = await decodeFlightData(whole);
  assert.deepEqual(got.flight.ground, fd.ground);
  assert.deepEqual(got.flight.occlusion, fd.occlusion);
  assert.equal(got.flight.block, fd.block);
});

test("readShipped takes a world id, and refuses a missing world", async () => {
  const root = mkdtempSync(join(tmpdir(), "shipped-3-"));
  const n = 1280, seed = 7;
  const m = await buildWorld({ n, seed, out: root, world: makeWorld(paramsFor(n), seed), regionCells: 640 });
  writeFileSync(join(root, "current.json"), JSON.stringify({ worldId: "ffffffffffff" }));
  const got = await readShipped(root, m.worldId);
  assert.equal(got.manifest.worldId, m.worldId);
  await assert.rejects(readShipped(root));
});
