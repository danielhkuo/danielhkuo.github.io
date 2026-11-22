import assert from "node:assert/strict";
import { test } from "node:test";
import { bakeBenchChunk, MAT, type TileCache } from "./bake-bench.ts";
import { makeBenchField, makeBenchMask } from "./field.ts";

// Built on first use, so the file still collects against stubs.
let memo: { field: ReturnType<typeof makeBenchField>; mask: Uint8Array; cold: ReturnType<typeof bakeBenchChunk> } | null = null;
function setup() {
  if (!memo) {
    const field = makeBenchField(1280, 7);
    const mask = makeBenchMask(1);
    memo = { field, mask, cold: bakeBenchChunk(field, 1, 1, null, mask) };
  }
  return memo;
}
const mat = (p: number) => p & 255;
const ink = (p: number) => (p >>> 14) & 3;
const tone = (p: number) => (p >>> 8) & 15;
const shadow = (p: number) => (p >>> 12) & 3;

test("field sizes and shape", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { field, mask, cold } = setup();
  assert.equal(field.gN, 320);
  assert.equal(field.cN, 160);
  assert.equal(field.heights.length, 320 * 320);
  assert.equal(field.hand.length, 320 * 320);
  assert.equal(field.fields.length, 6 * 160 * 160);
  let land = 0, max = -Infinity, min = Infinity;
  for (const h of field.heights) { if (h > 0) land++; max = Math.max(max, h); min = Math.min(min, h); }
  const share = land / field.heights.length;
  assert.ok(share >= 0.22 && share <= 0.4, `land share ${share}`);
  assert.ok(max >= 100 && max <= 135, `max ${max}`);
  assert.ok(min >= -24, `min ${min}`);
});

test("field is deterministic and seed-dependent", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { field, mask, cold } = setup();
  assert.deepEqual(makeBenchField(1280, 7).heights, field.heights);
  assert.notDeepEqual(makeBenchField(1280, 8).heights, field.heights);
});

test("mask is 256² bytes using the whole range", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { field, mask, cold } = setup();
  assert.equal(mask.length, 65536);
  let lo = 255, hi = 0;
  for (const v of mask) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo <= 2 && hi >= 253);
});

test("a chunk is deterministic", () => {
   
  const { field, mask, cold } = setup();
  assert.deepEqual(bakeBenchChunk(field, 1, 1, null, mask).pixels, cold.pixels);
});

test("every pixel is written exactly once", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { field, mask, cold } = setup();
  assert.equal(cold.pixels.length, 65536);
  assert.ok(!cold.pixels.includes(0xffffffff));
  assert.ok(!cold.pixels.includes(0));
  assert.equal(cold.stats.pixelsPainted, 65536);
});

test("a cold chunk does the full per-cell workload", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { field, mask, cold } = setup();
  const s = cold.stats, cells = 256 * 256;
  assert.ok(s.tilesBuilt >= 3, `tiles ${s.tilesBuilt}`);
  assert.ok(s.cellsUpsampled >= s.tilesBuilt * cells);
  assert.ok(s.coverEvals >= s.tilesBuilt * cells);
  assert.ok(s.lambertEvals >= s.tilesBuilt * cells);
  assert.ok(s.shadowCells >= s.tilesBuilt * cells);
  assert.ok(s.crownsStamped > 0 && s.crownsStamped <= s.coverEvals * 0.25);
  assert.ok(s.inkTests >= 65536 - 256);
});

test("a warm chunk reuses cached tiles", () => {
   
  const { field, mask, cold } = setup();
  const cache: TileCache = new Map();
  const first = bakeBenchChunk(field, 1, 2, cache, mask);
  const north = bakeBenchChunk(field, 1, 1, cache, mask);
  assert.ok(north.stats.tilesBuilt < first.stats.tilesBuilt, `${north.stats.tilesBuilt} vs ${first.stats.tilesBuilt}`);
  assert.deepEqual(north.pixels, cold.pixels);
});

test("ink falls on 0.5–10 % of land pixels", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { field, mask, cold } = setup();
  let land = 0, inked = 0;
  for (const p of cold.pixels) {
    if (mat(p) === MAT.water) continue;
    land++;
    if (ink(p) > 0) inked++;
  }
  const share = inked / land;
  assert.ok(share >= 0.005 && share <= 0.1, `ink share ${share}`);
});

test("pixels decode into a varied, shaded scene", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { field, mask, cold } = setup();
  const mats = new Set<number>(), tones = new Set<number>();
  let shaded = 0;
  for (const p of cold.pixels) {
    mats.add(mat(p));
    tones.add(tone(p));
    if (shadow(p) > 0) shaded++;
  }
  assert.ok(mats.size >= 6, `materials ${[...mats]}`);
  assert.ok(tones.size >= 10, `tones ${tones.size}`);
  assert.ok(shaded > 0);
  for (const m of mats) assert.ok(Object.values(MAT).includes(m as never), `unknown material ${m}`);
});
