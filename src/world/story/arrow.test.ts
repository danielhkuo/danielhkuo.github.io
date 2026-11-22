import assert from "node:assert/strict";
import { test } from "node:test";
import { pcos, PI, psin } from "../core/psin.ts";
import { arrowAt } from "./arrow.ts";

const W = 400, H = 225, M = 12;

function near(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps;
}

test("a target on the frame: the arrow floats over it, pointing down", () => {
  const a = arrowAt({ x: 200, y: 100 }, W, H, M);
  assert.equal(a.mode, "over");
  assert.equal(a.x, 200);
  assert.equal(a.y, 86);
  assert.ok(near(a.angle, PI / 2));
});

test("a target at the frame's centre is over, never NaN", () => {
  const a = arrowAt({ x: 200, y: 112 }, W, H, M);
  assert.equal(a.mode, "over");
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.angle));
});

test("a target just inside the margin is over; just outside it is at the edge", () => {
  assert.equal(arrowAt({ x: 388, y: 112 }, W, H, M).mode, "over");
  assert.equal(arrowAt({ x: 389, y: 112 }, W, H, M).mode, "edge");
});

test("a target far east: on the right edge, pointing east", () => {
  const a = arrowAt({ x: 2000, y: 112 }, W, H, M);
  assert.equal(a.mode, "edge");
  assert.equal(a.x, 388);
  assert.ok(Math.abs(a.y - 112) <= 1);
  assert.ok(near(a.angle, 0));
});

test("a target far north: on the top edge, pointing up", () => {
  const a = arrowAt({ x: 200, y: -5000 }, W, H, M);
  assert.equal(a.mode, "edge");
  assert.equal(a.y, 12);
  assert.equal(a.x, 200);
  assert.ok(near(a.angle, -PI / 2));
});

test("a target far south-west: on the inset border, pointing that way", () => {
  const a = arrowAt({ x: -900, y: 900 }, W, H, M);
  assert.equal(a.mode, "edge");
  assert.ok(a.x === 12 || a.y === 213, `(${a.x}, ${a.y}) is on the left or bottom edge`);
  assert.ok(a.x >= 12 && a.x <= 388 && a.y >= 12 && a.y <= 213);
  assert.ok(a.angle > PI / 2 && a.angle < PI);
});

test("the safe areas move the edge in: a target far east stops short of the right inset", () => {
  // A phone held sideways: 31 frame px each side for the Dynamic Island and the rounded corners, 10 at the foot.
  const inset = { top: 0, right: 31, bottom: 10, left: 31 };
  const east = arrowAt({ x: 2000, y: 112 }, W, H, M, inset);
  assert.equal(east.mode, "edge");
  assert.equal(east.x, W - 31 - M);
  const west = arrowAt({ x: -2000, y: 112 }, W, H, M, inset);
  assert.equal(west.x, 31 + M);
  const south = arrowAt({ x: 200, y: 5000 }, W, H, M, inset);
  assert.equal(south.y, H - 10 - M);
  // A target in the inset strip is off the safe frame: the arrow stands at the edge rather than over it.
  assert.equal(arrowAt({ x: W - 20, y: 112 }, W, H, M, inset).mode, "edge");
  assert.equal(arrowAt({ x: W - 31 - M, y: 112 }, W, H, M, inset).mode, "over");
});

test("no inset is the frame's own edge, as before", () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const target of [{ x: 2000, y: 112 }, { x: -900, y: 900 }, { x: 200, y: 100 }]) {
    assert.deepEqual(arrowAt(target, W, H, M, none), arrowAt(target, W, H, M));
  }
});

test("every direction with insets: on the border of the frame less its insets", () => {
  const inset = { top: 4, right: 31, bottom: 10, left: 31 };
  const x0 = inset.left + M, x1 = W - inset.right - M, y0 = inset.top + M, y1 = H - inset.bottom - M;
  for (let k = 0; k < 64; k++) {
    const t = (2 * PI * k) / 64;
    const a = arrowAt({ x: 200 + 3000 * pcos(t), y: 112 + 3000 * psin(t) }, W, H, M, inset);
    assert.equal(a.mode, "edge");
    assert.ok(a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1, `k=${k}: (${a.x}, ${a.y})`);
    assert.ok(a.x === x0 || a.x === x1 || a.y === y0 || a.y === y1, `k=${k}: (${a.x}, ${a.y}) is on the border`);
  }
});

test("every direction: a finite point on the inset rectangle's border", () => {
  for (let k = 0; k < 64; k++) {
    const t = (2 * PI * k) / 64;
    const a = arrowAt({ x: 200 + 3000 * pcos(t), y: 112 + 3000 * psin(t) }, W, H, M);
    assert.equal(a.mode, "edge");
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.angle));
    assert.ok(Number.isInteger(a.x) && Number.isInteger(a.y));
    assert.ok(a.x >= 12 && a.x <= 388 && a.y >= 12 && a.y <= 213, `k=${k}: (${a.x}, ${a.y})`);
    const onBorder = a.x === 12 || a.x === 388 || a.y === 12 || a.y === 213;
    assert.ok(onBorder, `k=${k}: (${a.x}, ${a.y}) is on the border`);
  }
});
