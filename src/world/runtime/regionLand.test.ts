import assert from "node:assert/strict";
import { test } from "node:test";
import { upsampleGround } from "../bake/cells.ts";
import { occlusionFloor } from "../gen/occlusion.ts";
import { decodeCore, encodeTiled } from "../pack/regions.ts";
import { decodeFlightData, encodeWorld } from "../pack/world.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { hazeOf } from "../render/haze.ts";
import { fieldWorld, generatedWorld } from "../testing/bakefix.ts";
import { createRegionLand } from "./regionLand.ts";

async function setup(world = generatedWorld(), regionCells = 320) {
  const occlusion = { block: 16, data: occlusionFloor(world.ground, world.gN, world.n / world.gN, 16) };
  const tiled = await encodeTiled(world, { regionCells, occlusion });
  const core = await decodeCore(tiled.core.bin);
  const flight = await decodeFlightData((await encodeWorld(world, { occlusion })).bin);
  const files = new Map(tiled.regions.map((r) => [`${r.rx},${r.ry}`, r.bin]));
  const fetched: string[] = [];
  let failing = false;
  const fetchRegion = async (rx: number, ry: number): Promise<Uint8Array> => {
    fetched.push(`${rx},${ry}`);
    if (failing) throw new Error("offline");
    return files.get(`${rx},${ry}`)!;
  };
  return { core, flight, fetchRegion, fetched, fail: (f: boolean) => { failing = f; } };
}

/** The ground height the whole-world stream view gives (stream.ts groundHeight). */
function wholeHeight(flight: Awaited<ReturnType<typeof decodeFlightData>>, x: number, y: number): number {
  const out = new Float32Array(1);
  upsampleGround(flight.ground, flight.gN, Math.floor(x), Math.floor(y), 1, 1, out);
  return out[0] < 0 ? 0 : out[0];
}

const POINTS: [number, number][] = [[5, 5], [319.5, 320.2], [640, 3], [1279, 1279], [-3, 700], [1283, -2], [400, 960], [961, 641]];

test("with its regions loaded, the ground height equals the whole world's, across region edges and the seam", async () => {
  const s = await setup();
  const land = createRegionLand(s.core, s.fetchRegion);
  assert.equal(land.n, 1280);
  for (const [x, y] of POINTS) await land.want(x, y, 16);
  for (const [x, y] of POINTS) assert.equal(land.groundHeight(x, y), wholeHeight(s.flight, x, y), `at ${x},${y}`);
});

test("before its region arrives, the height comes from the core's overview", async () => {
  const s = await setup();
  const land = createRegionLand(s.core, s.fetchRegion);
  const oN = 1280 / 8;
  for (const [x, y] of POINTS) {
    const ox = ((Math.floor(x / 8) % oN) + oN) % oN, oy = ((Math.floor(y / 8) % oN) + oN) % oN;
    assert.equal(land.groundHeight(x, y), s.core.overview[oy * oN + ox], `at ${x},${y}`);
  }
  assert.equal(s.fetched.length, 0, "asking for a height fetches nothing by itself");
});

test("the occlusion floor comes from the core", async () => {
  const s = await setup();
  const land = createRegionLand(s.core, s.fetchRegion);
  const bN = 1280 / 16;
  for (const [x, y] of POINTS) {
    const bx = ((Math.floor(x / 16) % bN) + bN) % bN, by = ((Math.floor(y / 16) % bN) + bN) % bN;
    assert.equal(land.occlusionFloor(x, y), s.flight.occlusion[by * bN + bx], `at ${x},${y}`);
  }
});

test("want fetches the regions within reach once, shares fetches in flight, and keeps at most its capacity", async () => {
  const s = await setup();
  const land = createRegionLand(s.core, s.fetchRegion, { capacity: 6 });
  await Promise.all([land.want(400, 400, 100), land.want(400, 400, 100)]);
  const first = [...s.fetched];
  assert.equal(new Set(first).size, first.length, "no region fetched twice");
  assert.ok(first.includes("1,1"), "the region under the point");
  for (const k of first) {
    const [rx, ry] = k.split(",").map(Number);
    // Within reach: the region's nearest cell to (400, 400), on the torus, is at most 100 cells away.
    const d = (lo: number, p: number) => { const m = ((p - lo) % 1280 + 1280) % 1280; return m < 320 ? 0 : Math.min(m - 319, 1280 - m); };
    assert.ok(Math.hypot(d(rx * 320, 400), d(ry * 320, 400)) <= 100, `region ${k} is out of reach`);
  }
  for (let i = 0; i < 4; i++) await land.want(160 + 320 * i, 1000, 300);
  assert.ok(land.loaded() <= 6, `holds ${land.loaded()}`);
});

test("a failed fetch keeps the overview height, and a later want retries", async () => {
  const s = await setup();
  const land = createRegionLand(s.core, s.fetchRegion);
  s.fail(true);
  await land.want(500, 500, 8).catch(() => {});
  const oN = 160;
  assert.equal(land.groundHeight(500, 500), s.core.overview[Math.floor(500 / 8) * oN + Math.floor(500 / 8)]);
  s.fail(false);
  await land.want(500, 500, 8);
  assert.equal(land.groundHeight(500, 500), wholeHeight(s.flight, 500, 500));
});

test("the haze drawn from the core's overview equals the whole-world haze where heights are whole units", async () => {
  // Constant over each 8-cell block, so the overview's one sample equals hazeOf's mean of four G nodes.
  const w = fieldWorld(1280, (x, y) => {
    const X = Math.floor(x / 8), Y = Math.floor(y / 8);
    return Math.max(0, Math.round(Math.abs(Math.sin(X / 11) * 60 + Math.cos(Y / 9) * 40) - 8));
  });
  const s = await setup(w, 640);
  const land = createRegionLand(s.core, s.fetchRegion);
  const palette = buildPalette(MIDDAY);
  const a = land.haze(palette), b = hazeOf(s.flight, palette);
  for (let by = 0; by < 1024; by += 37) for (let bx = 0; bx < 1280; bx += 41) assert.equal(a(bx, by), b(bx, by), `haze at ${bx},${by}`);
});
