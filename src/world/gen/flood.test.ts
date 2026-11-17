import assert from "node:assert/strict";
import { test } from "node:test";
import { NB8_DX, NB8_DY } from "../core/torus.ts";
import { bumpy, columnSea } from "../testing/fixtures.ts";
import { accumulate, makeJitter, priorityFlood, receivers } from "./flood.ts";

const idx = (x: number, y: number, n: number) => (((y % n) + n) % n) * n + (((x % n) + n) % n);

function drainsToSea(rcv: Int32Array, isSea: Uint8Array, n: number): boolean {
  for (let i = 0; i < n * n; i++) {
    let j = i, steps = 0;
    while (!isSea[j]) { j = rcv[j]; if (++steps > n * n) return false; }
  }
  return true;
}

test("filled ≥ h and sea unchanged", () => {
  const { n, h, isSea } = bumpy(64, 1), { filled } = priorityFlood(h, n, isSea, 1e-6);
  for (let i = 0; i < n * n; i++) {
    if (isSea[i]) assert.equal(filled[i], h[i]);
    else assert.ok(filled[i] >= h[i]);
  }
});

test("order lists every node once", () => {
  const { n, h, isSea } = bumpy(32, 2), { order } = priorityFlood(h, n, isSea, 1e-6);
  assert.equal(order.length, n * n);
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: n * n }, (_, i) => i));
});

test("no pits: every land node's receiver is strictly lower", () => {
  const { n, h, isSea } = bumpy(64, 3), { filled } = priorityFlood(h, n, isSea, 1e-6);
  const { rcv, dist } = receivers(filled, n, isSea, null);
  for (let i = 0; i < n * n; i++) {
    if (isSea[i]) { assert.equal(rcv[i], i); assert.equal(dist[i], 0); continue; }
    assert.ok(filled[rcv[i]] < filled[i], `node ${i}`);
    assert.ok(dist[i] === 1 || dist[i] === Math.SQRT2);
  }
});

test("every land node reaches the sea, some across the x seam", () => {
  const { n, h, isSea } = columnSea(32, 5);
  const { filled } = priorityFlood(h, n, isSea, 1e-6), { rcv } = receivers(filled, n, isSea, null);
  assert.ok(drainsToSea(rcv, isSea, n));
  let crossing = 0;
  for (let y = 0; y < n; y++) if (rcv[y * n + n - 1] % n === 0) crossing++;
  assert.ok(crossing > 0);
});

test("pop order is topological", () => {
  const { n, h, isSea } = bumpy(64, 4), { filled, order } = priorityFlood(h, n, isSea, 1e-6);
  const { rcv } = receivers(filled, n, isSea, null), pos = new Int32Array(n * n);
  order.forEach((node, k) => (pos[node] = k));
  for (let i = 0; i < n * n; i++) if (!isSea[i]) assert.ok(pos[rcv[i]] < pos[i]);
});

test("sea areas sum to the land area; rain weights the sum", () => {
  const { n, h, isSea } = bumpy(64, 5), { filled, order } = priorityFlood(h, n, isSea, 1e-6);
  const { rcv } = receivers(filled, n, isSea, null);
  let land = 0;
  for (const s of isSea) if (!s) land++;
  const a = accumulate(order, rcv, isSea, null);
  let atSea = 0;
  for (let i = 0; i < n * n; i++) if (isSea[i]) atSea += a[i];
  assert.equal(atSea, land);
  for (let i = 0; i < n * n; i++) if (!isSea[i]) assert.ok(a[i] >= 1);
  const rain = new Float64Array(n * n).fill(2.5), a2 = accumulate(order, rcv, isSea, rain);
  let atSea2 = 0;
  for (let i = 0; i < n * n; i++) if (isSea[i]) atSea2 += a2[i];
  assert.ok(Math.abs(atSea2 - 2.5 * land) < 1e-9);
});

test("ties break by lowest node index", () => {
  const { n, h, isSea } = columnSea(16, 1), { filled } = priorityFlood(h, n, isSea, 1e-6);
  const { rcv } = receivers(filled, n, isSea, null);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (isSea[i]) continue;
    let best = -Infinity, bestJ = -1;
    for (let k = 0; k < 8; k++) {
      const j = idx(x + NB8_DX[k], y + NB8_DY[k], n), d = NB8_DX[k] && NB8_DY[k] ? Math.SQRT2 : 1;
      const s = (filled[i] - filled[j]) / d;
      if (s > best || (s === best && j < bestJ)) { best = s; bestJ = j; }
    }
    assert.equal(rcv[i], bestJ, `node ${i}`);
  }
});

test("a 128² plateau at height 100 drains everywhere", () => {
  const { n, h, isSea } = columnSea(128, 100), { filled } = priorityFlood(h, n, isSea, 1e-6);
  const { rcv } = receivers(filled, n, isSea, null);
  assert.ok(drainsToSea(rcv, isSea, n));
  let max = 0;
  for (const v of filled) max = Math.max(max, v);
  assert.ok(max - 100 <= 1e-6 * 128 + 1e-9, `rise ${max - 100}`);
});

test("jitter is in range, deterministic, and used in distances", () => {
  const j = makeJitter(32, 0.4, 7);
  assert.equal(j.amp, 0.4);
  assert.equal(j.jx.length, 32 * 32);
  let spread = 0;
  for (let i = 0; i < 32 * 32; i++) {
    assert.ok(Math.abs(j.jx[i]) <= 0.4 && Math.abs(j.jy[i]) <= 0.4);
    spread += Math.abs(j.jx[i]);
  }
  assert.ok(spread / 1024 > 0.1);
  assert.deepEqual(makeJitter(32, 0.4, 7), j);
  const { n, h, isSea } = bumpy(32, 6), { filled } = priorityFlood(h, n, isSea, 1e-6);
  const { rcv, dist } = receivers(filled, n, isSea, j);
  for (let i = 0; i < n * n; i++) {
    if (isSea[i]) continue;
    const r = rcv[i], x = i % n, y = Math.floor(i / n);
    let dx = (r % n) - x, dy = Math.floor(r / n) - y;
    if (dx > 1) dx -= n; if (dx < -1) dx += n; if (dy > 1) dy -= n; if (dy < -1) dy += n;
    const want = Math.sqrt((dx + j.jx[r] - j.jx[i]) ** 2 + (dy + j.jy[r] - j.jy[i]) ** 2);
    assert.ok(Math.abs(dist[i] - want) < 1e-6, `node ${i}`);
  }
});
