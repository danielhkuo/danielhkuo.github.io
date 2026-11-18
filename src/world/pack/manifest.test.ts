import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlacedSite } from "../gen/sites.ts";
import { START_OFFSHORE, START_SOUTH, startOf } from "./manifest.ts";

function site(type: PlacedSite["type"], x: number, y: number, extra: Partial<PlacedSite> = {}): PlacedSite {
  return {
    id: `${type}-${x}-${y}`, type, x, y, level: 10, pad: { w: 10, d: 10, round: false }, facing: [0, 1],
    approach: { x, y: y + 10, road: true }, island: 0, score: 1, ...extra,
  };
}

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

test("the start lies offshore of the town's river mouth and heads toward the abbey", () => {
  const abbey = site("abbey", 500, 300);
  const town = site("town", 520, 690, { harbour: { x: 520, y: 690, mouthX: 500, mouthY: 700 } });
  const s = startOf([site("windmill", 100, 100), town, abbey], 6400);
  assert.ok(close(s.x, 500) && close(s.y, 700 + START_OFFSHORE), `${s.x}, ${s.y}`);
  assert.ok(close(s.dx, 0) && close(s.dy, -1), `${s.dx}, ${s.dy}`);
});

test("the heading is a unit vector, and the start wraps across the world's edge", () => {
  const abbey = site("abbey", 6350, 6300);
  const town = site("town", 40, 6380, { harbour: { x: 40, y: 6380, mouthX: 50, mouthY: 6390 } });
  const s = startOf([abbey, town], 6400);
  // The mouth is 100 east and 90 south of the abbey across the seam: the start continues that way and wraps.
  const len = Math.sqrt(100 * 100 + 90 * 90);
  assert.ok(close(s.x, (50 + (START_OFFSHORE * 100) / len) % 6400, 1e-6), `x ${s.x}`);
  assert.ok(close(s.y, (6390 + (START_OFFSHORE * 90) / len) % 6400, 1e-6), `y ${s.y}`);
  assert.ok(s.x >= 0 && s.x < 6400 && s.y >= 0 && s.y < 6400);
  assert.ok(close(s.dx * s.dx + s.dy * s.dy, 1, 1e-9));
  assert.ok(s.dx < 0 && s.dy < 0, "back toward the abbey");
});

test("without a town the flight begins south of the abbey, heading north", () => {
  const s = startOf([site("abbey", 800, 6300)], 6400);
  assert.deepEqual([s.x, s.y, s.dx, s.dy], [800, (6300 + START_SOUTH) % 6400, 0, -1]);
});

test("without an abbey the flight begins in the middle, heading north", () => {
  assert.deepEqual(startOf([site("windmill", 10, 10)], 1280), { x: 640, y: 640, dx: 0, dy: -1 });
});
