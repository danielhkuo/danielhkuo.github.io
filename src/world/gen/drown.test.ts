import assert from "node:assert/strict";
import { test } from "node:test";
import { drown } from "./drown.ts";
import { paramsFor } from "./params.ts";

/** Sea west of x = 8; a plateau at 10 east of it, with one valley along row 16 that climbs 0.25 a node. */
function valley(n: number): Float64Array {
  const h = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) h[y * n + x] = x < 8 ? -1 : y === 16 ? 0.5 + 0.25 * (x - 8) : 10;
  }
  return h;
}

test("the default rise is 2 units (tuned from the design's 3 to keep land at 30–35 %)", () => {
  assert.equal(paramsFor(1024).drown.rise, 2);
});

test("drowning re-zeroes: every height falls by the rise, and the sea is where the result is ≤ 0", () => {
  const n = 32, h = valley(n), r = drown(h, n, 3);
  assert.equal(r.h.length, n * n);
  for (let i = 0; i < n * n; i++) {
    assert.equal(r.h[i], h[i] - 3);
    assert.equal(r.isSea[i], r.h[i] <= 0 ? 1 : 0);
  }
  assert.notEqual(r.h, h, "the input is not written");
  assert.equal(h[0], -1);
});

test("a valley mouth floods into an inlet that the plateau walls on both sides", () => {
  const n = 32, r = drown(valley(n), n, 3);
  // Valley floor ≤ 3 from x = 8 to x = 18: eleven nodes of new sea.
  let inlet = 0;
  for (let x = 8; x < n; x++) {
    if (!r.isSea[16 * n + x]) break;
    inlet++;
    assert.equal(r.isSea[15 * n + x], 0);
    assert.equal(r.isSea[17 * n + x], 0);
  }
  assert.equal(inlet, 11);
  // The inlet joins the old sea, and the valley above it is still land.
  assert.equal(r.isSea[16 * n + 7], 1);
  assert.equal(r.isSea[16 * n + 19], 0);
  assert.ok(r.h[16 * n + 19] > 0);
});

test("a rise of 0 keeps the shoreline", () => {
  const n = 32, h = valley(n), r = drown(h, n, 0);
  for (let i = 0; i < n * n; i++) assert.equal(r.isSea[i], h[i] <= 0 ? 1 : 0);
});
