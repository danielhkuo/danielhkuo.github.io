import assert from "node:assert/strict";
import { test } from "node:test";
import { ALOFT, eachShoreGull, lifeLayer, REACH, startledFor, wheelersOf } from "../live/life.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { coastEast, frameOf } from "./bench/land.ts";
import { censusStartles, FRESH } from "./census.ts";
import type { Pose, Startle } from "./types.ts";

const N = 10240, SEED = 3;
const pose = (x: number, y: number, t: number): Pose => ({ t, dt: 1 / 60, x, y, alt: 30, heading: Math.PI / 2, speed: 100, bank: 0, rest: 0 });

test("the wheelers the sound is told of are the ones the picture draws: nine to a town, five to a lighthouse", () => {
  const sites = [{ type: "town", x: 5000, y: 5000 }, { type: "abbey", x: 100, y: 100 }, { type: "lighthouse", x: 7000, y: 7000 }];
  const w = wheelersOf(sites, SEED);
  assert.equal(w.filter((g) => g.site === 0 && g.town).length, 9);
  assert.equal(w.filter((g) => g.site === 2 && !g.town).length, 5);
  assert.equal(w.length, 14);
  for (const g of w.filter((x) => x.site === 0)) assert.ok(Math.hypot(g.x - 5000, g.y - 5030) <= 105.5);
  assert.equal(typeof lifeLayer, "function");
});

test("flying low along a beach: each resting gull is reported as it lifts, once in the census's ledger window, where it rested", () => {
  const world = coastEast(5040, M.sand);
  const seen = new Map<number, Startle>();
  const list: Startle[] = [], pool: Startle[] = [];
  let reports = 0;
  for (let k = 0; k < 15 * 6; k++) {
    const t = 100 + k / 15, p = pose(5030, 3000 + 100 * (k / 15), t);
    const frame = frameOf(world, p.x, p.y - p.alt / 0.8);
    censusStartles(frame, p, N, SEED, [], list, pool);
    for (const s of list) {
      reports++;
      assert.ok(s.x >= 5040 && s.x < 5052, "on the sand");
      assert.ok(t - s.t0 >= 0 && t - s.t0 < FRESH);
      const before = seen.get(s.key);
      // Seen again a moment later: the same bird, the same take-off time (the picture's own, with no memory).
      if (before) assert.ok(Math.abs(before.t0 - s.t0) < 1e-6 && before.x === s.x);
      seen.set(s.key, { ...s });
      // The picture agrees: at that place the flier's track has just come within reach.
      const tau = startledFor(p, N, s.x, s.y, 0);
      assert.ok(tau >= 0 && tau < FRESH + 1e-9);
    }
  }
  assert.ok(seen.size >= 8, `${seen.size} birds over 600 cells of beach`);
  assert.ok(reports > seen.size, "each is seen by more than one look");
  // High up, nothing is startled.
  censusStartles(frameOf(world, 5030, 3200), { ...pose(5030, 3200, 100), alt: 200 }, N, SEED, [], list, pool);
  assert.equal(list.length, 0);
  assert.ok(REACH > 0 && ALOFT > 4);
});

test("the beach gulls the census walks are the ones the layer's lattice holds: on sand only, the same from any frame that shows them", () => {
  const world = coastEast(5040, M.sand);
  const a = frameOf(world, 5030, 3200), b = frameOf(world, 5090, 3230);
  const birds = (f: typeof a) => {
    const out = new Set<string>();
    eachShoreGull(f.bake, f.rect, N, SEED, f.rect.w >> 1, f.rect.h >> 1, 400, (px, py, g) => {
      assert.equal(f.bake[py * f.rect.w + px] & 255, M.sand);
      out.add(`${f.rect.x + px}:${f.rect.y + py}:${g}`);
    });
    return out;
  };
  const A = birds(a), B = birds(b);
  assert.ok(A.size > 5);
  // Those well inside both frames are in both.
  let both = 0;
  for (const k of A) {
    const [x, y] = k.split(":").map(Number);
    if (x - b.rect.x > 2 && x - b.rect.x < b.rect.w - 2 && y - b.rect.y > 2 && y - b.rect.y < b.rect.h - 2) {
      assert.ok(B.has(k), k);
      both++;
    }
  }
  assert.ok(both > 3);
});
