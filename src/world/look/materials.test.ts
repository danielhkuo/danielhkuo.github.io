import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isCanopy, isCrop, isGrass, isLine, isVegetation, isWater, MATERIAL, MATERIAL_COUNT, MATERIAL_NAMES, VARIANTS,
} from "./materials.ts";

test("ids are distinct bytes that fill 0 … MATERIAL_COUNT − 1", () => {
  const ids = Object.values(MATERIAL);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, MATERIAL_COUNT);
  for (const id of ids) assert.ok(Number.isInteger(id) && id >= 0 && id < MATERIAL_COUNT && id < 256);
  for (let id = 0; id < MATERIAL_COUNT; id++) assert.notEqual(MATERIAL_NAMES[id], "", `id ${id} has no name`);
});

test("each large cover has three hue variants on consecutive ids: cool, mid, warm", () => {
  const m = MATERIAL as Record<string, number>;
  assert.equal(VARIANTS, 3);
  for (const family of ["alpine", "heath", "moor", "broadleaf", "conifer", "meadow", "pasture", "scrub"]) {
    assert.equal(m[`${family}Mid`], m[`${family}Cool`] + 1, family);
    assert.equal(m[`${family}Warm`], m[`${family}Cool`] + 2, family);
  }
});

test("rock tops, cliff faces and their kinds line up", () => {
  const M = MATERIAL;
  assert.deepEqual([M.rockSed, M.rockLime, M.rockSlate].map((id) => id - M.rockHard), [1, 2, 3]);
  assert.deepEqual([M.cliffSed, M.cliffLime, M.cliffSlate].map((id) => id - M.cliffHard), [1, 2, 3]);
});

test("flag tables are indexed by id and say what they should", () => {
  const M = MATERIAL;
  const tables = [isWater, isCanopy, isLine, isCrop, isVegetation, isGrass];
  for (const t of tables) assert.equal(t.length, 256);
  const on = (t: Uint8Array): number[] => [...t.keys()].filter((i) => t[i] === 1);
  assert.deepEqual(on(isWater), [M.sea, M.seaClear, M.lake, M.river]);
  assert.deepEqual(on(isLine), [M.road, M.path, M.hedge, M.wall]);
  assert.deepEqual(on(isCanopy), [
    M.broadleafCool, M.broadleafMid, M.broadleafWarm, M.coniferCool, M.coniferMid, M.coniferWarm, M.alder, M.shrub,
  ]);
  assert.deepEqual(on(isCrop), [M.wheat, M.barley, M.ley, M.hay, M.plough, M.vine]);
  // Water, stone, snow, sand and roads are not vegetation; every canopy, crop and grass is.
  for (const id of [M.none, M.sea, M.river, M.sand, M.snow, M.snowLate, M.rockHard, M.cliffLime, M.scree, M.boulder, M.road, M.wall]) {
    assert.equal(isVegetation[id], 0, MATERIAL_NAMES[id]);
  }
  for (const id of [...on(isCanopy), ...on(isCrop), ...on(isGrass)]) assert.equal(isVegetation[id], 1, MATERIAL_NAMES[id]);
  // No flag is set past the last material.
  for (const t of tables) {
    for (let i = MATERIAL_COUNT; i < 256; i++) assert.equal(t[i], 0);
  }
});

test("snow and crops that change with the season have ids of their own", () => {
  const M = MATERIAL;
  assert.notEqual(M.snow, M.snowLate);
  assert.equal(new Set([M.wheat, M.barley, M.ley, M.hay, M.plough, M.vine]).size, 6);
});
