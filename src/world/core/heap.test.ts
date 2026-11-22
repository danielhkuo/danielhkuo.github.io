import assert from "node:assert/strict";
import { test } from "node:test";
import { MinHeap, sortIndicesBy } from "./heap.ts";
import { rngFor } from "./rng.ts";

test("pops in (key, index) order with heavy ties", () => {
  const r = rngFor(1, "heap-test"), n = 5000, keys = new Float64Array(n);
  for (let i = 0; i < n; i++) keys[i] = r.int(4);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = r.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const h = new MinHeap(n);
  for (const i of order) h.push(keys[i], i);
  assert.equal(h.size, n);
  const got: number[] = [];
  while (h.size > 0) got.push(h.pop());
  assert.deepEqual(got, [...order].sort((a, b) => keys[a] - keys[b] || a - b));
});

test("interleaved pushes and pops, with negative and fractional keys", () => {
  const r = rngFor(2, "heap-test"), h = new MinHeap(1000), live = new Map<number, number>();
  let next = 0;
  for (let step = 0; step < 4000; step++) {
    if (live.size < 1000 && (live.size === 0 || r.float() < 0.55)) {
      const k = Math.round(r.range(-50, 50) * 4) / 4;
      live.set(next, k); h.push(k, next); next++;
    } else {
      const best = [...live].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
      assert.equal(h.peekKey(), best[1]);
      assert.equal(h.pop(), best[0]);
      live.delete(best[0]);
    }
  }
});

test("push past capacity throws RangeError; clear empties", () => {
  const h = new MinHeap(2);
  h.push(1, 0); h.push(2, 1);
  assert.throws(() => h.push(3, 2), RangeError);
  h.clear();
  assert.equal(h.size, 0);
  h.push(5, 9);
  assert.equal(h.pop(), 9);
});

test("sortIndicesBy matches a stable (key, index) sort", () => {
  const r = rngFor(3, "heap-test"), n = 5000, keys = new Float64Array(n);
  for (let i = 0; i < n; i++) keys[i] = r.int(50) - 25 + (r.float() < 0.3 ? 0.5 : 0);
  const want = Array.from({ length: n }, (_, i) => i).sort((a, b) => keys[a] - keys[b] || a - b);
  assert.deepEqual([...sortIndicesBy(keys)], want);
  assert.deepEqual([...sortIndicesBy([])], []);
});
