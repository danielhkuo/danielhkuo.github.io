import assert from "node:assert/strict";
import { test } from "node:test";
import { GlibcRandom } from "./rand.ts";

test("srand(1) matches glibc's well-known sequence", () => {
  const rng = new GlibcRandom(1);
  const got = Array.from({ length: 10 }, () => rng.next());
  assert.deepEqual(got, [
    1804289383, 846930886, 1681692777, 1714636915, 1957747793, 424238335, 719885386, 1649760492,
    596516649, 1189641421,
  ]);
});

test("srand(42) matches glibc", () => {
  const rng = new GlibcRandom(42);
  const got = Array.from({ length: 5 }, () => rng.next());
  assert.deepEqual(got, [71876166, 708592740, 1483128881, 907283241, 442951012]);
});

test("seed 0 behaves as seed 1", () => {
  const a = new GlibcRandom(0);
  const b = new GlibcRandom(1);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test("reseeding restarts the stream", () => {
  const rng = new GlibcRandom(7);
  const first = Array.from({ length: 50 }, () => rng.next());
  rng.seed(7);
  const again = Array.from({ length: 50 }, () => rng.next());
  assert.deepEqual(again, first);
});

test("values stay within [0, 2^31)", () => {
  const rng = new GlibcRandom(123456);
  for (let i = 0; i < 100000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 2147483648 && Number.isInteger(v));
  }
});
