import assert from "node:assert/strict";
import { test } from "node:test";
import { depthOf, inkOf, lightOf, matOf, shadowOf, toneOf } from "./pixel.ts";

test("a bake pixel's fields come apart again", () => {
  const v = (5 | ((11 | (2 << 4) | (1 << 6)) << 8) | (1234 << 16)) >>> 0;
  assert.deepEqual([matOf(v), lightOf(v), toneOf(v), shadowOf(v), inkOf(v), depthOf(v)], [5, 11 | (2 << 4) | (1 << 6), 11, 2, 1, 1234]);
});
