import assert from "node:assert/strict";
import { test } from "node:test";
import { patan2, pcos, PI, psin } from "./psin.ts";
import { rngFor } from "./rng.ts";

test("PI is Math.PI", () => assert.equal(PI, Math.PI));

test("psin within 1e-4 of sin on [-1000, 1000]", () => {
  const r = rngFor(1, "psin-test");
  for (let i = 0; i < 100000; i++) {
    const x = r.range(-1000, 1000);
    assert.ok(Math.abs(psin(x) - Math.sin(x)) < 1e-4, `${x}`);
  }
});

test("pcos within 1e-4 of cos", () => {
  const r = rngFor(2, "psin-test");
  for (let i = 0; i < 20000; i++) {
    const x = r.range(-50, 50);
    assert.ok(Math.abs(pcos(x) - Math.cos(x)) < 1e-4);
  }
});

test("odd and 2π-periodic to 1e-12", () => {
  const r = rngFor(3, "psin-test");
  for (let i = 0; i < 10000; i++) {
    const x = r.range(-100, 100);
    assert.ok(Math.abs(psin(-x) + psin(x)) < 1e-12);
    assert.ok(Math.abs(psin(x + 2 * PI) - psin(x)) < 1e-12);
  }
});

test("exact anchors", () => {
  assert.equal(psin(0), 0);
  assert.ok(Math.abs(pcos(0) - 1) < 1e-12);
  assert.ok(Math.abs(psin(PI / 2) - 1) < 1e-4);
  for (let x = -10; x <= 10; x += 0.25) assert.ok(Math.abs(psin(x)) <= 1 + 1e-12);
});

test("patan2 within 1e-14 of atan2 in every quadrant, on the axes and at the origin", () => {
  const r = rngFor(4, "psin-test");
  for (let i = 0; i < 20000; i++) {
    const x = r.range(-10, 10), y = r.range(-10, 10);
    assert.ok(Math.abs(patan2(y, x) - Math.atan2(y, x)) < 1e-14, `${y}, ${x}`);
  }
  for (const [y, x] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1e-9, -1], [-1e-9, -1]]) assert.ok(Math.abs(patan2(y, x) - Math.atan2(y, x)) < 1e-14, `${y}, ${x}`);
  assert.equal(patan2(0, 0), 0);
});
