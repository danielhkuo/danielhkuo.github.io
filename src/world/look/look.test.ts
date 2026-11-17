import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildCells } from "../bake/cells.ts";
import { blankWorld } from "../bake/world.ts";
import { riverDistOf } from "../scatter.ts";
import type { CoverInput } from "./contract.ts";
import { noInk, NOON, worldLook } from "./look.ts";
import { isCrop, isLine, isWater, MATERIAL as M, MATERIAL_COUNT } from "./materials.ts";

const MASK = new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/world/bluenoise.bin", import.meta.url))));

test("the look fills the bake's interface and bakes a blank lowland into fields", () => {
  const look = worldLook(512, NOON);
  assert.equal(look.palette.length, 65536);
  assert.equal(look.isWater, isWater);
  // Flat home ground at height 10: farmland through the real cell stage, with the bake's optional inputs wired.
  const world = blankWorld(512, 10);
  const cells = buildCells(world, look, MASK, 0, 0, 256, 256);
  let crops = 0, lines = 0;
  for (const m of cells.mat) {
    assert.ok(m > 0 && m < MATERIAL_COUNT);
    crops += isCrop[m];
    lines += isLine[m];
  }
  assert.ok(crops > 256 * 256 * 0.3, `${crops} crop cells`);
  assert.ok(lines > 256 * 256 * 0.01, `${lines} hedge cells`);
});

test("fields, their boundaries, beaches and wet ground are never inked", () => {
  for (let m = 0; m < 256; m++) if (isCrop[m] === 1 || isLine[m] === 1) assert.equal(noInk[m], 1);
  for (const m of [M.sand, M.sandPale, M.marsh, M.reeds]) assert.equal(noInk[m], 1);
  for (const m of [M.rockHard, M.cliffHard, M.broadleafMid, M.meadowMid, M.heathMid, M.snow, M.sea]) assert.equal(noInk[m], 0);
});

test("river clearance comes from the bake's river offset", () => {
  const c = (dx?: number, dy?: number): CoverInput => ({
    x: 0, y: 0, e: 5, slope: 0, northness: 0, hand: 1, moisture: 0.5, wind: 0.2, exposure: 0.5, debris: 0, rock: 1,
    region: [1, 0, 0, 0, 0, 0], water: 0, shore: 0, riverDx: dx, riverDy: dy,
  });
  assert.equal(riverDistOf(c()), undefined);
  assert.equal(riverDistOf(c(0, 0)), undefined);
  // The river lies at −(dx, dy): due north of a cell whose offset points south.
  assert.deepEqual(riverDistOf(c(0, 4)), { north: 4, south: 4 });
  // Due south, east or west of the cell it hides nothing, but the crown must still clear the water.
  assert.deepEqual(riverDistOf(c(0, -4)), { north: Infinity, south: 4 });
  assert.deepEqual(riverDistOf(c(3, 0)), { north: Infinity, south: 3 });
  // A diagonal reach crosses the cell's column further north than it is near.
  const d = riverDistOf(c(3, 3));
  assert.ok(d !== undefined && Math.abs(d.north - 6) < 1e-9 && Math.abs(d.south - Math.sqrt(18)) < 1e-9);
});
