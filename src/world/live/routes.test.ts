import assert from "node:assert/strict";
import { test } from "node:test";
import { land, manifest } from "../testing/liveShot.ts";
import { planHarbour, ROUTE_STEP } from "./routes.ts";

const town = manifest.sites.find((s) => s.type === "town");
const FARS = [190, 200, 212, 225, 236, 248, 260, 272, 284, 296, 308, 317];
const step = manifest.n / land.gN;
const groundAt = (x: number, y: number): number => {
  const gx = ((Math.floor(x / step) % land.gN) + land.gN) % land.gN, gy = ((Math.floor(y / step) % land.gN) + land.gN) % land.gN;
  return land.ground[gy * land.gN + gx];
};

test("the shipped town's boats have routes from the roads off its harbour, and every point of them is at sea", () => {
  assert.ok(town);
  const plan = planHarbour(land, manifest.n, town.x, town.y, FARS);
  assert.ok(plan, "a harbour");
  assert.ok(Math.hypot(plan.x - town.x, plan.y - town.y) < 160, "the harbour is by the town");
  assert.ok(groundAt(plan.x, plan.y) < 0 && groundAt(plan.roadsX, plan.roadsY) < 0, "harbour and roads are water");
  const off = Math.hypot(plan.roadsX - plan.x, plan.roadsY - plan.y);
  assert.ok(off >= 12 && off <= 120, `the roads lie just off the harbour (${off.toFixed(0)} cells)`);
  const ends = new Set<string>();
  for (let b = 0; b < FARS.length; b++) {
    const r = plan.routes[b];
    assert.ok(r, `a route for boat ${b}`);
    assert.ok(Math.hypot(r[0] - plan.roadsX, r[1] - plan.roadsY) < 1, "it begins in the roads");
    const length = (r.length / 2 - 1) * ROUTE_STEP;
    assert.ok(length >= 150 && length <= 1.1 * FARS[b], `boat ${b} sails ${length} cells out`);
    for (let i = 0; i < r.length; i += 2) {
      // Never across land: the cell under each point is sea, and so are the cells a boat's length to each side.
      for (const [dx, dy] of [[0, 0], [step, 0], [-step, 0], [0, step], [0, -step]]) {
        assert.ok(groundAt(r[i] + dx, r[i + 1] + dy) < 0, `boat ${b} over land at ${r[i].toFixed(0)}, ${r[i + 1].toFixed(0)}`);
      }
      if (i >= 2) assert.ok(Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]) <= ROUTE_STEP + 0.6, "no leaps along the way");
    }
    ends.add(`${Math.round(r[r.length - 2] / 16)},${Math.round(r[r.length - 1] / 16)}`);
  }
  assert.ok(ends.size >= 9, `the boats fan over the sea (${ends.size} ends)`);
  assert.deepEqual(planHarbour(land, manifest.n, town.x, town.y, FARS), plan, "the same plan each time");
});

test("with no ground grid all is sea and the routes fan all round; far inland there is no harbour", () => {
  const plan = planHarbour(undefined, 6400, 1000, 1000, FARS);
  assert.ok(plan);
  const quadrants = new Set<number>();
  for (const r of plan.routes) {
    assert.ok(r);
    quadrants.add((r[r.length - 2] > plan.roadsX ? 1 : 0) + (r[r.length - 1] > plan.roadsY ? 2 : 0));
  }
  assert.equal(quadrants.size, 4);
  // The highest ground of the shipped world is nowhere near the sea.
  let peak = 0;
  for (let i = 1; i < land.ground.length; i++) if (land.ground[i] > land.ground[peak]) peak = i;
  assert.equal(planHarbour(land, manifest.n, (peak % land.gN) * step, Math.floor(peak / land.gN) * step, FARS), null);
});
