import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlightData } from "../pack/world.ts";
import { PAPER } from "./compose.ts";
import { hazeOf } from "./haze.ts";
import { buildPalette } from "./palette.ts";

/** A 512-cell world: sea in the west half, a hill rising to 120 in the east. */
function data(): FlightData {
  const n = 512, gN = 128, ground = new Float32Array(gN * gN);
  for (let y = 0; y < gN; y++) for (let x = 0; x < gN; x++) {
    const dx = x - 96, dy = y - 64;
    ground[y * gN + x] = x < 64 ? -5 : Math.max(1, 120 - 0.15 * (dx * dx + dy * dy));
  }
  return { n, gN, ground, occlusion: new Uint8Array(0), block: 0 };
}

const palette = buildPalette({ time: 0.5, season: 0.25, overcast: 0 });

test("haze is painted, never bare paper", () => {
  const h = hazeOf(data(), palette);
  for (let by = 0; by < 410; by += 7) for (let bx = 0; bx < 512; bx += 7) {
    const c = h(bx, by);
    assert.notEqual(c, PAPER, `${bx},${by}`);
    assert.equal(c >>> 24, 255, "opaque");
  }
});

test("sea and land read differently through the haze", () => {
  const h = hazeOf(data(), palette);
  const sea = h(100, 200), land = h(330, 200), peak = h(384, 205);
  assert.notEqual(sea, land);
  assert.notEqual(land, peak);
  // Sea is bluer than land.
  assert.ok(((sea >>> 16) & 255) - (sea & 255) > ((land >>> 16) & 255) - (land & 255));
});

test("haze wraps with the world", () => {
  const h = hazeOf(data(), palette);
  for (const [bx, by] of [[3, 5], [200, 300], [509, 408]]) {
    assert.equal(h(bx + 512, by), h(bx, by));
    assert.equal(h(bx - 512, by), h(bx, by));
    assert.equal(h(bx, by + 0.8 * 512), h(bx, by));
  }
});

test("the climates' washes stand in for the height's, and every wash a climate gives has a kind of its own", async () => {
  const { hazeFromSamples, HAZE_CELLS, WASH_KIND } = await import("./haze.ts");
  const { hazeWashAt } = await import("../look/haze-wash.ts");
  const { MATERIAL: M } = await import("../look/materials.ts");
  const n = 512, oN = n / HAZE_CELLS;
  const samples = new Float64Array(oN * oN).fill(10);
  const over = new Uint8Array(oN * oN);
  // The east half is desert by the climate; the west half is left to its height (pasture).
  for (let y = 0; y < oN; y++) for (let x = oN / 2; x < oN; x++) over[y * oN + x] = M.desertSand;
  const plain = hazeFromSamples(samples, n, palette), dressed = hazeFromSamples(samples, n, palette, undefined, over);
  assert.equal(dressed(60, 200), plain(60, 200), "a sample with no climate wash keeps its height's");
  assert.notEqual(dressed(400, 200), plain(400, 200), "a desert sample takes the desert's wash");
  // Every material the climate rules can return is one of the haze's washes.
  const seen = new Set<number>();
  for (let h = -10; h <= 140; h += 3) for (let t = 0; t <= 1.0001; t += 0.01) for (const r of [0.05, 0.25, 0.45, 0.7, 1]) for (const a of [0, 1]) {
    const m = hazeWashAt(h, t, r, a);
    if (m !== 0) seen.add(m);
  }
  for (const m of seen) assert.ok(WASH_KIND[m] >= 0, `material ${m} has no wash kind`);
});
