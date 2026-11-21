import assert from "node:assert/strict";
import { test } from "node:test";
import { monument, PIECE_AT, type MonumentKey } from "./monuments.ts";

const KEYS: readonly MonumentKey[] = ["pine", "desk", "bell", "mill", "basket"];

test("each monument is a landmark-sized raster, as tall as a landmark at most", () => {
  for (const key of KEYS) {
    const s = monument(key);
    assert.ok(s.w >= 12 && s.w <= 24 && s.h >= 10 && s.h <= 20, `${key}: ${s.w} × ${s.h}`);
    let top = 0;
    for (const v of s.top) if (v > top) top = v;
    assert.ok(top >= 8 && top <= 40, `${key}: ${top} tall`);
    for (let i = 0; i < s.marks.length; i += 5) {
      const [x, y] = [s.marks[i], s.marks[i + 1]];
      assert.ok(x >= 0 && y >= 0 && x < s.w && y < s.h, `${key}: a mark at (${x}, ${y}) off its raster`);
    }
  }
});

test("each piece sits on its monument's raster, at a height it stands to", () => {
  for (const key of KEYS) {
    const s = monument(key), p = PIECE_AT[key];
    const x = Math.floor(s.w / 2) + p.dx, y = Math.floor(s.h / 2) + p.dy;
    assert.ok(x >= 0 && y >= 0 && x < s.w && y < s.h, `${key}: piece at (${x}, ${y})`);
    assert.ok(p.z > 0 && p.z < 30, `${key}: piece ${p.z} up`);
  }
});

test("a monument is the same every time it is built", () => {
  for (const key of KEYS) {
    const a = monument(key), b = monument(key);
    assert.deepEqual([...a.top], [...b.top]);
    assert.deepEqual([...a.mat], [...b.mat]);
    assert.deepEqual(a.marks, b.marks);
  }
});
