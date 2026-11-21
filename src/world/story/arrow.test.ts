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
