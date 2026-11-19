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
import { decodeCore, decodeRegion } from "../pack/regions.ts";
import { beforeFlight, buildWorld, OCCLUSION_BLOCK, startRegions } from "./build.ts";

const N = 1280, SEED = 7, REGION = 320;
interface Built { world: World; a: Manifest; b: Manifest; dirA: string; dirB: string }
let memo: Promise<Built> | null = null;
function built(): Promise<Built> {
  memo ??= (async () => {
    const world = makeWorld(paramsFor(N), SEED);
    const dirA = mkdtempSync(join(tmpdir(), "world-build-a-")), dirB = mkdtempSync(join(tmpdir(), "world-build-b-"));
    mkdirSync(join(dirA, "0123456789ab"));
    const a = await buildWorld({ n: N, seed: SEED, out: dirA, world, regionCells: REGION });
    const b = await buildWorld({ n: N, seed: SEED, out: dirB, world, regionCells: REGION });
    return { world, a, b, dirA, dirB };
  })();
  return memo;
}

const read = (dir: string, m: Manifest, file: string) => new Uint8Array(readFileSync(join(dir, m.worldId, file)));
const regionFile = (rx: number, ry: number) => `regions/${rx}-${ry}.bin`;

test("the world is written as a core and its regions, under its id, and current.json names it", async () => {
  const { a, dirA } = await built();
  const core = read(dirA, a, "core.bin");
  assert.equal(a.worldId, (await sha256(core)).slice(0, 12));
  assert.match(a.worldId, /^[0-9a-f]{12}$/);
  assert.deepEqual(JSON.parse(readFileSync(join(dirA, a.worldId, "manifest.json"), "utf8")), a);
  assert.deepEqual(JSON.parse(readFileSync(join(dirA, "current.json"), "utf8")), { worldId: a.worldId });
  assert.deepEqual([a.format, a.n, a.seed, a.regionCells, a.block], [2, N, SEED, REGION, OCCLUSION_BLOCK]);
  assert.deepEqual(a.core, { bytes: core.length, sha256: await sha256(core) });
  const side = N / REGION;
  assert.equal(a.regions.length, side * side);
  for (let ry = 0, k = 0; ry < side; ry++) for (let rx = 0; rx < side; rx++, k++) {
    const r = a.regions[k];
    assert.deepEqual([r.rx, r.ry], [rx, ry], "row-major");
    const bin = read(dirA, a, regionFile(rx, ry));
    assert.deepEqual({ bytes: r.bytes, sha256: r.sha256 }, { bytes: bin.length, sha256: await sha256(bin) });
  }
  assert.equal(existsSync(join(dirA, a.worldId, "world.bin")), false, "no whole-world file");
});

test("building twice gives the same bytes and the same id", async () => {
  const { a, b, dirA, dirB } = await built();
  assert.equal(a.worldId, b.worldId);
  assert.deepEqual(read(dirA, a, "core.bin"), read(dirB, b, "core.bin"));
  assert.deepEqual(a.regions, b.regions);
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

test("the core carries the occlusion floor of the baked ground, and every region decodes", async () => {
  const { a, dirA, world } = await built();
  const core = await decodeCore(read(dirA, a, "core.bin"));
  assert.equal(core.block, OCCLUSION_BLOCK);
  assert.equal(core.regionCells, REGION);
  const bw = buildBakeWorld({ params: paramsFor(N), seed: SEED, world });
  assert.deepEqual(core.occlusion, occlusionFloor(bw.ground, bw.gN, N / bw.gN, OCCLUSION_BLOCK));
  for (const r of a.regions) {
    const g = await decodeRegion(read(dirA, a, regionFile(r.rx, r.ry)), core);
    assert.deepEqual([g.rx, g.ry], [r.rx, r.ry]);
  }
});

test("a world over its budget is refused before anything is written", async () => {
  const { world } = await built();
  const dir = mkdtempSync(join(tmpdir(), "world-build-over-"));
  await assert.rejects(buildWorld({ n: N, seed: SEED, out: dir, world, regionCells: REGION, maxBytes: 1000 }), /budget/);
  assert.deepEqual(readdirSync(dir), [], "no world folder and no current.json");
});

test("the start's regions are the four nearest it, round the seam where the nearer edges are", () => {
  const start = (x: number, y: number) => ({ x, y, dx: 1, dy: 0 });
  // The shipped world's start: west and south of it are the nearer edges.
  assert.deepEqual(startRegions({ n: 10240, regionCells: 1280, start: start(6878, 3816) }), [
    { rx: 4, ry: 2 }, { rx: 5, ry: 2 }, { rx: 4, ry: 3 }, { rx: 5, ry: 3 },
  ]);
  assert.deepEqual(startRegions({ n: 1280, regionCells: 320, start: start(10, 1270) }), [
    { rx: 0, ry: 0 }, { rx: 3, ry: 0 }, { rx: 0, ry: 3 }, { rx: 3, ry: 3 },
  ]);
  assert.deepEqual(startRegions({ n: 1280, regionCells: 1280, start: start(10, 1270) }), [{ rx: 0, ry: 0 }], "one region");
});

test("before the first flight the page downloads the core and the start's regions", async () => {
  const { a } = await built();
  const want = startRegions(a).reduce((sum, r) => sum + a.regions[r.ry * (N / REGION) + r.rx].bytes, a.core.bytes);
  assert.equal(beforeFlight(a), want);
});
