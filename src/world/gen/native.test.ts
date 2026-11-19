// Native land (design 6.7): the recipes, and the join that keeps home's land, water and climate to the bit.

import assert from "node:assert/strict";
import { test } from "node:test";
import { type IslandClimate, joinTerrain, keptMask, recipeOf, SEAM_BLEND, seamDistance } from "./native.ts";
import { paramsFor } from "./params.ts";
import { climateStage, type Grown, growNative, growTerrain, nativeTerrain, type Terrain } from "./pipeline.ts";

const N = 2048, SEED = 12;
const P = { ...paramsFor(N), native: true };

let memo: { g0: Grown; t0: Terrain; g1: Grown; t: Terrain } | null = null;
function worlds() {
  if (!memo) {
    const g0 = growTerrain(P, SEED);
    const t0 = climateStage(g0, SEED);
    const g1 = growNative(P, SEED, t0);
    memo = { g0, t0, g1, t: nativeTerrain(P, SEED, g0, g1) };
  }
  return memo;
}

const at = (temp: number, arid: number, moisture: number): IslandClimate => ({ land: 100, temp, arid, moisture });

test("each climate has its recipe, and the temperate plateau keeps today's land", () => {
  assert.equal(recipeOf(at(0.1, 0, 0.5)), "ice");
  assert.equal(recipeOf(at(0.25, 0, 0.5)), "tundraWet");
  assert.equal(recipeOf(at(0.25, 1, 0.4)), "tundraDry");
  assert.equal(recipeOf(at(0.35, 0, 0.7)), "taiga");
  assert.equal(recipeOf(at(0.5, 0, 0.7)), "keep");
  assert.equal(recipeOf(at(0.7, 0, 0.9)), "warmForest");
  assert.equal(recipeOf(at(0.95, 0, 1)), "jungle");
  assert.equal(recipeOf(at(0.4, 1, 0.4)), "steppe");
  assert.equal(recipeOf(at(0.6, 1, 0.4)), "mediterranean");
  assert.equal(recipeOf(at(0.88, 1, 0.15)), "desert");
  assert.equal(recipeOf(at(0.92, 1, 0.45)), "savanna");
  assert.equal(recipeOf(at(0.97, 1, 0.8)), "jungle");
});

test("home and the kept islands are today's to the bit: land, coast, water, rivers and climate", () => {
  const { g0, t0, g1, t } = worlds();
  const kept = g1.native!.kept;
  assert.ok(kept.some((k) => k), "something is kept");
  assert.ok(kept.some((k) => !k), "something is grown again");
  const mask = keptMask(g0.land, kept);
  const j = joinTerrain(g0, g1, kept);
  const fields: [string, ArrayLike<number>, ArrayLike<number>][] = [
    ["ground", j.land.g, g0.land.g], ["base", j.land.base, g0.land.base], ["isSea", j.land.isSea, g0.land.isSea],
    ["exposure", j.land.exposure, g0.land.exposure], ["shoreClass", j.land.shoreClass, g0.land.shoreClass],
    ["debris", j.land.debris, g0.land.debris], ["hand", j.hydro.hand, g0.hydro.hand], ["lakeId", j.hydro.lakeId, g0.hydro.lakeId],
    ["surface", j.hydro.surface, g0.hydro.surface], ["rain", j.hydro.rain, g0.hydro.rain], ["rivers", j.rivers.ground, g0.rivers.ground],
  ];
  // The sea bed is blended across the join, in open sea; everything else of the kept land is L0's.
  const seam = seamDistance(mask, P.gN, SEAM_BLEND);
  const blended = (i: number) => seam[i] <= SEAM_BLEND && g0.land.isSea[i] === 1 && g1.land.isSea[i] === 1;
  for (const [name, a, b] of fields) {
    let differ = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] && !blended(i) && a[i] !== b[i]) differ++;
    assert.equal(differ, 0, `${name}: ${differ} kept nodes differ`);
  }
  // Every reach of the kept land is today's, with its own number.
  const keptReaches = (r: Terrain["rivers"]) => r.reaches.filter((x) => {
    const v = x.vertices, m = Math.floor(v.length / 8) * 4;
    const gN = P.gN, i = ((Math.floor(v[m + 1] / 4) % gN + gN) % gN) * gN + ((Math.floor(v[m] / 4) % gN + gN) % gN);
    return mask[i] === 1;
  });
  assert.deepEqual(keptReaches(j.rivers), keptReaches(g0.rivers));
  // The climate of home's own land (held to the plateau) is today's.
  const cN = P.cN, home = t0.land.plan.cores.findIndex((c) => c.archetype === 0);
  let checked = 0;
  for (let i = 0; i < cN * cN; i++) {
    if (t0.land.plan.owner[i] !== home || t0.land.isSea[2 * Math.floor(i / cN) * P.gN + 2 * (i % cN)]) continue;
    checked++;
    assert.equal(t.climate.temp![i], t0.climate.temp![i]);
    assert.equal(t.climate.arid![i], t0.climate.arid![i]);
  }
  assert.ok(checked > 100, `home nodes checked: ${checked}`);
});

test("the sea bed is continuous across the join", () => {
  const { g0, g1 } = worlds();
  const kept = g1.native!.kept, mask = keptMask(g0.land, kept), j = joinTerrain(g0, g1, kept);
  const gN = P.gN;
  // The largest step between two sea neighbours across the join, against the largest between sea neighbours anywhere.
  let across = 0, anywhere = 0;
  for (let y = 0; y < gN; y++) for (let x = 0; x < gN; x++) {
    const i = y * gN + x, k = y * gN + ((x + 1) % gN);
    if (!j.land.isSea[i] || !j.land.isSea[k]) continue;
    const step = Math.abs(j.land.g[i] - j.land.g[k]);
    if (mask[i] !== mask[k]) across = Math.max(across, step);
    else anywhere = Math.max(anywhere, step);
  }
  assert.ok(across <= anywhere, `step across the join ${across}, anywhere else ${anywhere}`);
});

test("islands grown again differ from today's and stay in their own water", () => {
  const { g0, g1 } = worlds();
  const kept = g1.native!.kept, mask = keptMask(g0.land, kept);
  let changed = 0, intruding = 0, land1 = 0;
  const gN = P.gN, cN = P.cN, own1 = g1.land.plan.owner;
  for (let i = 0; i < mask.length; i++) {
    const x = i % gN, y = (i - x) / gN;
    // L1's land of an island grown again: in its own water, or (dropped by the join) in a kept island's.
    if (!g1.land.isSea[i] && !kept[own1[(y >> 1) * cN + (x >> 1)]]) {
      if (mask[i]) intruding++;
      else land1++;
    }
    if (!mask[i] && g0.land.g[i] !== g1.land.g[i]) changed++;
  }
  assert.ok(changed > 0.05 * (mask.length - mask.reduce((a, b) => a + b, 0)), `nodes outside the kept land that changed: ${changed}`);
  // L1's own land that falls in the kept islands' water is dropped by the join; there should be next to none.
  // More islands are kept than grown again on this small world, so their owners' regions are many: half a percent.
  assert.ok(intruding <= 0.005 * land1, `L1 land in the kept water: ${intruding} of ${land1}`);
});
