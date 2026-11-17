import assert from "node:assert/strict";
import { test } from "node:test";
import { NB8_DIST, NB8_DX, NB8_DY, torusDelta, torusDist, torusDist2, wrap, wrapIndex } from "./torus.ts";

test("wrap", () => {
  assert.equal(wrap(-1, 10), 9);
  assert.equal(wrap(10, 10), 0);
  assert.equal(wrap(-21, 10), 9);
  assert.equal(wrap(3, 10), 3);
  assert.equal(wrap(-0.5, 10), 9.5);
});

test("wrapIndex", () => {
  assert.equal(wrapIndex(-1, -1, 4), 15);
  assert.equal(wrapIndex(4, 0, 4), 0);
  assert.equal(wrapIndex(1, 2, 4), 9);
});

test("torusDelta is the minimum image in [-n/2, n/2)", () => {
  assert.equal(torusDelta(1, 9, 10), -2);
  assert.equal(torusDelta(9, 1, 10), 2);
  assert.equal(torusDelta(0, 5, 10), -5);
  assert.equal(torusDelta(0, 4, 10), 4);
  assert.equal(torusDelta(3, 3, 10), 0);
});

test("distance across the corner seam", () => {
  assert.ok(Math.abs(torusDist(0, 0, 6399, 6399, 6400) - Math.SQRT2) < 1e-12);
  assert.equal(torusDist2(0, 0, 6399, 6399, 6400), 2);
  assert.equal(torusDist(10, 10, 13, 14, 6400), 5);
});

test("neighbour order E, SE, S, SW, W, NW, N, NE", () => {
  assert.deepEqual([...NB8_DX], [1, 1, 0, -1, -1, -1, 0, 1]);
  assert.deepEqual([...NB8_DY], [0, 1, 1, 1, 0, -1, -1, -1]);
  assert.deepEqual([...NB8_DIST], [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2]);
});
