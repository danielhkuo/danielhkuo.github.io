import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ARCHETYPE, areaScale, countFor, FORM_NAMES, lengthScale, paramsFor } from "./params.ts";
import { builtRules, siteRules } from "./sites.ts";

test("worlds of 6400 and below scale lengths with the world and keep their counts", () => {
  assert.equal(lengthScale(6400), 1);
  assert.equal(lengthScale(1024), 0.16);
  assert.equal(areaScale(1024), 1);
  assert.equal(countFor(3200, 2), 2);
  const p = paramsFor(6400);
  // One of each island but the skerries: highland, home, fjord, lakes, slate, fen, karst, table, cone, caldera.
  assert.deepEqual(p.cores.archetypes.map((a) => a.count), [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [5, 7]]);
});

test("a larger world keeps the 6400 world's lengths and holds more islands, with one home island", () => {
  const small = paramsFor(6400), big = paramsFor(10240);
  assert.equal(lengthScale(10240), 1);
  assert.ok(Math.abs(areaScale(10240) - 2.56) < 1e-12);
  for (let i = 0; i < small.cores.archetypes.length; i++) {
    assert.deepEqual(big.cores.archetypes[i].diameter, small.cores.archetypes[i].diameter);
    assert.deepEqual(big.cores.archetypes[i].stripeWidth, small.cores.archetypes[i].stripeWidth);
  }
  assert.equal(big.cores.poissonR, small.cores.poissonR);
  assert.equal(big.uplift.featureCells, small.uplift.featureCells);
  // highland, home, fjord, lakes, slate, fen, karst, table, cone, caldera, skerry
  assert.deepEqual(big.cores.archetypes.map((a) => a.count), [[3, 3], [1, 1], [2, 2], [3, 3], [3, 3], [2, 2], [3, 3], [2, 2], [3, 3], [3, 3], [13, 18]]);
  assert.equal(big.cores.archetypes.filter((a) => a.id === ARCHETYPE.home).length, 1);
  assert.equal(new Set(big.cores.archetypes.map((a) => FORM_NAMES[a.form])).size, FORM_NAMES.length);
});

test("a world of any size holds one landmark of each kind, at the same spacing", () => {
  for (const rules of [siteRules, builtRules]) {
    const small = rules(6400), big = rules(10240);
    assert.equal(big.spacing, small.spacing);
    assert.deepEqual(big.homeRiver, small.homeRiver);
    for (const world of [small, big]) for (const count of Object.values(world.counts)) assert.equal(count, 1);
  }
});
