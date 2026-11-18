import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildBakeWorld } from "../bake/world.ts";
import { occlusionFloor } from "../gen/occlusion.ts";
import { paramsFor } from "../gen/params.ts";
import { makeWorld, type World } from "../gen/pipeline.ts";
import { sha256 } from "../pack/codec.ts";
import { startOf, type Manifest } from "../pack/manifest.ts";
import { decodeFlightData } from "../pack/world.ts";
import { buildWorld, OCCLUSION_BLOCK } from "./build.ts";

const N = 1280, SEED = 7;
interface Built { world: World; a: Manifest; b: Manifest; dirA: string; dirB: string }
let memo: Promise<Built> | null = null;
function built(): Promise<Built> {
  memo ??= (async () => {
    const world = makeWorld(paramsFor(N), SEED);
    const dirA = mkdtempSync(join(tmpdir(), "world-build-a-")), dirB = mkdtempSync(join(tmpdir(), "world-build-b-"));
    mkdirSync(join(dirA, "0123456789ab"));
    const a = await buildWorld({ n: N, seed: SEED, out: dirA, world });
    const b = await buildWorld({ n: N, seed: SEED, out: dirB, world });
    return { world, a, b, dirA, dirB };
  })();
  return memo;
}

const binOf = (dir: string, m: Manifest) => new Uint8Array(readFileSync(join(dir, m.worldId, "world.bin")));

test("the world is written under its id, with its manifest, and current.json names it", async () => {
  const { a, dirA } = await built();
  const bin = binOf(dirA, a);
  assert.equal(a.worldId, (await sha256(bin)).slice(0, 12));
  assert.match(a.worldId, /^[0-9a-f]{12}$/);
  assert.deepEqual(JSON.parse(readFileSync(join(dirA, a.worldId, "manifest.json"), "utf8")), a);
  assert.deepEqual(JSON.parse(readFileSync(join(dirA, "current.json"), "utf8")), { worldId: a.worldId });
  assert.deepEqual([a.format, a.n, a.seed, a.bytes, a.block], [1, N, SEED, bin.length, OCCLUSION_BLOCK]);
  assert.equal(a.sections.reduce((s, x) => s + x.bytes, 0) < bin.length, true);
});

test("building twice gives the same bytes and the same id", async () => {
  const { a, b, dirA, dirB } = await built();
  assert.equal(a.worldId, b.worldId);
  assert.deepEqual(binOf(dirA, a), binOf(dirB, b));
});

test("older worlds are left in place", async () => {
  const { dirA } = await built();
  assert.ok(existsSync(join(dirA, "0123456789ab")));
});

test("the manifest lists the sites and the start", async () => {
  const { a, world } = await built();
  assert.deepEqual(a.sites, world.settlement.sites.map((s) => ({ id: s.id, type: s.type, x: s.x, y: s.y })));
  assert.deepEqual(a.start, startOf(world.settlement.sites, N));
});

test("the file carries the occlusion floor of the baked ground", async () => {
  const { a, dirA, world } = await built();
  const fd = await decodeFlightData(binOf(dirA, a));
  assert.equal(fd.block, OCCLUSION_BLOCK);
  const bw = buildBakeWorld({ params: paramsFor(N), seed: SEED, world });
  assert.deepEqual(fd.occlusion, occlusionFloor(bw.ground, bw.gN, N / bw.gN, OCCLUSION_BLOCK));
});

test("a world over its budget is refused before anything is written", async () => {
  const { world } = await built();
  const dir = mkdtempSync(join(tmpdir(), "world-build-over-"));
  await assert.rejects(buildWorld({ n: N, seed: SEED, out: dir, world, maxBytes: 1000 }), /budget/);
  assert.deepEqual(readdirSync(dir), [], "no world folder and no current.json");
});
