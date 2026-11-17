import assert from "node:assert/strict";
import { test } from "node:test";
import { type Rng, rngFor, sfc32 } from "./rng.ts";

const take = (r: Rng, k: number) => Array.from({ length: k }, () => r.next());

test("sfc32 golden", () => {
  assert.deepEqual(take(sfc32(1, 2, 3, 4), 5), [7, 34, 56623200, 188882296, 3431242869]);
});

test("rngFor golden per stream", () => {
  assert.deepEqual(take(rngFor(42, "plan"), 5), [1308842569, 2472499032, 2733774218, 4039674952, 1071932886]);
  assert.deepEqual(take(rngFor(42, "erode"), 3), [2119309550, 2284740473, 2793819132]);
});

test("streams are independent", () => {
  const a = new Set(take(rngFor(42, "plan"), 1000));
  assert.ok(take(rngFor(42, "erode"), 1000).filter((v) => a.has(v)).length <= 1);
});

test("float, int and range stay in bounds", () => {
  const r = rngFor(9, "bounds");
  for (let i = 0; i < 100000; i++) {
    const f = r.float();
    assert.ok(f >= 0 && f < 1);
    const k = r.int(7);
    assert.ok(Number.isInteger(k) && k >= 0 && k <= 6);
    const x = r.range(-3, 5);
    assert.ok(x >= -3 && x < 5);
  }
});

test("float is next / 2^32 exactly", () => {
  assert.equal(rngFor(7, "x").float(), rngFor(7, "x").next() / 4294967296);
});

test("int is floor(float * n)", () => {
  assert.equal(rngFor(7, "y").int(1000), Math.floor(rngFor(7, "y").float() * 1000));
});
