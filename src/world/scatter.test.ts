import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { WORLD_N } from "./cover.ts";
import type { CoverInput, Stamp } from "./look/contract.ts";
import { isCanopy, MATERIAL as M, MATERIAL_COUNT, MATERIAL_NAMES } from "./look/materials.ts";
import {
  boulderDensity, DENSITY, flowerDensity, northReach, scatterAt, SOUTH_CLEARANCE, treeDensity, type RiverDist,
} from "./scatter.ts";

const MASK = new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/world/bluenoise.bin", import.meta.url))));

const HOME = [1, 0, 0, 0, 0, 0];
const SKERRY = [0, 0, 0, 0, 0, 1];

/** Moist, sheltered ground: trees at their peak density. */
function cell(x: number, y: number, over: Partial<CoverInput> = {}): CoverInput {
  return {
    x, y, e: 20, slope: 0.3, northness: 0, hand: 12, moisture: 0.8, wind: 0.2, exposure: 0.5, debris: 0.5,
    rock: 1, region: SKERRY, water: 0, shore: 0, ...over,
  };
}

/** Stamps on a size × size patch of one ground, with an optional river along row `riverY`. */
function patch(ground: number, over: Partial<CoverInput> = {}, size = 256, riverY = -1, x0 = 512, y0 = 1024): Stamp[] {
  const out: Stamp[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (y === riverY) continue;
      const dist: RiverDist | undefined = riverY < 0 ? undefined : {
        north: y > riverY ? y - riverY : Infinity,
        south: y < riverY ? riverY - y : Infinity,
      };
      const s = scatterAt(cell(x0 + x, y0 + y, over), ground, MASK, dist);
      if (s) out.push(s);
    }
  }
  return out;
}

test("peak densities: broadleaf 0.20, conifer 0.22, boulders at most 0.04, flowers at most 0.03", () => {
  const cells = 256 * 256;
  const broadleaf = patch(M.floorBroadleaf);
  const conifer = patch(M.floorConifer);
  assert.ok(Math.abs(broadleaf.length / cells - 0.2) < 0.005, `broadleaf ${broadleaf.length / cells}`);
  assert.ok(Math.abs(conifer.length / cells - 0.22) < 0.005, `conifer ${conifer.length / cells}`);
  for (const s of broadleaf) assert.ok(s.mat >= M.broadleafCool && s.mat <= M.broadleafWarm);
  for (const s of conifer) assert.ok(s.mat >= M.coniferCool && s.mat <= M.coniferWarm);
  for (const ground of [M.scree, M.moorMid, M.heathMid]) {
    const rocks = patch(ground, { debris: 1 });
    assert.ok(rocks.length > 0 && rocks.length / cells <= 0.04, `${MATERIAL_NAMES[ground]} ${rocks.length / cells}`);
    for (const s of rocks) assert.equal(s.mat, M.boulder);
  }
  const pasture = patch(M.pastureMid).filter((s) => isCanopy[s.mat] === 1);
  assert.ok(pasture.length > 0 && pasture.length / cells <= 0.02, `pasture trees ${pasture.length / cells}`);
  const flowers = patch(M.meadowMid).filter((s) => s.mat === M.flowerPale || s.mat === M.flowerMauve);
  assert.ok(flowers.length > 0 && flowers.length / cells <= 0.03, `flowers ${flowers.length / cells}`);
  assert.equal(DENSITY.broadleaf, 0.2);
  assert.equal(DENSITY.conifer, 0.22);
  assert.equal(DENSITY.pastureTree, 0.02);
  assert.equal(DENSITY.boulder, 0.04);
});

test("density is monotone: more moisture never loses a tree, more wind never gains one", () => {
  const key = (s: Stamp): string => `${Math.floor(s.x)},${Math.floor(s.y)}`;
  for (const ground of [M.floorBroadleaf, M.floorConifer, M.pastureMid]) {
    let prev: Set<string> | null = null;
    let prevDensity = -1;
    for (const moisture of [0.35, 0.45, 0.5, 0.55, 0.6, 0.7, 0.9]) {
      const d = treeDensity(cell(0, 0, { moisture }), ground);
      assert.ok(d >= prevDensity);
      prevDensity = d;
      const now = new Set(patch(ground, { moisture }, 128).filter((s) => isCanopy[s.mat] === 1).map(key));
      if (prev) for (const k of prev) assert.ok(now.has(k), `tree at ${k} lost as moisture rose to ${moisture}`);
      assert.ok(!prev || now.size >= prev.size);
      prev = now;
    }
    prev = null;
    for (const wind of [0.7, 0.55, 0.5, 0.45, 0.3, 0.1]) {
      const now = new Set(patch(ground, { wind }, 128).filter((s) => isCanopy[s.mat] === 1).map(key));
      if (prev) for (const k of prev) assert.ok(now.has(k), `tree at ${k} lost as wind fell to ${wind}`);
      prev = now;
    }
  }
  // Boulders follow debris the same way.
  let last = -1;
  for (const debris of [0, 0.3, 0.6, 1]) {
    const d = boulderDensity(cell(0, 0, { debris }), M.moorMid);
    assert.ok(d >= last);
    last = d;
  }
});

test("nothing is scattered on water, sand, snow, rock, roads or crops", () => {
  const bare = [
    M.sea, M.seaClear, M.lake, M.river, M.sand, M.sandPale, M.shingle, M.snow, M.rockHard, M.rockLime, M.cliffHard,
    M.cliffSed, M.road, M.path, M.wall, M.wheat, M.barley, M.ley, M.plough, M.vine, M.reeds, M.none,
  ];
  for (const ground of bare) {
    assert.equal(treeDensity(cell(0, 0), ground), 0, MATERIAL_NAMES[ground]);
    assert.equal(boulderDensity(cell(0, 0), ground), 0, MATERIAL_NAMES[ground]);
    assert.equal(patch(ground, {}, 64).length, 0, MATERIAL_NAMES[ground]);
  }
  // A water cell grows nothing whatever ground it claims.
  for (const water of [1, 2, 3]) assert.equal(patch(M.floorBroadleaf, { water }, 64).length, 0);
  assert.equal(flowerDensity(M.wheat), 0);
});

test("crowns are wider than tall: broadleaf h = 0.6 d + 1.5 with r 1.5–3, conifer cones h = 1.5 d", () => {
  const broadleaf = patch(M.floorBroadleaf);
  let rMin = Infinity;
  let rMax = 0;
  for (const s of broadleaf) {
    assert.equal(s.shape, 0);
    assert.ok(s.r >= 1.5 && s.r <= 3);
    assert.ok(Math.abs(s.h - (0.6 * 2 * s.r + 1.5)) < 1e-9);
    // The rule makes every crown of radius 1.9 or more wider than tall, and the smallest barely taller.
    if (s.r >= 1.9) assert.ok(2 * s.r > s.h, "wider than tall");
    assert.ok(s.h < 2 * s.r * 1.11);
    rMin = Math.min(rMin, s.r);
    rMax = Math.max(rMax, s.r);
  }
  assert.ok(rMin < 1.55 && rMax > 2.9, `radii ${rMin}–${rMax}`);
  for (const s of patch(M.floorConifer)) {
    assert.equal(s.shape, 1);
    assert.ok(Math.abs(s.h - 1.5 * 2 * s.r) < 1e-9);
    assert.ok(s.h <= 8, "canopy adds at most 8");
  }
  for (const s of broadleaf) assert.ok(s.h <= 8);
  for (const s of patch(M.scree)) {
    assert.ok(s.h >= 1 && s.h <= 2, `boulder ${s.h} tall`);
    assert.ok(s.r <= 1.3);
  }
});

test("every stamp is well formed and rooted in its own cell", () => {
  const grounds = [M.floorBroadleaf, M.floorConifer, M.pastureCool, M.meadowWarm, M.marsh, M.scrubMid, M.scree, M.moorCool, M.alpineMid];
  for (const ground of grounds) {
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        const s = scatterAt(cell(300 + x, 700 + y), ground, MASK);
        if (!s) continue;
        assert.ok(s.x >= 300 + x && s.x < 301 + x && s.y >= 700 + y && s.y < 701 + y);
        assert.ok(s.r > 0 && s.h >= 0 && s.mat > 0 && s.mat < MATERIAL_COUNT && (s.shape === 0 || s.shape === 1));
      }
    }
  }
});

test("river clearance is asymmetric: 1.25 × height to the south, 1–2 cells to the north", () => {
  const river = 128;
  for (const ground of [M.floorBroadleaf, M.floorConifer, M.pastureMid, M.marsh]) {
    const free = patch(ground).filter((s) => isCanopy[s.mat] === 1);
    const held = patch(ground, {}, 256, river).filter((s) => isCanopy[s.mat] === 1);
    const heldKeys = new Set(held.map((s) => `${s.x},${s.y}`));
    let nearestSouth = Infinity;
    let nearestNorth = Infinity;
    for (const s of held) {
      const row = Math.floor(s.y) - 1024;
      if (row > river) {
        // South bank: the whole crown stays out of the river's sight line.
        const d = row - river;
        assert.ok(d >= SOUTH_CLEARANCE * s.h, `${MATERIAL_NAMES[ground]}: tree ${d} south of the river, ${s.h} tall`);
        assert.ok(d >= northReach(s.r, s.h, s.shape));
        nearestSouth = Math.min(nearestSouth, d);
      } else {
        // North bank: the crown's edge keeps at least one cell back.
        const gap = river - row - s.r;
        assert.ok(gap >= 1, `${MATERIAL_NAMES[ground]}: crown ${gap} from the north bank`);
        nearestNorth = Math.min(nearestNorth, gap);
      }
    }
    // The river removes nothing it does not have to: every tree two cells clear on the north bank, and every
    // tree past its own reach on the south bank, still stands.
    for (const s of free) {
      const row = Math.floor(s.y) - 1024;
      if (row === river) continue;
      const clear = row < river ? river - row - s.r >= 2 : row - river >= northReach(s.r, s.h, s.shape);
      if (clear) assert.ok(heldKeys.has(`${s.x},${s.y}`), "a tree clear of the river was removed");
    }
    if (ground === M.floorBroadleaf || ground === M.floorConifer) {
      assert.ok(nearestNorth <= 2, `north bank is clear for ${nearestNorth} cells`);
      assert.ok(nearestSouth >= 3.75 && nearestSouth > 2 * nearestNorth, `south ${nearestSouth}, north ${nearestNorth}`);
    }
  }
});

test("boulders stay out of the river's sight line too", () => {
  const river = 100;
  for (const s of patch(M.scree, {}, 256, river)) {
    const row = Math.floor(s.y) - 1024;
    if (row > river) assert.ok(row - river >= SOUTH_CLEARANCE * s.h);
  }
});

test("farmland rivers get a line of alders along the north bank", () => {
  const river = 128;
  for (const ground of [M.wheat, M.ley, M.hay, M.meadowMid]) {
    const stamps = patch(ground, { region: HOME }, 256, river).filter((s) => isCanopy[s.mat] === 1);
    const alders = stamps.filter((s) => s.mat === M.alder);
    assert.ok(alders.length >= 20, `${MATERIAL_NAMES[ground]}: ${alders.length} alders along 256 cells`);
    const columns = new Set<number>();
    for (const s of alders) {
      const row = Math.floor(s.y) - 1024;
      assert.ok(row < river, "alders stand on the north bank");
      const gap = river - row - s.r;
      assert.ok(gap >= 1 && gap <= 3, `alder crown ${gap} from the bank`);
      columns.add(Math.floor(s.x));
    }
    // A broken line, not a wall and not a clump: spread along the whole reach.
    const xs = [...columns].sort((a, b) => a - b);
    let widest = 0;
    for (let i = 1; i < xs.length; i++) widest = Math.max(widest, xs[i] - xs[i - 1]);
    assert.ok(widest < 40, `gap of ${widest} cells in the alder line`);
    assert.ok(alders.length < 256 * 0.8);
  }
  // No river, no alders; and none on unfarmed ground.
  assert.equal(patch(M.wheat, { region: HOME }).filter((s) => s.mat === M.alder).length, 0);
  assert.equal(patch(M.scree, {}, 256, river).filter((s) => s.mat === M.alder).length, 0);
});

/** Normalised autocorrelation of an occupancy grid at one lag, on the torus. */
function autocorrelation(grid: Uint8Array, size: number, dx: number, dy: number): number {
  let both = 0;
  let ones = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = grid[y * size + x];
      ones += a;
      both += a & grid[((y + dy + size) % size) * size + ((x + dx + size) % size)];
    }
  }
  const p = ones / (size * size);
  return (both / (size * size) - p * p) / (p * (1 - p));
}

test("no rows, no grid, no rings: trees and boulders are blue-noise spaced", () => {
  const size = 256;
  for (const ground of [M.floorBroadleaf, M.floorConifer, M.scree]) {
    const grid = new Uint8Array(size * size);
    for (const s of patch(ground, {}, size, -1, 0, 0)) grid[Math.floor(s.y) * size + Math.floor(s.x)] = 1;
    let peak = -Infinity;
    let peakAt = "";
    let axis = -Infinity;
    for (let dy = -16; dy <= 16; dy++) {
      for (let dx = -16; dx <= 16; dx++) {
        if (dx === 0 && dy === 0) continue;
        const r = autocorrelation(grid, size, dx, dy);
        if (r > peak) {
          peak = r;
          peakAt = `${dx},${dy}`;
        }
        if (dx === 0 || dy === 0 || dx === dy || dx === -dy) axis = Math.max(axis, r);
      }
    }
    // A planted grid or rows would put a peak near 1 at its pitch; a jittered grid keeps about 0.4 of it.
    assert.ok(peak < 0.08, `${MATERIAL_NAMES[ground]}: autocorrelation ${peak.toFixed(3)} at lag ${peakAt}`);
    assert.ok(axis < 0.08, `${MATERIAL_NAMES[ground]}: rows, ${axis.toFixed(3)} along an axis`);
    // Neighbours repel: no two stamps touch, which is what keeps clumps and rings from forming.
    assert.ok(autocorrelation(grid, size, 1, 0) < 0 && autocorrelation(grid, size, 0, 1) < 0);
  }
});

test("the hash hides the mask's 256-cell period: placement repeats, size and colour do not", () => {
  const a = patch(M.floorBroadleaf, {}, 64, -1, 512, 1024);
  const b = patch(M.floorBroadleaf, {}, 64, -1, 512 + 256, 1024);
  assert.equal(a.length, b.length);
  let sameSize = 0;
  let sameMat = 0;
  for (let i = 0; i < a.length; i++) {
    assert.equal(Math.floor(a[i].x) + 256, Math.floor(b[i].x));
    if (a[i].r === b[i].r) sameSize++;
    if (a[i].mat === b[i].mat) sameMat++;
  }
  assert.ok(sameSize < a.length * 0.05, `${sameSize} of ${a.length} crowns repeat their size`);
  assert.ok(sameMat < a.length * 0.9);
});

test("crown colour drifts across a wood and varies from tree to tree", () => {
  const counts = [0, 0, 0];
  for (const s of patch(M.floorBroadleaf, {}, 256, -1, 0, 0)) counts[s.mat - M.broadleafCool]++;
  const here = counts.filter((c) => c > 0).length;
  assert.ok(here >= 2, `one wood, one colour: ${counts}`);
  const far = [0, 0, 0];
  for (let k = 0; k < 24; k++) {
    for (const s of patch(M.floorBroadleaf, {}, 32, -1, (k * 263) % WORLD_N, (k * 577) % WORLD_N)) far[s.mat - M.broadleafCool]++;
  }
  for (const c of far) assert.ok(c > 0, `across the world: ${far}`);
});

test("scatter is a pure function of its inputs and tiles on the world", () => {
  for (const ground of [M.floorBroadleaf, M.pastureMid, M.scree, M.meadowMid, M.alpineMid]) {
    for (let i = 0; i < 4000; i++) {
      const x = (i * 97) % 5000;
      const y = (i * 61) % 5000;
      const c = Object.freeze(cell(x, y, { region: Object.freeze([...SKERRY]) }));
      const a = scatterAt(c, ground, MASK);
      assert.deepEqual(scatterAt(c, ground, MASK), a);
      for (const n of [WORLD_N, 1024]) {
        const here = scatterAt(c, ground, MASK, undefined, n);
        const there = scatterAt({ ...c, x: x + n, y: y - n }, ground, MASK, undefined, n);
        assert.equal(there === null, here === null);
        if (here && there) {
          assert.ok(Math.abs(there.x - n - here.x) < 1e-9 && Math.abs(there.y + n - here.y) < 1e-9);
          assert.deepEqual({ ...there, x: here.x, y: here.y }, here);
        }
      }
    }
  }
});
