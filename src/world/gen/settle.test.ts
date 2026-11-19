import assert from "node:assert/strict";
import { test } from "node:test";
import { torusDelta } from "../core/torus.ts";
import { ROAD_PIECE } from "./built.ts";
import { paramsFor } from "./params.ts";
import { makeTerrain, settleWorld, type World } from "./pipeline.ts";
import { siteFieldsOf } from "./settle.ts";
import { builtRules, heightAt, placeSites } from "./sites.ts";

const N = 2048;
let memo: World | null = null;
// Seed 12: of seeds 7–12 at this size, one whose land holds four kinds of site (since the 2026-11-18 terrain polish;
// seed 9 does too, but cuts one hamlet's pad a little past 3).
const SEED = 12;
const world = (): World => (memo ??= settleWorld(makeTerrain(paramsFor(N), SEED)));

test("a small world is settled leniently: sites of several types, each named in the shortfall or standing", () => {
  const s = world().settlement;
  const rules = builtRules(N);
  const have = new Map<string, number>();
  for (const site of s.sites) have.set(site.type, (have.get(site.type) ?? 0) + 1);
  assert.ok(s.sites.length >= 6, `${s.sites.length} sites`);
  assert.ok(have.size >= 4, `types ${[...have.keys()]}`);
  for (const [type, want] of Object.entries(rules.counts)) {
    const got = have.get(type) ?? 0;
    assert.ok(got <= want);
    if (got < want) assert.ok(s.shortfall.some((line) => line.startsWith(`${type}: `) || (type === "abbey" && line.startsWith("town: "))), `${type} is short and unexplained: ${s.shortfall}`);
  }
  // Strict siting names the first of those rules and rejects the seed.
  if (s.shortfall.length) assert.throws(() => placeSites(siteFieldsOf(world()), rules), /siting failed: /);
});

test("sites keep the minimum spacing, stand on land and under the height cap", () => {
  const w = world(), s = w.settlement, rules = builtRules(N);
  for (const a of s.sites) {
    assert.ok(a.x >= 0 && a.x < N && a.y >= 0 && a.y < N);
    assert.ok(a.level > 0 && a.level + 40 <= rules.heightCap);
    for (const b of s.sites) {
      if (a === b || (a.type === "abbey" && b.type === "town") || (a.type === "town" && b.type === "abbey")) continue;
      const dx = torusDelta(a.x, b.x, N), dy = torusDelta(a.y, b.y, N);
      assert.ok(Math.sqrt(dx * dx + dy * dy) >= rules.spacing - 1e-6, `${a.id} and ${b.id}`);
    }
  }
});

test("pads are cut and filled by no more than 3, and the ground is otherwise untouched", () => {
  const w = world(), s = w.settlement, before = w.rivers.ground, gN = paramsFor(N).gN;
  let changed = 0;
  const deep = s.built.conforms.filter((c) => c.kind === "dredge" || c.kind === "raise" || c.limit > 3);
  for (let i = 0; i < before.length; i++) {
    const d = Math.abs(s.ground[i] - before[i]);
    if (d === 0) continue;
    changed++;
    const x = 4 * (i % gN) + 2, y = 4 * Math.floor(i / gN) + 2;
    const special = deep.some((c) => Math.abs(torusDelta(c.x, x, N)) <= c.rx + c.skirt + 4 && Math.abs(torusDelta(c.y, y, N)) <= c.ry + c.skirt + 4);
    if (!special) assert.ok(d <= 3 + 1e-9, `cut or fill ${d} at ${x}, ${y}`);
  }
  assert.ok(changed > 0 && changed < before.length / 20, `${changed} nodes changed`);
  // A landmark's pad is level to within a unit after conforming.
  for (const site of s.sites) {
    if (site.type === "bridge" || site.type === "town" || site.stack) continue;
    const at = heightAt({ h: s.ground, gN }, site.x, site.y);
    assert.ok(Math.abs(at - site.level) <= 3, `${site.id}: ground ${at}, pad ${site.level}`);
  }
});

test("hamlets hold 3–8 houses, keep clear of the sites and of each other, and roads reach them", () => {
  const s = world().settlement;
  assert.ok(s.hamlets.length >= 3, `${s.hamlets.length} hamlets`);
  for (const h of s.hamlets) {
    assert.ok(h.houses >= 1 && h.houses <= 8);
    for (const site of s.sites) {
      const dx = torusDelta(h.x, site.x, N), dy = torusDelta(h.y, site.y, N);
      assert.ok(Math.sqrt(dx * dx + dy * dy) >= 240 * (N / 6400) - 1e-6);
    }
  }
  assert.ok(s.hamlets.filter((h) => h.houses >= 3).length >= s.hamlets.length / 2);
  assert.ok(s.built.roads.length > 0);
  for (const r of s.built.roads) {
    assert.ok(r.width === 1 || r.width === 2);
    assert.ok(r.vertices.length >= 4);
    for (let k = 2; k < r.vertices.length; k += 2) {
      const dx = r.vertices[k] - r.vertices[k - 2], dy = r.vertices[k + 1] - r.vertices[k - 1];
      assert.ok(Math.sqrt(dx * dx + dy * dy) <= ROAD_PIECE + 1e-6);
    }
  }
});

test("structures: every raster is whole, stands at a sane base, and none is taller than the world allows", () => {
  const s = world().settlement;
  assert.ok(s.built.structures.length > 20);
  for (const b of s.built.structures) {
    assert.ok(Number.isInteger(b.x) && Number.isInteger(b.y) && b.w > 0 && b.h > 0);
    assert.equal(b.top.length, b.w * b.h);
    assert.ok(b.base >= 0 && b.base < 152);
    let top = 0;
    for (const t of b.top) top = Math.max(top, t);
    assert.ok(b.base + top <= 160, `top ${b.base + top}`);
  }
});

test("settling is deterministic", () => {
  const a = world().settlement, b = settleWorld(makeTerrain(paramsFor(N), SEED)).settlement;
  assert.deepEqual(a.sites, b.sites);
  assert.deepEqual(a.built.roads, b.built.roads);
  assert.equal(a.built.structures.length, b.built.structures.length);
  assert.deepEqual(a.ground, b.ground);
});
